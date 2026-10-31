# 02 — Existing Automation Audit

Audited 2026-10-29 at commit `c54e7e2`. Every claim below comes from running the suite or reading the file named.

## 1. Inventory of what existed

| Asset | What it is | Measured state |
|---|---|---|
| `package.json` scripts | `test` (vitest run), `test:coverage`, `test:e2e` (playwright test), `lint`, `typecheck`, `check` | All run. `lint` caps warnings at 336. |
| `vitest.config.ts` | Node environment, jsdom per file, v8 coverage over all `src` files | **83 files, 706 tests, all passing, 99 s.** Coverage: statements 50.27 %, branches 46.91 %, functions 44.91 %, lines 53.08 %. |
| Unit tests (`src/**/*.test.ts[x]`) | Pure-logic tests: subscription (12 files, 140+ tests), sharing (10), backup (7), media (7), utils (12), i18n (3) | Strong on plans, sharing and backup rules. Thin on auth, DB stores, canvas logic and PDF overlays. |
| `playwright.config.ts` | `e2e/` against `dist/` via `scripts/serve-dist.mjs`; projects `desktop` (fake camera) and `phone` (Pixel 5); 1 worker | Works. |
| `e2e/app.ts` | Shared driver: boot through PIN, create project, upload PDF, place tool | Works, with the issues below. |
| `e2e/*.spec.ts` | 7 specs, 8 tests: smoke ×2, back-guard, canvas-delete (#355), media upload ×2, scanner (#381), project switch on phone | **8/8 passed in 4 min 37 s** (baseline run, 1 worker). |
| `.github/workflows/ci.yml` | `check-and-build` (lint, typecheck, unit + coverage floor, audit, build, upload dist) then `e2e` (chromium, `test:e2e`, report uploaded only on failure) | Sound gate; e2e runs on every push and PR. |
| `qa-automation/` (untracked, git-ignored) | Leftovers of an earlier framework: `node_modules` and the failure artifacts of 709 files, **no source** | Every recorded failure was `page.goto: Timeout … https://localhost:3000/`: it targeted a dev server that was not running. Nothing to reuse except the lesson. |

## 2. Findings on the existing e2e suite

| # | Finding | Evidence | Impact |
|---|---|---|---|
| A1 | **Fixed sleeps everywhere.** `boot()` waits 3.5 s before looking at the page, then 120-4000 ms between keystrokes. `uploadPdf()` waits 6 s, `openDocument()` 5 s. | `e2e/app.ts` | ~30 s per test, about 4× the time the app needs. The PIN screen is ready in ~0.7 s (measured). Still flaky on a slow runner, because a sleep is a guess. |
| A2 | **Clicks through `page.evaluate(... .click())`.** These bypass Playwright's actionability checks and return `false` instead of failing when the element is missing. | `clickButton`, `clickLabel`, `clickDialogButton`, `placeTool` | A missing button does not fail the test at the step that broke. `placeTool` clicks "Open palette", which on desktop belongs to the **PDF** toolbar, and the miss is silent. |
| A3 | **No network isolation.** Every boot reaches the real `www.muulorigin.com` scripts and `api.muulorigin.com` (`/api/iam/auth/me`, `/api/catalogs`). | Probe; no `route` anywhere in `e2e/` | Results depend on a production service. A test could, in principle, touch real data if a token were present. |
| A4 | **`?nc=1` is inert.** No code reads it. | grep over `src`, `public`, `scripts` | Harmless, but it misleads readers. |
| A5 | **`force: true` click** on the document card. | `openDocument()` | Hides an obscured element instead of reporting it. |
| A6 | **Assertions read the DOM only.** Item counts use `[data-item-id]` in the DOM, which the canvas culls off-screen. | `items()` | It works for one or two items near the centre; it would miscount a busy canvas. |
| A7 | `e2e/` is **not typechecked.** `tsc -b` covers `src` and `vite.config.ts` only. | `tsconfig*.json` | Type errors in tests surface at run time. |
| A8 | Retries are 1 in CI, without `failOnFlakyTests`. | `playwright.config.ts` | A flaky pass on retry reports green. |
| A9 | `trace`/`screenshot` are on failure, but **no video and no JUnit.** The HTML report is uploaded only when the job fails. | `playwright.config.ts`, `ci.yml` | Fewer diagnostics; no test history in CI. |

## 3. Findings on the unit layer

| # | Finding | Evidence |
|---|---|---|
| U1 | The coverage thresholds (8/6/6/8) and the comment saying "statements 8.9 %" are stale. Measured today: 50/47/45/53. A change could delete 80 % of the tests and CI would stay green. | `vitest.config.ts`, baseline run |
| U2 | No unit tests for `services/auth` beyond logout (PIN hashing and lockout are covered only end to end now), the DB store modules, `ConnectionThreads` geometry, or canvas camera maths. | test inventory |
| U3 | `fake-indexeddb` is installed but used by only 2 files. It is the cheapest way to cover store CRUD and the restore merge rules. | grep |

## 4. Decision per asset

| Asset | Decision | Why |
|---|---|---|
| Vitest config and the 83 unit files | **Keep unchanged.** | Green, fast, valuable. Only the stale thresholds need raising; that is a one-line change for the owner (recommended, not done here, because it is a product-repo policy decision). |
| `playwright.config.ts` + `e2e/` | **Keep unchanged and running in CI** until the new suite has run green in CI for two weeks. Then retire it. | It works and guards the four tester regressions (#355, #381, the stalled upload, phone project switch). Every one of them is re-implemented in the new suite without sleeps: REG-060 (#355), REG-080/081 (scanner), REG-086 (back guard), REG-088 (phone). The stalled-read case is the only one not yet ported. |
| `scripts/serve-dist.mjs` | **Reuse as-is** as the new suite's web server. | It mirrors production MIME, cache and SPA rules. |
| `e2e/fixtures/cc2-e2e-doc.pdf`, `tone.mp3` | **Reuse** (referenced, not copied). | Stable binaries already in git. |
| `e2e/app.ts` helpers | **Replace** in the new suite with page objects. Leave the file alone. | A1, A2, A5, A6 cannot be fixed without rewriting every helper. |
| `qa-automation/` | **Leave on disk; do not use.** It is git-ignored and holds no source. Delete it whenever convenient. | It contains 709 artifact files and a `node_modules`, and nothing reusable. |
| `.github/workflows/ci.yml` | **Extend, do not replace.** | New jobs added beside `check-and-build` and `e2e` (see 07). |

## 5. What was genuinely missing (and is now added)

- **Network isolation by default**, so tests never reach real services (`fixtures/test.ts`).
- **Persistence assertions against IndexedDB**, not the DOM (`helpers/idb.ts`).
- **Geometry assertions** for threads and coordinates (`assertions/geometry.ts`).
- **Negative and boundary cases:** PIN mismatch, lockout and expiry, name rules, corrupt, empty, encrypted and renamed files, invalid backups.
- **Offline with the real service worker**, which immediately found DEF-007.
- **Accessibility scans** (axe-core) plus targeted checks.
- **Backup content verification:** the ZIP is opened and its manifest, records and PDF bytes compared.
- **Traceability:** inventory CSV ↔ spec IDs, checked by a script.
- **Typed, linted test code** (`automation/tsconfig.json`).
- **JUnit, JSON, HTML and a Markdown summary**, uploaded on every CI run.
