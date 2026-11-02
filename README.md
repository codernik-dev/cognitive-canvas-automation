# Cognitive Canvas — Automation Suite

Playwright + TypeScript end-to-end, persistence, offline, accessibility and performance tests for Cognitive Canvas: **871 test cases in 35 modules, 864 automated**.
- **Production build:** the tests run against the app's production build.
- **Isolated:** every test runs in its own throwaway browser profile, and every external request is blocked or answered by an in-test fake, so a run can never reach a real account, repository or bucket.
- **The one exception:** the opt-in live suite (`npm run live`) uses a dedicated QA account and removes what it creates; see [SETUP.md](SETUP.md) §8.

**New here? Start with [SETUP.md](SETUP.md).** It walks you from nothing to a green run, step by step.

## How it is set up

This repository stands alone. It has its own Playwright and its own copy of the app under test, in the git-ignored `app/` folder (this repository is public, so the app's build and source files stay out of git):

```bash
git clone https://github.com/codernik-dev/cognitive-canvas-automation.git
cd cognitive-canvas-automation
npm ci                                # this repository's tools
npm run setup                         # once: the test browsers
npm run sync-app -- <built app folder>  # copy the app's build into app/
```

To test a newer app: run `npm run build` in the app's folder, then `npm run sync-app -- <app folder>` here. To test an app checkout directly, without copying, set `CC_APP_DIR=<app folder>`.

## Quick start (from this folder)

```bash
npm run smoke         # 8 tests, ~1 min: is the build alive
npm run sanity        # 84 tests: each module's key checks, on desktop, phone, tablet, iPad, offline
npm run p1            # 176 tests: every P1 case
npm run regression    # 849 tests on chromium + phone + tablet + ipad + offline (~1 h on 2 workers)
npm run performance   # 8 timing budgets, run alone on a quiet machine
npm run report        # open the HTML report of the last run
npm run ui            # pick tests and watch them run in a real browser
```

The test cases, suites, results and defects are in one workbook: [docs/Cognitive-Canvas-Test-Suites.xlsx](docs/Cognitive-Canvas-Test-Suites.xlsx).

Run one case: `npm run all -- -g "REG-042"`. Headed: add `--headed`. Debugger: add `--debug`.

## Where things are

| You want | Look at |
|---|---|
| What the app does, module by module, and what can be tested | [docs/01-APPLICATION-ANALYSIS.md](docs/01-APPLICATION-ANALYSIS.md) |
| What existed before and what was kept | [docs/02-EXISTING-AUTOMATION-AUDIT.md](docs/02-EXISTING-AUTOMATION-AUDIT.md) |
| Suites, priorities, policies | [docs/03-TEST-STRATEGY.md](docs/03-TEST-STRATEGY.md) |
| Every test case (generated from [data/test-inventory.csv](data/test-inventory.csv)) | [docs/04-TEST-CASE-INVENTORY.md](docs/04-TEST-CASE-INVENTORY.md) |
| Coverage by module, type and priority | [docs/05-COVERAGE-MATRIX.md](docs/05-COVERAGE-MATRIX.md) |
| How the framework is built and how to extend it | [docs/06-FRAMEWORK-ARCHITECTURE.md](docs/06-FRAMEWORK-ARCHITECTURE.md) |
| Every command, report and troubleshooting step, and how CI runs it | [docs/07-EXECUTION-GUIDE.md](docs/07-EXECUTION-GUIDE.md) |
| Defects found and what automation cannot prove | [docs/08-DEFECTS-AND-LIMITATIONS.md](docs/08-DEFECTS-AND-LIMITATIONS.md) |
| Results with evidence | [docs/09-FINAL-QA-REPORT.md](docs/09-FINAL-QA-REPORT.md) |
| Handoff state and what is next | [docs/PROGRESS.md](docs/PROGRESS.md) |

## Writing a test in 60 seconds

Use `fixtures/test.js` for a signed-out user, `fixtures/account.js` for a signed-in MuulOrigin user (`test.use({ muulPlan: 'pro' })`), or your area's fixture (`fixtures/<area>.js`).

```ts
import { test, expect } from '../../fixtures/test.js'
import { expectStoreCount } from '../../helpers/idb.js'

test.describe('My area', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-123 a note can be duplicated twice', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const id = (await app.canvas.place('note', 0.5, 0.4))!
    await app.canvas.select(id)
    await page.keyboard.press('Control+d')
    await page.keyboard.press('Control+d')
    await expectStoreCount(page, 'workspaceItems', 3)
  })
})
```

Then add `REG-123` to `data/test-inventory.csv` and run `npm run inventory -- --check`.

Rules: no `waitForTimeout`, no `force: true`, no `page.evaluate` clicks, no swallowed errors. Assert state (IndexedDB, the ZIP, geometry), not just that a click happened.
