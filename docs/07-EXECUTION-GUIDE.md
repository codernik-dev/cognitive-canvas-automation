# 07 — Execution Guide

The commands below run from the **app's** folder, with the `npm run test:*` scripts of the app's `package.json` where it has them. From this repository's own folder (`automation/`), the same runs have short names: `npm run smoke`, `sanity`, `p1`, `regression`, `performance`, `a11y`, `cross-browser`, `live`, `report`, `ui`, `typecheck` and `inventory` (see `package.json` and SETUP.md §6).

## Install

```bash
npm ci                                  # app + test dependencies (Node >= 20.19)
npx playwright install chromium webkit  # webkit runs the ipad project; add firefox for cross-browser runs
```

## Build the app under test

The suite tests the production build in `dist/`, served by `scripts/serve-dist.mjs` on port 4173. Playwright starts that server for you.

```bash
npm run build
```

Global setup refuses to run without `dist/`. It warns locally (and fails in CI) when `dist/` is older than `src/`.

## Run

| What | Command |
|---|---|
| Smoke (8 tests, chromium) | `npm run test:smoke` |
| Sanity (84 tests: every module's 1-3 key checks, on chromium + phone + tablet + ipad + offline) | `npm run test:sanity` |
| Full regression (849 test executions on chromium + phone + tablet + ipad + offline) | `npm run test:regression` |
| Part of the regression run, as CI does it | `npm run test:regression -- --shard=1/4` (… `4/4`) |
| Performance budgets (8 tests, alone, one worker) | `npm run test:performance` |
| Every P1 case (176 tests, all device projects) | `npm run test:p1` |
| Accessibility only (50 tests) | `npm run test:a11y` |
| Cross-browser smoke (firefox + webkit) | `npm run test:cross-browser` |
| **Live: real MuulOrigin and Muul Cloud** (opt-in, QA account) | set `CC_LIVE_EMAIL` and `CC_LIVE_PASSWORD` in the shell (never in a file), then `npm run test:live`. It serves this build at the app's real address inside the test browser, signs in for real, backs up to and restores from the real cloud, and deletes everything it created. Skipped when the two variables are unset. Traces are off for it: they would record the real session. |
| MoBrowser test profile, once (Windows, MoBrowser installed) | `npm run mobrowser:setup`, then add the test repository (`CC_MOBROWSER_TEST_REPO`, default `cc`) and the QA folder (`CC_MOBROWSER_TEST_FOLDER`, default `Documents\CognitiveCanvas-QA-Backups`) in MoBrowser's credential manager. Close your own MoBrowser before live runs. |
| Watch a run in slow motion | `CC_SLOWMO=600` with `--headed --workers=1` (the test time limit grows with it) |
| One module | `npx playwright test -c automation/playwright.config.ts tests/regression/ocr.spec.ts` (module specs are listed in the workbook's "Suite Structure" sheet) |
| Everything, every project | `npm run test:automation` |
| One file | `npx playwright test -c automation/playwright.config.ts tests/regression/find.spec.ts` |
| One case by ID | `npx playwright test -c automation/playwright.config.ts -g "REG-042"` |
| One module by tag | `npx playwright test -c automation/playwright.config.ts --project=chromium --grep @backup` |
| Headed | add `--headed` |
| Step-through debugger | add `--debug` (one test at a time: combine with `-g`) |
| UI mode | `npx playwright test -c automation/playwright.config.ts --ui` |
| Workers (default 2, the reliable setting on a shared machine) | `CC_WORKERS=4 npm run test:regression` on a quiet machine; `CC_WORKERS=1` to debug one at a time |
| Against an already-running build | `CC_BASE_URL=http://127.0.0.1:5000 npm run test:smoke` (local hosts only; the suite refuses anything else unless `CC_ALLOW_REMOTE_BASE_URL=1` is set for a disposable staging host) |
| Typecheck the suite | `npm run typecheck:automation` |
| Rebuild inventory + coverage docs | `npm run inventory` (add `-- --check` to fail on drift) |

The legacy suite is still available: `npm run test:e2e` (root `playwright.config.ts`, `e2e/`).

## Reports

| File | Use |
|---|---|
| `automation/reports/summary.md` | Totals per suite and project, failures with their failing line, known defects with their failing line, flaky and skipped tests, test-case IDs executed, slowest 10 |
| `automation/reports/html/` | `npm run test:report`: the full report with traces, screenshots and videos for failures |
| `automation/reports/junit.xml` | CI test history |
| `automation/reports/results.json` | Machine-readable results (read by `npm run inventory`) |
| `automation/reports/environment.json` | Build id under test, dist time, node and platform |
| `automation/reports/test-results/<test>/` | `trace.zip`, `test-failed-1.png`, `video.webm`, `error-context.md` (page snapshot at the failure) |

Open a trace: `npx playwright show-trace automation/reports/test-results/<test>/trace.zip`.

Every test also attaches `blocked-external-requests.txt`, the external calls the app tried and the guard refused. Axe scans attach `axe-<screen>.txt`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dist/index.html is missing` | No build | `npm run build` |
| Warning "dist/ is older than src/" | Stale build | `npm run build`; results otherwise describe the old app |
| Every test times out at `page.goto` | Port 4173 busy with something else (`reuseExistingServer` locally) | Stop the other process, or `CC_PORT=4180` |
| `uncaught exceptions in the page` | The app threw | Read `page-errors.txt` in the report. If it is expected for that test, allow-list it with `test.use({ allowedPageErrors: [/…/] })` and say why |
| A known-defect test shows "Expected to fail, but passed" | The defect was fixed | Remove `knownDefect(...)` from the test, update 08 and the CSV status |
| The offline project fails at "no service worker registered" | DEF-007, the app's own defect | Expected until fixed (OFF-000/001 are marked) |
| Canvas or geometry assertions off by a few pixels on a HiDPI machine | Device scale factor | The configs pin the viewport; do not change `deviceScaleFactor` |
| A test signs in, presses Home, then cannot find "New project name..." | On a fresh profile the Catalog opens a moment after sign-in and can cover Home (OBS-009) | Use the `signedIn` fixture, or call `app.firstRunCatalogShown()` before `app.home.reach()` |
| Regression artifacts disappeared after a performance run | Both used to share one output folder | Fixed: `npm run test:performance` writes to `automation/reports/performance/` |
| PDFs stay on "Loading PDF...", many unrelated timeouts, runs far slower than usual | The machine is overloaded, for example by another test suite running at the same time (09, Stress A) | Close other browser-test runs; keep the default 2 workers |
| Windows: build id ends in `-dirty` on a clean checkout | The prebuild copies pdf.js assets with LF line endings into tracked files | Cosmetic for tests; see 08 OBS-004 |
| Two runs at once on one machine wipe each other's artifacts | They share `automation/reports/` | Give each its own folder: `CC_REPORTS_DIR=reports/<name>` |
| The ipad project fails to launch | WebKit is not installed | `npx playwright install webkit` |
| A phone permission test opens a real camera light | It must not: those tests launch full Chromium with the fake camera flag | Check `tests/responsive/permissions.phone.spec.ts` still sets `--use-fake-device-for-media-stream` |

## How CI runs it

`.github/workflows/ci.yml`:

| Trigger | Job | Runs |
|---|---|---|
| Push and PR | `check-and-build` (unchanged) | lint, typecheck, unit + coverage, audit, build |
| Push and PR | `e2e` (unchanged) | legacy `e2e/` suite |
| Push and PR | `automation-gate` | `typecheck:automation`, `inventory --check`, then smoke + sanity + every P1 case on chromium, phone and offline (about 190 tests) |
| Push to `main`, nightly | `automation-regression` | full regression (chromium, phone, tablet, ipad, offline) in 4 shards that run side by side |
| Push to `main`, nightly | `automation-performance` | the performance budgets on a runner of their own, one worker |
| Nightly | `automation-cross-browser` | smoke on firefox + webkit |
| Every automation job | | uploads `automation/reports` (summary, HTML, JUnit, traces) for 14 days and writes `summary.md` into the job summary |

No secrets are used. Every external call is blocked or mocked, so no CI run can touch a real account, repository or bucket.
