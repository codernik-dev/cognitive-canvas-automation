"""CSV data files for the manager's QA report page, from the workbook and the run results.

  python scripts/reporting/build_report_data.py [workbook.xlsx]

Writes reports/reporting/qa-report-data/*.csv. Upload them to the report to refresh it."""
import csv, json, os, re, sys
from collections import Counter, defaultdict
import openpyxl

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
R = os.path.join(REPO, 'reports')
HERE = os.path.join(R, 'reporting', 'qa-report-data')
os.makedirs(HERE, exist_ok=True)
WB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'docs', 'Cognitive-Canvas-Test-Suites.xlsx')
wb = openpyxl.load_workbook(WB, read_only=True)


def sheet(name, header_row=1):
    rows = list(wb[name].iter_rows(values_only=True))
    h = rows[header_row - 1]
    return [dict(zip(h, r)) for r in rows[header_row:] if r and r[0]]


def write(name, cols, rows):
    with open(os.path.join(HERE, name), 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)
    print(name, len(rows), 'rows')


cases = sheet('All Test Cases')
write('cases.csv', ['id', 'suite', 'subsuite', 'module', 'title', 'priority', 'status', 'latest', 'why_not_automated'], [
    {'id': c['Test Case ID'], 'suite': c['Test Suite'], 'subsuite': c['Sub-suite'], 'module': c['Module'], 'title': c['Test Case Title'],
     'priority': c['Priority'], 'status': c['Automation Status'], 'latest': c['Latest Result'],
     'why_not_automated': '' if c['Automated?'] == 'Yes' else c['Automation Feasibility']} for c in cases])

defects = sheet('Defects Found', header_row=4)
write('defects.csv', ['id', 'priority', 'area', 'title', 'kind', 'tests'], [
    {'id': d['Defect ID'], 'priority': d['Suggested Priority'], 'area': d['Area'], 'title': d['What Is Wrong'], 'kind': d['Kind'], 'tests': d['Test Case(s)']} for d in defects])

# The full run (the first results file in run_config.json), by device project.
RUN = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'run_config.json'), encoding='utf-8'))
j = json.load(open(os.path.join(REPO, RUN['files'][0]), encoding='utf-8'))
per = defaultdict(Counter)


def visit(s):
    for sp in s.get('specs', []):
        for t in sp['tests']:
            k = ('known_defect' if t['expectedStatus'] == 'failed' else 'passed') if t['status'] == 'expected' else ('failed' if t['status'] == 'unexpected' else 'skipped')
            per[t['projectName']][k] += 1
    for x in s.get('suites', []):
        visit(x)


for s in j['suites']:
    visit(s)
LABEL = {'chromium': 'Desktop Chrome', 'phone': 'Phone (Pixel 5)', 'tablet': 'Tablet (touch)', 'ipad': 'iPad (Safari engine)', 'offline': 'Offline profile'}
write('devices.csv', ['device', 'passed', 'known_defect', 'failed', 'skipped'], [
    {'device': LABEL[p], **{k: per[p][k] for k in ('passed', 'known_defect', 'failed', 'skipped')}} for p in ['chromium', 'phone', 'tablet', 'ipad', 'offline']])

# Each unexpected failure of the full run with the cause found for it (run_config.json "failures").
failed = sum(c['failed'] for c in per.values())
traced = RUN.get('failures', [])
if len(traced) != failed:
    sys.exit(f'{RUN["name"]} has {failed} unexpected failure(s) but run_config.json traces {len(traced)}: trace each one first')
write('failures.csv', ['test', 'device', 'cause', 'verdict', 'after_recheck'], traced)

runs = sheet('Run History', header_row=4)
write('runs.csv', ['run', 'date', 'scope', 'passed', 'expected_fail', 'failed', 'duration', 'notes'], [
    {'run': r['Run'], 'date': r['Date'], 'scope': r['Scope'], 'passed': r['Passed'], 'expected_fail': r['Expected Fail'], 'failed': r['Failed'], 'duration': r['Duration'],
     'notes': r['What Happened']} for r in runs])

perf_file = os.path.join(REPO, RUN['performance'])
pj = json.load(open(perf_file, encoding='utf-8'))
seen, perf = set(), []


def pvisit(s):
    for sp in s.get('specs', []):
        tid = re.search(r'PRF-\d{3}', sp['title']).group(0)
        for t in sp['tests']:
            for a in t['annotations'] + t['results'][0].get('annotations', []):
                if a.get('type') != 'timing':
                    continue
                d = a['description']
                m = re.match(r'(.+?):? (\d+) ms \(budget (\d+)(?: ms)?\)$', d)
                if not m or m.group(1) in seen:
                    continue
                seen.add(m.group(1))
                name = {'boot': 'Cold start to the PIN screen', 'open 40 pages': 'Open a 40-page PDF to page 1 drawn',
                        'find 40 pages': 'Find a word across 40 pages'}.get(m.group(1), m.group(1)[0].upper() + m.group(1)[1:])
                perf.append({'test': tid, 'measurement': name, 'ms': int(m.group(2)), 'budget_ms': int(m.group(3))})
    for x in s.get('suites', []):
        pvisit(x)


for s in pj['suites']:
    pvisit(s)
write('perf.csv', ['test', 'measurement', 'ms', 'budget_ms'], perf)
print('perf source', perf_file)
