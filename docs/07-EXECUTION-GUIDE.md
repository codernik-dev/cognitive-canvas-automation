# 07 — Execution Guide

Run every command from this repository's folder.

## Install

```bash
npm ci                                  # this repository's tools (Node >= 20.19)
npm run setup                           # Chromium, WebKit (runs the ipad project) and Firefox
```

## The app under test

The suite tests the production build in `app/dist`, served by `scripts/serve-dist.mjs` on port 4173. Playwright starts that server for you. `app/` is a git-ignored copy; make or refresh it after building the app:

```bash
npm run sync-app -- <app folder>        # copies dist/ and the few source files the tests read
```

Set `CC_APP_DIR=<app folder>` to test a checkout directly instead of `app/`. Global setup refuses to run without `dist/`. It warns locally (and fails in CI) when `dist/` is older than `src/`.

## Run

| What | Command |
|---|---|
| Smoke (8 tests, chromium) | `npm run smoke` |
| Sanity (84 tests: every module's 1-3 key checks, on chromium + phone + tablet + ipad + offline) | `npm run sanity` |
| Full regression (870 test executions on chromium + phone + tablet + ipad + offline) | `npm run regression` |
| Part of the regression run, as CI does it | `npm run regression -- --shard=1/4` (… `4/4`) |
| Performance budgets (8 tests, alone, one worker) | `npm run performance` |
| Every P1 case (178 tests, all device projects) | `npm run p1` |
| Accessibility only (50 tests) | `npm run a11y` |
| Cross-browser smoke (firefox + webkit) | `npm run cross-browser` |
| **Live: real MuulOrigin and Muul Cloud** (opt-in, QA account) | set `CC_LIVE_EMAIL` and `CC_LIVE_PASSWORD` in the shell (never in a file), then `npm run live`. It serves this build at the app's real address inside the test browser, signs in for real, backs up to and restores from the real cloud, and deletes everything it created. Skipped when the two variables are unset. Traces are off for it: they would record the real session. |
| **Live sharing: teacher to students on the real server** (opt-in) | as above (the QA account is the teacher and must be on a paid plan), plus `CC_LIVE_STUDENTS` (two comma-separated emails of real Free accounts with empty inboxes) and `CC_LIVE_STUDENT_PASSWORD` (one password for both), in the shell only. `tests/live/sharing.live.spec.ts` (copies, classes, plan gates) and `live-share.live.spec.ts` (live shares) open one browser per student, compare what arrives with what was sent row by row, and delete every share, live share, class and received note they made. Always one worker: the tests share the accounts. 23 tests, about an hour; keep the machine awake. |
| MoBrowser test profile, once (Windows, MoBrowser installed) | `npm run mobrowser:setup`, then add the test repository (`CC_MOBROWSER_TEST_REPO`, default `codernik-dev/cc-test-`) and the QA folder (`CC_MOBROWSER_TEST_FOLDER`, default `Documents\CognitiveCanvas-QA-Backups`) in MoBrowser's credential manager. Close your own MoBrowser before live runs. |
| Watch a run in slow motion | `CC_SLOWMO=600` with `--headed --workers=1` (the test time limit grows with it) |
| One module | `npx playwright test -c playwright.config.ts tests/regression/ocr.spec.ts` (module specs are listed in the workbook's "Suite Structure" sheet) |
| Everything, every project | `npm run all` |
| One file | `npx playwright test -c playwright.config.ts tests/regression/find.spec.ts` |
| One case by ID | `npx playwright test -c playwright.config.ts -g "REG-042"` |
| One module by tag | `npx playwright test -c playwright.config.ts --project=chromium --grep @backup` |
| Headed | add `--headed` |
| Step-through debugger | add `--debug` (one test at a time: combine with `-g`) |
| UI mode | `npx playwright test -c playwright.config.ts --ui` |
| Workers (default 2, the reliable setting on a shared machine) | `CC_WORKERS=4 npm run regression` on a quiet machine; `CC_WORKERS=1` to debug one at a time |
| Against an already-running build | `CC_BASE_URL=http://127.0.0.1:5000 npm run smoke` (local hosts only; the suite refuses anything else unless `CC_ALLOW_REMOTE_BASE_URL=1` is set for a disposable staging host) |
| Typecheck the suite | `npm run typecheck` |
| Rebuild inventory + coverage docs | `npm run inventory` (add `-- --check` to fail on drift) |

## Reports

| File | Use |
|---|---|
| `reports/summary.md` | Totals per suite and project, failures with their failing line, known defects with their failing line, flaky and skipped tests, test-case IDs executed, slowest 10 |
| `reports/html/` | `npm run report`: the full report with traces, screenshots and videos for failures |
| `reports/junit.xml` | CI test history |
| `reports/results.json` | Machine-readable results (read by `npm run inventory`) |
| `reports/environment.json` | Build id under test, dist time, node and platform |
| `reports/test-results/<test>/` | `trace.zip`, `test-failed-1.png`, `video.webm`, `error-context.md` (page snapshot at the failure) |

Open a trace: `npx playwright show-trace reports/test-results/<test>/trace.zip`.

Every test also attaches `blocked-external-requests.txt`, the external calls the app tried and the guard refused. Axe scans attach `axe-<screen>.txt`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `app\dist\index.html is missing` | No snapshot | `npm run sync-app -- <app folder>` |
| Warning "dist/ is older than src/" | Stale build | Build the app, then `npm run sync-app -- <app folder>`; results otherwise describe the old app |
| Every test times out at `page.goto` | Port 4173 busy with something else (`reuseExistingServer` locally) | Stop the other process, or `CC_PORT=4180` |
| `uncaught exceptions in the page` | The app threw | Read `page-errors.txt` in the report. If it is expected for that test, allow-list it with `test.use({ allowedPageErrors: [/…/] })` and say why |
| A known-defect test shows "Expected to fail, but passed" | The defect was fixed | Remove `knownDefect(...)` from the test, update 08 and the CSV status |
| The offline project fails at "no service worker registered" | DEF-007, the app's own defect | Expected until fixed (OFF-000/001 are marked) |
| Canvas or geometry assertions off by a few pixels on a HiDPI machine | Device scale factor | The configs pin the viewport; do not change `deviceScaleFactor` |
| A test signs in, presses Home, then cannot find "New project name..." | On a fresh profile the Catalog opens a moment after sign-in and can cover Home (OBS-009) | Use the `signedIn` fixture, or call `app.firstRunCatalogShown()` before `app.home.reach()` |
| Regression artifacts disappeared after a performance run | Both used to share one output folder | Fixed: `npm run performance` writes to `reports/performance/` |
| PDFs stay on "Loading PDF...", many unrelated timeouts, runs far slower than usual | The machine is overloaded, for example by another test suite running at the same time (09, Stress A) | Close other browser-test runs; keep the default 2 workers |
| Windows: build id ends in `-dirty` on a clean checkout | The prebuild copies pdf.js assets with LF line endings into tracked files | Cosmetic for tests; see 08 OBS-004 |
| Two runs at once on one machine wipe each other's artifacts | They share `reports/` | Give each its own folder: `CC_REPORTS_DIR=reports/<name>` |
| The ipad project fails to launch | WebKit is not installed | `npm run setup` |
| A phone permission test opens a real camera light | It must not: those tests launch full Chromium with the fake camera flag | Check `tests/responsive/permissions.phone.spec.ts` still sets `--use-fake-device-for-media-stream` |

## How CI runs it

This table describes the app repository's `.github/workflows/ci.yml`, which expects this suite in the app's `automation/` folder. A job that runs it there must run `npm ci` in that folder too, and set `CC_APP_DIR=..`.

| Trigger | Job | Runs |
|---|---|---|
| Push and PR | `check-and-build` (unchanged) | lint, typecheck, unit + coverage, audit, build |
| Push and PR | `e2e` (unchanged) | legacy `e2e/` suite |
| Push and PR | `automation-gate` | `typecheck:automation`, `inventory --check`, then smoke + sanity + every P1 case on chromium, phone and offline (about 190 tests) |
| Push to `main`, nightly | `automation-regression` | full regression (chromium, phone, tablet, ipad, offline) in 4 shards that run side by side |
| Push to `main`, nightly | `automation-performance` | the performance budgets on a runner of their own, one worker |
| Nightly | `automation-cross-browser` | smoke on firefox + webkit |
| Every automation job | | uploads `reports` (summary, HTML, JUnit, traces) for 14 days and writes `summary.md` into the job summary |

No secrets are used. Every external call is blocked or mocked, so no CI run can touch a real account, repository or bucket.
