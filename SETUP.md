# First-time setup: Cognitive Canvas automation

This guide takes you from nothing to your first green test run, in about 20 minutes. Follow the steps in order and copy each command exactly. No account, password or secret is needed for the normal test runs.

## How the two repositories fit together

The tests check the Cognitive Canvas app, so you need **two** repositories on your machine:

| Repository | What it holds | Where it goes |
|---|---|---|
| The **app** (Cognitive Canvas) | the product code | any folder, for example `D:\github\Cognitive-Canvas` |
| This **automation** repository | the test scripts, test data and docs | **inside** the app folder, in a folder named `automation` |

When you are done, it looks like this:

```text
Cognitive-Canvas\            <- the app repository
├── src\                     <- app code (never change it)
├── dist\                    <- the built app, which the tests open
├── node_modules\            <- the app's tools, including Playwright
└── automation\              <- THIS repository
    ├── tests\               <- the test scripts, one folder per kind of testing
    ├── docs\                <- the workbook, defect list and reports
    └── package.json         <- the short commands (npm run smoke, …)
```

The tests use the app's own copy of Playwright and serve the app's built `dist` folder. That is why this repository must sit inside the app folder.

## 1. What you need

| Tool | Version | Check it with |
|---|---|---|
| Git | any recent | `git --version` |
| Node.js | 20.19 or newer (22 or 24 recommended) | `node --version` |
| Disk space | about 3 GB | |
| Access to the app repository | ask your lead | |

Windows 10/11, macOS and Linux all work. On Windows, use PowerShell, Git Bash or the VS Code terminal.

Only for some extras (skip these at first):
- **Python 3 with `openpyxl`:** to rebuild the Excel workbook and reports.
- **MoBrowser:** for the MoBrowser live tests.
- **The QA test account (from your lead):** for the live tests.

## 2. Get both repositories

```bash
git clone <app-repository-url> Cognitive-Canvas
cd Cognitive-Canvas
git clone https://github.com/codernik-dev/cognitive-canvas-automation.git automation
```

The last word, `automation`, matters: the folder must have exactly that name.

So the app repository does not show the new folder as a change, add it to the app's local ignore list (this changes nothing in the app code or on GitHub):

```bash
echo automation/ >> .git/info/exclude
```

## 3. Install the app's tools and build the app

From the app folder (`Cognitive-Canvas`):

```bash
npm ci
npm run build
```

`npm ci` installs the app's tools, Playwright included. `npm run build` makes `dist/`, the app the tests open. Build again after every `git pull` of the app.

## 4. One-time setup of the test browsers

From the automation folder:

```bash
cd automation
npm run setup
```

This installs the accessibility-check library into the app's tools, without changing the app's files. It also downloads Playwright's test browsers: Chromium, WebKit (Safari's engine) and Firefox. These are separate test copies, never the browsers you use every day. On Linux, run `npx playwright install-deps` once afterwards.

## 5. Your first run

Still in the automation folder:

```bash
npm run smoke
```

You should see **8 passed** in about a minute. Then open the visual report:

```bash
npm run report
```

If you see 8 green tests, you are set up.

## 6. Everyday commands

Run every command from the `automation` folder.

| You want to | Command | Tests | Time |
|---|---|---|---|
| Check the build is alive | `npm run smoke` | 8 | ~1 min |
| Check each module's key features, on desktop, phone, tablet, iPad, offline | `npm run sanity` | 84 | ~10 min |
| Run every P1 (most important) case | `npm run p1` | 176 | ~15-20 min |
| Run everything (full regression) | `npm run regression` | 849 | ~1 h |
| Check speed (machine quiet, nothing else running) | `npm run performance` | 8 | ~3 min |
| Check on Firefox and Safari's engine | `npm run cross-browser` | 16 | ~2 min |
| Watch tests run, pick them one by one | `npm run ui` | | |
| Open the last report | `npm run report` | | |
| Run one test case by its ID | `npm run all -- -g "REG-042"` | | |
| Run one module | `npm run all -- tests/regression/ocr.spec.ts` | | |
| Watch one test in a visible, slowed-down browser | PowerShell: `$env:CC_SLOWMO=600; npm run all -- --project=chromium --headed --workers=1 -g "REG-042"` | | |

Which test case is which, and what each checks, is in the workbook: `docs/Cognitive-Canvas-Test-Suites.xlsx` (sheet "All Test Cases").

Tips:
- **Fresh profile every time:** each test starts in a brand-new, empty browser profile, like a private window. That is why every test begins at the PIN screen.
- **Workers:** 2 browsers run side by side by default. Never start two test runs at once on one machine.
- **Long runs:** keep the laptop plugged in and stop it from sleeping, or the run freezes.
- **Keeping old results:** give each run its own folder. PowerShell: `$env:CC_REPORTS_DIR="reports/my-run"; npm run regression`.

## 7. Reading the results

Every run writes to `reports/`, which is never pushed to git:

| File | What it is |
|---|---|
| `reports/summary.md` | The quick read: totals, every failure with its line, known defects |
| `reports/html/` | The full visual report (`npm run report`) |
| `reports/test-results/<test>/` | For each failure: screenshot, video, trace and page snapshot |

How to read each result:
- **Passed:** the app did what the test case expects.
- **Expected to fail (known defect):** the test checks the correct behaviour, and the app has a known defect there, listed in `docs/08-DEFECTS-AND-LIMITATIONS.md`. It fails exactly where the app is wrong. That is normal until the defect is fixed.
- **Failed:** something is wrong. Open its screenshot and video first.
  - If the app is wrong, report it to your lead with the steps.
  - If the test itself is wrong, the machine was too busy, or the build is old, run it again on its own before reporting.
- **"Passed unexpectedly":** a known defect was fixed. Tell your lead, so the test can be switched back to a normal one.

## 8. Live tests against the real servers (only when your lead asks)

A small opt-in set (`tests/live/`) checks the app against the **real** MuulOrigin sign-in, Muul Cloud and MoBrowser, using a dedicated QA account. Your lead gives you the account. Type it into your terminal only, never into a file:

```powershell
# PowerShell
$env:CC_LIVE_EMAIL = "<qa account email>"; $env:CC_LIVE_PASSWORD = "<qa account password>"
npm run live
```

What the live tests do:
- sign in for real;
- back up to and restore from the real cloud;
- sync between two browsers;
- sign out;
- delete everything they created.

The password never appears in a report or a trace.

For the MoBrowser tests (Windows, MoBrowser installed), set up once:
1. Run `npm run mobrowser:setup`.
2. In MoBrowser's credential manager, add the test GitHub repository (`cc`) and the folder the setup command printed.
3. Close MoBrowser.

Always close your own MoBrowser before `npm run live`.

## 9. Common problems

| You see | Do this |
|---|---|
| `dist/index.html is missing` | In the app folder: `npm run build` |
| `dist/ is older than src/` | You pulled new app code: `npm run build` in the app folder |
| `playwright: command not found` or `Cannot find module '@playwright/test'` | Run `npm ci` in the app folder first; check this folder is named `automation` and sits inside the app folder |
| `Executable doesn't exist` for a browser | `npm run setup` |
| Accessibility tests fail with `Cannot find package '@axe-core/playwright'` | `npm run setup` (it is needed again after every `npm ci` in the app folder) |
| Every test times out at the start | Port 4173 is busy: close the other program, or set `CC_PORT=4180` |
| Many unrelated timeouts, PDFs stuck on "Loading PDF…" | The machine is overloaded: close other heavy programs and test runs |
| Live tests are all "skipped" | `CC_LIVE_EMAIL` / `CC_LIVE_PASSWORD` are not set in this terminal |
| A run stopped halfway | The PC went to sleep: keep it plugged in and awake |

More detail: `docs/07-EXECUTION-GUIDE.md`.

## 10. Before you change or add a test

- Read `README.md` ("Writing a test in 60 seconds") and `docs/06-FRAMEWORK-ARCHITECTURE.md`.
- Every test has an ID (`REG-123 …`) matching a row in `data/test-inventory.csv`. Check with `npm run inventory -- --check`.
- Assert what was stored and what the user sees, not just that a click happened.
- No fixed waits (`waitForTimeout`), no forced clicks, no swallowed errors.
- Before you push, run `npm run typecheck`, then the tests you changed.
- Work on your own branch and open a pull request. Never push straight to `main`.

## 11. Safety

The suite only ever talks to the local build. Every request to another host is blocked, or answered by a simulated server inside the test. So it cannot touch a real account, repository or file store. The only exception is the opt-in live suite: it uses the dedicated QA account and the MoBrowser test profile, and removes what it creates.
