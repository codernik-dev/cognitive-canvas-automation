# Progress and Handoff

Last updated 2026-11-09. This repository (`cognitive-canvas-automation`, branch `nik`) stands alone and tests app commit `c54e7e2` (app branch `AbhishekBugs`), copied into `app/` by `npm run sync-app`. The work since the first commit is in the working tree, not committed.

## Checklist

| Phase | State | Evidence |
|---|---|---|
| 1 Discovery | Done | 01-APPLICATION-ANALYSIS.md; every module's source re-inventoried in the expansion round |
| 2 Audit | Done | 02-EXISTING-AUTOMATION-AUDIT.md |
| 3 Test design | Done | `data/test-inventory.csv`: 916 cases, 35 modules; 04/05 generated |
| 4 Technology | Done | Playwright + TS; `@axe-core/playwright` 4.13.0 (pinned); a small WebDriver BiDi driver for MoBrowser |
| 5 Framework | Done | 06-FRAMEWORK-ARCHITECTURE.md: per-area fixtures, stateful fakes for every external service, iPad (WebKit) project, opt-in live project |
| 6 App-specific helpers | Done | IndexedDB snapshots and schema seeds, OCR word-box checks, stroke and region geometry, pen/touch input, MoBrowser and Android bridge stubs, a11y scans |
| 7 Implementation | **Done: 909 of 916 automated** (REG-947 to REG-959, added 2026-11-10, not yet run) | the 7 others need real hardware or a screen reader (6) or macOS WebKit (1) |
| 8 Execution | Done | Run 13 (2026-11-09) full regression on the final suite: 857 tests, 752 passed, 104 known defects, 0 failed; the live suite (32 cases) on the real servers with the teacher and two student accounts, every case passed or reproduced its defect after the traced fixes; cross-browser 16/16; performance 8/8 alone; see 09 §3 |
| 9 Reporting | Done | HTML, JUnit, JSON, summary.md per run; the workbook; 08 and 09; the standalone QA-Report.html |
| 10 CI | Done (not yet run on GitHub) | `.github/workflows/ci.yml`: gate, regression in 4 shards, performance, cross-browser |
| 11 Docs | Done | README, SETUP.md (first-time setup for the team), docs 01-09 |
| 12 Final review | Done | Script review of every complex-tool and backup test (09 §3): 35 tests strengthened, a page-in-view check on every page-number check, new defect DEF-213. App review for screens no test reached (2026-11-09): REG-941 to REG-946 added, new defects DEF-514, DEF-515, DEF-516; unreachable code listed in 08 |

## Where the suite came from

It was built inside the app repository's `automation/` folder (with a few changes there to `package.json` and `.github/workflows/ci.yml`), then moved here to run on its own: its own `package.json`, Playwright and copy of the app. The app repository's CI file still describes the old layout (07, "How CI runs it"). No application source was changed. Running `npm run build` in the app on Windows rewrites five files under `public/` (LF line endings, empty content diff); restore them with `git checkout -- public/` there before committing (OBS-004).

## How the workbook and docs are rebuilt

The workbook (`docs/Cognitive-Canvas-Test-Suites.xlsx`), 08, and the manager's report (`docs/QA-Report.html` and its data files) are generated, not hand-edited. The steps are in `scripts/reporting/README.md`: point `run_config.json` at the new run's results, then run the five scripts. 04/05 come from `npm run inventory -- --results <files>`.

## Next steps, in value order

1. Raise the defects: 86 in 08, written for testers in 10 (P1 first). When a fix lands, its test reports "passed unexpectedly": remove its `knownDefect(...)` line and update the CSV status.
2. DEF-515 and DEF-516 are new on 2026-11-09. DEF-516 is on the server: until it is fixed, the QA teacher account gains about 10 stopped live shares per full live run and its list of live shares gets slower (49 s for 53). Ask for a way to delete stopped live shares, or use a fresh teacher account.
3. Run the CI jobs once on GitHub; check the four regression shards finish inside 75 minutes.
4. DEF-806 (tablet page left blank) can make REG-862 or REG-866 fail now and then until it is fixed; expect that, do not retry it away.
5. Real-device pass each release: SAN-004/005 (iPad + Pencil), SAN-006 (Muul-Android), SAN-008/009 (OS prompts, install), A11Y-007 (screen reader).
6. REG-886 (Safari gesture zoom) can be un-parked on a macOS runner.
7. The Low findings of the script review (09 §3, "Left for a next pass").
