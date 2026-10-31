# 03 — Test Strategy

## 1. Scope and objectives

Protect the journeys a student depends on every day: opening the app, getting past the PIN, reading and marking up a PDF, building linked notes, keeping that work across reloads, sessions and network loss, and getting it back out as a backup. Report honestly where the app falls short of those promises.

**In scope:** everything in the production build that runs in a browser without an account (01-APPLICATION-ANALYSIS.md §4, classes T and S), plus mocked contracts for the MuulOrigin services.

**Out of scope for automation (kept as manual cases in the inventory):** real-device input (Apple Pencil, palm rejection, Safari on iPad, Muul-Android), real permission prompts, assistive-technology walkthroughs, and anything that writes to a real backend (sharing, cloud backup, support, GitHub). Those need a staging tenant with throwaway accounts, which does not exist yet.

## 2. Suites

| Suite | Purpose | Selection | Size | Target time | When |
|---|---|---|---|---|---|
| **Smoke** | "Is the build usable at all?" Boot, PIN, project, PDF, note + persistence, schema, find, settings. | `@smoke` | 8 | < 1 min (4 workers) | Every PR and push; also on Firefox and WebKit nightly |
| **Sanity** | One focused check per major module, to validate a change without the full run. | `@sanity` (5 SAN + 14 tagged REG) | 19 | ~2 min | Every PR |
| **Regression** | Risk-based coverage of every implemented module: positive, negative, boundary, persistence, geometry, file handling, offline, a11y. | All of `automation/tests` except performance, on chromium, phone, tablet, offline | 118 | ~7 min with 4 workers on an idle machine; ~15 min with the default 2 on a loaded one | Push to `main`, nightly |
| **Performance** | Generous timing budgets (boot, 40-page open, 40-page find). Run alone with one worker, because timings measured beside busy workers are meaningless (3.8 s alone vs 16.6 s under load in run 2). | project `performance` | 3 | ~30 s | After regression, push to `main`, nightly |
| **P1 slice** | Every P1 case across projects. | `@P1` | ~45 | ~4 min | Every PR (alongside smoke) |
| **Cross-browser** | Smoke on Firefox and WebKit. | projects `firefox`, `webkit` | 16 | ~2 min | Nightly |

A case lives once: sanity and P1 are tag selections over the same tests, not copies.

## 3. Test levels and tools

| Level | Tool | Used for |
|---|---|---|
| Unit | Vitest (existing, unchanged) | Pure rules: plans, sharing guards, sniffing, geometry helpers |
| End-to-end UI | Playwright + TypeScript | Every user journey, against the production build |
| Persistence | Playwright + `helpers/idb.ts` (read-only IndexedDB) | What was saved, not just what was drawn |
| API contract | Playwright `page.route` mocks | Catalog, plan gates, failure handling |
| Offline / PWA | Playwright `offline` project: real service worker + `context.setOffline` | True offline, never mocked responses |
| Accessibility | `@axe-core/playwright` (WCAG 2.1 A/AA) + targeted checks | Gate on critical; attach all; specific checks for what axe cannot see |
| Performance | Playwright timings with generous budgets | Catch order-of-magnitude regressions |
| Device | Manual checklist (SAN-004..009, A11Y-007) | What emulation cannot prove |

**Why this stack:** it is the one already in the repo (Playwright 1.64, Vitest 5, TypeScript, GitHub Actions). The only new dependency is `@axe-core/playwright` (pinned 4.13.0, dev only). Playwright's bundled browsers give Chromium, Firefox and WebKit with no extra tooling. Its `route`, `clock`, `setOffline`, fake media devices and IndexedDB access cover every special case this app has.

## 4. Risk-based prioritisation

| Priority | Meaning | Examples |
|---|---|---|
| **P1** | Data loss, cannot get in, a core feature broken, or a broken product promise (offline) | Lockout, persistence after reload, delete cascades, backup round trip, find, service worker |
| **P2** | A main feature degraded, or a validation or recovery path | File refusals, zoom bounds, threads after zoom, restore conflicts, mocked API failure |
| **P3** | Convenience features and boundaries with low impact | Mini-map, shortcuts list, timeline toggle, name length |

Risk drivers: how often a path is used (reading, notes), how hard the code is (virtualised pages, rAF threads, pointer capture), what failure costs (lost notes, a locked-out user), and history (the tester issue tracker: #295, #349, #355, #381, #222).

## 5. Test data

- **Generated, deterministic fixtures** (`data/builders`): text PDFs with known words on known pages, a 40-page PDF, PNGs with known pixels, bad files (corrupt, empty, text-as-PDF, `.exe`), Markdown and text files. Nothing random, no network.
- **Committed binaries:** the legacy PDF and MP3 (reused from `e2e/fixtures`) and one AES-256 encrypted PDF (`data/static/encrypted.pdf`, password `secret`).
- **Isolation:** every test gets a fresh browser context, so its own IndexedDB and storage. No test depends on another's data; the order does not matter; the suite runs fully parallel.
- **Real user data is impossible to reach.** The suite refuses any non-local base URL (`config/env.ts`) and blocks every external request.

## 6. Entry and exit criteria

**Entry:** `npm run build` succeeded, and `dist/` is newer than `src/` (global setup fails in CI otherwise).

**Exit (release gate):**
- smoke and the P1 slice pass;
- no test is failing for an unknown reason;
- every known defect is either fixed, or accepted by the owner with its DEF id;
- no new critical axe violation;
- no flaky test (`failOnFlakyTests` makes any flake fail the run).

## 7. Known-defect policy

A test that reproduces an application defect keeps asserting the **correct** behaviour and calls `knownDefect('DEF-nnn')`, which marks it expected-to-fail.
- While the defect exists, the run stays green, and the summary lists it under "Known defects reproduced" with the exact assertion it failed at.
- When the app is fixed, the test "unexpectedly passes" and the run goes red until the marker is removed.
- An expected failure counts as evidence only if it fails at the defect's assertion; the summary prints that line so a reviewer can check.
- Never use the marker for a flaky or unexplained failure.

## 8. Flakiness policy

- No fixed sleeps. Waits are on state: a locator, a store row, a canvas width, a transform that stopped moving.
- CI retries once, only to capture a trace; `failOnFlakyTests` turns a pass-on-retry into a failure.
- The suite runs twice back to back before any release (see 09 for the latest two runs).
- A flaky test is fixed or quarantined with a written reason. It is never retried into green.

## 9. What emulation does and does not prove

| Emulated here | Not proven by it |
|---|---|
| Phone layout (Pixel 5 viewport, mobile UA, touch) | Mobile Safari, Android WebView, real gestures |
| Touch taps (`hasTouch`) | Apple Pencil pressure, palm rejection, `touchType: stylus` |
| Camera and microphone (Chromium fake devices) | Real permission prompts, real cameras, OCR quality on real photos |
| Offline (`setOffline` + the real service worker) | Flaky real networks, captive portals |
