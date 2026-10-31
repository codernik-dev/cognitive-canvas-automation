# Reporting: the workbook, the defects document and the manager's report

These scripts turn the suite's run results into the three things people read. Nothing here runs tests or touches the app.

| Output | Built by | From |
|---|---|---|
| `automation/docs/Cognitive-Canvas-Test-Suites.xlsx` (the workbook) | `build_workbook.py` | `data/test-inventory.csv`, the test lists from `list-runs.mjs`, the results named in `run_config.json`, `defects_register.py` |
| `automation/docs/08-DEFECTS-AND-LIMITATIONS.md` | `build_defects_doc.py` | `defects_register.py`, `defects_old.json`, `defects_doc_tail.md`, the same results |
| `automation/reports/reporting/qa-report-data/*.csv` (data for the manager's report page) | `build_report_data.py` | the workbook and the results |

Requirements: Node (already needed for the suite) and Python 3 with `openpyxl` (`pip install openpyxl`).

## After a run

1. Run the tests, each into its own folder so nothing is overwritten, for example:
   ```bash
   npm run build
   CC_REPORTS_DIR=reports/run-9 npm run test:regression
   CC_REPORTS_DIR=reports/performance-9 npm run test:performance     # machine quiet, alone
   CC_REPORTS_DIR=reports/crossbrowser-9 npm run test:cross-browser
   ```
2. Trace every unexpected failure before reporting it (trace, screenshot and video are in that run's `test-results/`).
3. Edit `run_config.json`: the run's name, date and commit, the `results.json` paths (the full run first), the `performance` results file for the speed table, one `failures` entry per unexpected failure of the full run with the cause you found (the report build stops while a failure is untraced), any targeted re-runs, and one new `history` row per run.
4. New app defect? Add its write-up to `defects_register.py` (plain language: title, steps, expected, actual, suggested priority, area) and the one-line entry to `helpers/defects.ts`. The workbook build refuses to run while a test points at a defect that has no write-up.
5. Rebuild:
   ```bash
   node automation/scripts/reporting/list-runs.mjs
   python automation/scripts/reporting/build_workbook.py
   python automation/scripts/reporting/build_defects_doc.py
   python automation/scripts/reporting/build_report_data.py
   python automation/scripts/reporting/build_report_html.py   # automation/docs/QA-Report.html, to email
   npm run inventory -- --results automation/reports/run-9/results.json
   ```
6. Open the workbook in Excel once and save it, so its formulas are calculated before it is uploaded or shared.
7. Refresh the manager's report page: replace its data files with the new CSVs from `automation/reports/reporting/qa-report-data/` (or ask Claude to "refresh the QA report from the latest run"). Its link stays the same.

Close the workbook in Excel before step 5; Windows does not let a script overwrite an open file.
