"""Builds docs/Cognitive-Canvas-Test-Suites.xlsx from the inventory CSV, the Playwright --list output of
each run command (list-runs.mjs) and the run results named in run_config.json.

  python automation/scripts/reporting/build_workbook.py [out.xlsx]

Read-only over the repo except for the one output file. Needs Python 3 with openpyxl."""
import csv, json, math, os, re, sys
from collections import OrderedDict, defaultdict
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
# Listings and other generated inputs (git-ignored, under reports/).
WORK = Path(os.environ.get('CC_REPORTING_DIR', REPO / 'automation' / 'reports' / 'reporting'))
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'automation' / 'docs' / 'Cognitive-Canvas-Test-Suites.xlsx'

ID_RE = re.compile(r'\b((?:SMK|SAN|REG|PST|OFF|A11Y|PRF|API)-\d{3})\b')

# ---------- inputs ----------
inv = list(csv.DictReader(open(REPO / 'automation/data/test-inventory.csv', encoding='utf-8')))


def walk(suite, path):
    for sp in suite.get('specs', []):
        yield path, sp
    for c in suite.get('suites', []):
        yield from walk(c, path + [c['title']])


def listing(name):
    j = json.load(open(WORK / f'{name}.json', encoding='utf-8'))
    out = defaultdict(lambda: {'projects': [], 'execs': 0})
    for s in j['suites']:
        for path, sp in walk(s, [s['title']]):
            m = ID_RE.search(sp['title'])
            if not m:
                continue
            e = out[m.group(1)]
            e['file'] = 'automation/tests/' + sp['file']
            e['line'] = sp['line']
            e['group'] = ' > '.join(path[1:])
            e['tags'] = ' '.join('@' + t for t in sp['tags'])
            e['title'] = sp['title']
            for t in sp['tests']:
                e['projects'].append(t['projectName'])
                e['execs'] += 1
    return out


ALL = listing('list-all')
RUNS = OrderedDict(
    smoke=listing('smoke'), sanity=listing('sanity'), p1=listing('p1'), gate=listing('gate'),
    regression=listing('regression'), performance=listing('performance'), crossbrowser=listing('crossbrowser'), a11y=listing('a11y'), live=listing('live'),
)


PROJECT_ORDER = ['chromium', 'phone', 'tablet', 'ipad', 'offline', 'performance', 'firefox', 'webkit', 'live']


def results(paths):
    """Per test ID: list of (label, project, seconds) over every results file given."""
    out = defaultdict(list)
    for p in paths:
        j = json.load(open(REPO / p, encoding='utf-8'))
        for s in j['suites']:
            for _, sp in walk(s, []):
                m = ID_RE.search(sp['title'])
                if not m:
                    continue
                for t in sp['tests']:
                    known = t['expectedStatus'] == 'failed'
                    st = t['status']
                    if st == 'expected':
                        label = 'Expected fail reproduced' if known else 'Passed'
                    elif st == 'unexpected':
                        label = 'Passed unexpectedly (defect fixed?)' if known else 'Failed'
                    elif st == 'flaky':
                        label = 'Flaky'
                    else:
                        label = 'Skipped'
                    out[m.group(1)].append((label, t['projectName'], sum(r['duration'] for r in t['results']) / 1000))
    return out


def overall(execs):
    """One result per test case across its projects: a failure wins, then unexpected pass, flaky, skipped, expected fail, passed."""
    labels = [e[0] for e in execs]
    for lab in ('Failed', 'Passed unexpectedly (defect fixed?)', 'Flaky', 'Skipped'):
        if lab in labels:
            return lab
    return 'Expected fail reproduced' if all(l == 'Expected fail reproduced' for l in labels) else 'Passed'


# The final full run: xl/final_run.json = {"name", "date", "label", "files": [results.json], "reruns": [{"name", "files"}]}.
FINAL_RUN = json.load(open(HERE / 'run_config.json', encoding='utf-8'))
FINAL = results(FINAL_RUN['files'])
RERUNS = [(r['name'], results(r['files'])) for r in FINAL_RUN.get('reruns', [])]
FR = f"{FINAL_RUN['name']} Result"
FD = f"{FINAL_RUN['name']} Duration (s)"

# ---------- defects ----------
sys.path.insert(0, str(HERE))
from defects_register import NEW as NEW_DEFECTS  # noqa: E402
OLD_DEFECTS = json.load(open(HERE / 'defects_old.json', encoding='utf-8'))
DEFECTS = OrderedDict((d['id'], d) for d in OLD_DEFECTS + NEW_DEFECTS)
PRI_RANK = {'P1': 0, 'P2': 1, 'P3': 2}

# Which test asserts which defect. First the run itself: knownDefect() records a
# 'known-defect' annotation on every test it marks, data-driven tests included.
DEFECT_OF = {}
for p in FINAL_RUN['files']:
    def _visit(s):
        for sp in s.get('specs', []):
            m = ID_RE.search(sp['title'])
            for t in sp['tests']:
                for a in t.get('annotations', []):
                    d = re.match(r'(DEF-\d{3})', a.get('description', '')) if a.get('type') == 'known-defect' else None
                    if m and d and d.group(1) not in DEFECT_OF.setdefault(m.group(1), []):
                        DEFECT_OF[m.group(1)].append(d.group(1))
        for c in s.get('suites', []):
            _visit(c)
    for s in json.load(open(REPO / p, encoding='utf-8'))['suites']:
        _visit(s)
# Then the literal knownDefect('DEF-nnn') calls in each test body, for tests the run did not include.
TEST_RE = re.compile(r"\btest(?:\.\w+)?\(\s*['\"`]((?:SMK|SAN|REG|PST|OFF|A11Y|PRF|API)-\d{3})\b")
for spec in sorted((REPO / 'automation/tests').rglob('*.spec.ts')):
    current = None
    for line in spec.read_text(encoding='utf-8').splitlines():
        m = TEST_RE.search(line)
        if m:
            current = m.group(1)
        for d in re.findall(r"knownDefect\(\s*'(DEF-\d{3})'", line):
            if current and current not in DEFECT_OF:
                DEFECT_OF.setdefault(f'__scan__{current}', [])
                if d not in DEFECT_OF[f'__scan__{current}']:
                    DEFECT_OF[f'__scan__{current}'].append(d)
for k in [k for k in DEFECT_OF if k.startswith('__scan__')]:
    DEFECT_OF.setdefault(k[len('__scan__'):], DEFECT_OF.pop(k))
TESTS_OF = defaultdict(list)
for t, ds in sorted(DEFECT_OF.items()):
    for d in ds:
        TESTS_OF[d].append(t)
missing = sorted(set(TESTS_OF) - set(DEFECTS))
if os.environ.get('XL_DRY'):  # generator self-test only: stand-ins for defects not written up yet
    for d in missing:
        DEFECTS[d] = dict(id=d, pri='P3', module='?', title='(dry run placeholder)', steps=[], expected='', actual='')
    missing = []
assert not missing, f'defects asserted by tests but missing from the register: {missing}'

FOLDER_SUB = {'smoke': 'Smoke', 'sanity': 'Sanity', 'regression': 'Functional', 'responsive': 'Responsive (phone/tablet/iPad)', 'live': 'Live (real servers)',
              'api': 'API / Integrations', 'persistence': 'Persistence', 'offline': 'Offline', 'accessibility': 'Accessibility', 'performance': 'Performance'}
PREFIX_SUB = {'SMK': 'Smoke', 'SAN': 'Sanity', 'REG': 'Functional', 'API': 'API / Integrations', 'PST': 'Persistence',
              'OFF': 'Offline', 'A11Y': 'Accessibility', 'PRF': 'Performance'}
SUB_ORDER = ['Smoke', 'Sanity', 'Functional', 'Responsive (phone/tablet/iPad)', 'Live (real servers)', 'API / Integrations', 'Persistence', 'Offline', 'Accessibility', 'Performance']

# ---------- rows ----------
rows = []
for r in inv:
    cid = r['id']
    a = ALL.get(cid)
    auto = r['status'].startswith('Automated')
    # Automated means a test carries the ID; a Blocked case may also have a placeholder test parked with test.fixme().
    assert auto <= bool(a), cid
    parked = bool(a) and not auto
    known = 'known defect' in r['status']
    status = 'Automated (expected fail)' if known else ('Automated' if auto else r['status'])
    folder = a['file'].split('/')[2] if a else None
    sub = FOLDER_SUB[folder] if a else PREFIX_SUB[cid.split('-')[0]]
    steps = [s.strip() for s in r['steps'].split(';') if s.strip()]
    steps_txt = '\n'.join(f'{i}. {s[0].upper() + s[1:]}' for i, s in enumerate(steps, 1)) if len(steps) > 1 else (steps[0] if steps else '')
    projects = sorted(set(a['projects']), key=PROJECT_ORDER.index) if a else []
    yn = lambda k: 'Yes' if cid in RUNS[k] else 'No'
    notes = []
    if cid in FINAL:
        execs = FINAL[cid]
        fr, fdur = overall(execs), sum(e[2] for e in execs)
        if len({e[0] for e in execs}) > 1:
            notes.append('By browser/project: ' + '; '.join(f'{p}: {lab}' for lab, p, _ in execs))
    elif auto:
        fr, fdur = f"Not in {FINAL_RUN['name']}", None
    else:
        fr, fdur = 'Not automated', None
    latest, src = fr, (f"{FINAL_RUN['name']} ({FINAL_RUN['date']})" if cid in FINAL else '')
    for name, rr in RERUNS:
        if cid in rr:
            latest, src = overall(rr[cid]), name
            notes.append(f'{FINAL_RUN["name"]}: {fr}. Re-run "{name}": {latest}.')
    if latest == 'Not automated':
        latest = 'Not run'
    defs = DEFECT_OF.get(cid, [])
    if known:
        assert defs, f'{cid} is marked known defect but its test calls no knownDefect()'
        notes.append(f'The test checks the correct behaviour and is marked as expected to fail until app defect {", ".join(defs)} is fixed.')
    if not auto:
        notes.append(f'Why not automated: {r["feasibility"]}')
    if parked:
        notes.append('A placeholder test with this ID is parked (test.fixme) and reports as Skipped, so the case is picked up as soon as the blocker goes.')
    rows.append(OrderedDict([
        ('Test Case ID', cid), ('Test Suite', r['suite']), ('Sub-suite', sub), ('Module', r['module']), ('Feature', r['feature']),
        ('Test Case Title', r['title']), ('Preconditions', r['preconditions']), ('Test Data', r['test_data']), ('Test Steps', steps_txt),
        ('Expected Result', r['expected']), ('Priority', r['priority']), ('Test Type', r['type']), ('Automation Feasibility', r['feasibility']),
        ('Automation Status', status), ('Automated?', 'Yes' if auto else 'No'), ('Known Defect', ', '.join(defs)),
        ('Automation Script (spec file)', a['file'] if a else ''), ('Line', a['line'] if a else None), ('Test Group (describe block)', a['group'] if a else ''),
        ('Tags', a['tags'] if a else ''), ('Browser / Project', ', '.join(projects)),
        ('In Smoke Run', yn('smoke')), ('In Sanity Run', yn('sanity')), ('In P1 Run', yn('p1')), ('In CI PR Gate', yn('gate')),
        ('In Regression Run', yn('regression')), ('In Performance Run', yn('performance')), ('In Cross-browser Run', yn('crossbrowser')), ('In Live Run', yn('live')),
        (FR, fr), (FD, round(fdur, 1) if fdur is not None else None),
        ('Latest Result', latest), ('Latest Result From', src), ('Notes', '\n'.join(notes)), ('Requirement / Source Reference', r['source']),
    ]))

COLS = list(rows[0].keys())
COL = {c: get_column_letter(i + 1) for i, c in enumerate(COLS)}
N = len(rows)
LAST = N + 1
MS = "'All Test Cases'"


def rng(col):
    return f"{MS}!${COL[col]}$2:${COL[col]}${LAST}"


# ---------- styles ----------
FONT = 'Arial'
NAVY = '1F3864'
f_base = Font(name=FONT, size=10)
f_bold = Font(name=FONT, size=10, bold=True)
f_head = Font(name=FONT, size=10, bold=True, color='FFFFFF')
f_title = Font(name=FONT, size=16, bold=True, color=NAVY)
f_sec = Font(name=FONT, size=12, bold=True, color=NAVY)
f_note = Font(name=FONT, size=9, italic=True, color='595959')
fill_head = PatternFill('solid', fgColor=NAVY)
fill_total = PatternFill('solid', fgColor='D9E1F2')
fill_band = PatternFill('solid', fgColor='F2F2F2')
thin = Side(style='thin', color='BFBFBF')
border = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap_top = Alignment(wrap_text=True, vertical='top')
center = Alignment(horizontal='center', vertical='top', wrap_text=True)
STATUS_FILL = {
    'Automated': ('C6EFCE', '006100'), 'Automated (expected fail)': ('FFEB9C', '7F6000'), 'Planned': ('DDEBF7', '1F4E78'),
    'Manual': ('EDEDED', '404040'), 'Blocked': ('FFC7CE', '9C0006'),
    'Passed': ('C6EFCE', '006100'), 'Expected fail reproduced': ('FFEB9C', '7F6000'), 'Failed': ('FFC7CE', '9C0006'),
    'Flaky': ('FCE4D6', '833C0B'), 'Passed unexpectedly (defect fixed?)': ('DDEBF7', '1F4E78'), 'Skipped': ('EDEDED', '404040'),
    'Yes': ('E2EFDA', '375623'),
}
WIDTHS = {
    'Test Case ID': 11, 'Test Suite': 11, 'Sub-suite': 16, 'Module': 14, 'Feature': 18, 'Test Case Title': 44, 'Preconditions': 30,
    'Test Data': 24, 'Test Steps': 40, 'Expected Result': 48, 'Priority': 8, 'Test Type': 18, 'Automation Feasibility': 30,
    'Automation Status': 15, 'Automated?': 10, 'Known Defect': 10, 'Automation Script (spec file)': 36, 'Line': 6,
    'Test Group (describe block)': 28, 'Tags': 24, 'Browser / Project': 13, 'In Smoke Run': 8, 'In Sanity Run': 8, 'In P1 Run': 8,
    'In CI PR Gate': 8, 'In Regression Run': 10, 'In Performance Run': 11, 'In Cross-browser Run': 11, 'In Live Run': 8,
    FR: 18, FD: 9, 'Latest Result': 15, 'Latest Result From': 22, 'Notes': 48,
    'Requirement / Source Reference': 40, 'Inventory Suite': 11, 'Why In This Run': 30,
}
CENTERED = {'Test Case ID', 'Priority', 'Automated?', 'Known Defect', 'Line', 'In Smoke Run', 'In Sanity Run', 'In P1 Run', 'In CI PR Gate',
            'In Regression Run', 'In Performance Run', 'In Cross-browser Run', FD, 'Test Suite', 'Inventory Suite'}


def lines_needed(text, width):
    if text is None:
        return 1
    chars = max(width * 1.15, 4)
    return sum(max(1, math.ceil(len(part) / chars)) for part in str(text).split('\n'))


def write_table(ws, cols, data, name, start_row=1, freeze='C2', style=True):
    for j, c in enumerate(cols, 1):
        cell = ws.cell(row=start_row, column=j, value=c)
        cell.font, cell.fill, cell.alignment, cell.border = f_head, fill_head, Alignment(wrap_text=True, vertical='center', horizontal='center'), border
        ws.column_dimensions[get_column_letter(j)].width = WIDTHS.get(c, 14)
    ws.row_dimensions[start_row].height = 30
    for i, rec in enumerate(data, start_row + 1):
        h = 1
        for j, c in enumerate(cols, 1):
            v = rec[c]
            cell = ws.cell(row=i, column=j, value=v)
            cell.font, cell.border = f_base, border
            cell.alignment = center if c in CENTERED else wrap_top
            if c in ('Automation Status', FR, 'Latest Result') or c.startswith('In '):
                if v in STATUS_FILL:
                    bg, fg = STATUS_FILL[v]
                    cell.fill = PatternFill('solid', fgColor=bg)
                    cell.font = Font(name=FONT, size=10, color=fg, bold=c == 'Automation Status')
            if c == 'Test Case ID':
                cell.font = f_bold
            h = max(h, lines_needed(v, WIDTHS.get(c, 14)))
        ws.row_dimensions[i].height = min(13.5 * h + 3, 300)
    end = start_row + len(data)
    if style and data:
        t = Table(displayName=name, ref=f'A{start_row}:{get_column_letter(len(cols))}{end}')
        t.tableStyleInfo = TableStyleInfo(name='TableStyleLight1', showRowStripes=False)
        ws.add_table(t)
    if freeze:
        ws.freeze_panes = freeze
    return end


wb = Workbook()

# ---------- Summary ----------
S = wb.active
S.title = 'Summary'
S.sheet_view.showGridLines = False
for col, w in zip('ABCDEFGHIJKLM', [30, 22, 24, 24, 12, 12, 14, 14, 30, 30, 10, 10, 10]):
    S.column_dimensions[col].width = w

S['A1'] = 'Cognitive Canvas: Automation Test Suites'
S['A1'].font = f_title
S['A2'] = (f"Build under test: commit {FINAL_RUN['commit']}, branch {FINAL_RUN['branch']}. Prepared {FINAL_RUN['date']}. "
           'Every number on this sheet is a formula over the "All Test Cases" sheet unless a note says otherwise.')
S['A2'].font = f_note
row = 4


def section(title, note=None):
    global row
    S.cell(row=row, column=1, value=title).font = f_sec
    row += 1
    if note:
        c = S.cell(row=row, column=1, value=note)
        c.font = f_note
        S.merge_cells(start_row=row, start_column=1, end_row=row, end_column=12)
        c.alignment = Alignment(wrap_text=True, vertical='top')
        S.row_dimensions[row].height = 13 * max(1, math.ceil(len(note) / 150)) + 2
        row += 1


def header(cols):
    global row
    for j, c in enumerate(cols, 1):
        cell = S.cell(row=row, column=j, value=c)
        cell.font, cell.fill, cell.border = f_head, fill_head, border
        cell.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center' if j > 1 else 'left')
    S.row_dimensions[row].height = 13.5 * max(lines_needed(c, S.column_dimensions[get_column_letter(j)].width) for j, c in enumerate(cols, 1)) + 6
    row += 1


def put(vals, total=False, fmt=None):
    global row
    for j, v in enumerate(vals, 1):
        cell = S.cell(row=row, column=j, value=v)
        cell.font = f_bold if total or j == 1 else f_base
        cell.border = border
        cell.alignment = Alignment(horizontal='left' if j == 1 else 'center', vertical='top', wrap_text=True)
        if total:
            cell.fill = fill_total
        if fmt and j in fmt:
            cell.number_format = fmt[j]
    text = [(v, S.column_dimensions[get_column_letter(j)].width) for j, v in enumerate(vals, 1) if isinstance(v, str) and not v.startswith('=')]
    S.row_dimensions[row].height = 13.5 * max([lines_needed(v, w) for v, w in text] or [1]) + 3
    row += 1


def cif(*pairs):
    parts = ','.join(f'{rng(c)},"{v}"' for c, v in pairs)
    return f'COUNTIFS({parts})'


# 1. by suite
section('1. Test cases by suite',
        'A test case counts as Automated when a Playwright test carries its ID and checks the expected result. "Expected fail" tests are automated tests that check the correct behaviour '
        'and are expected to fail until a known app defect is fixed. Not automated = Planned + Manual + Blocked.')
header(['Test suite', 'Total cases', 'Automated', 'of which expected fail (known defect)', 'Planned', 'Manual', 'Blocked', 'Not automated', 'Automation coverage', 'P1', 'P2', 'P3'])
first = row
for suite in ['Smoke', 'Sanity', 'Regression']:
    r_ = row
    put([suite, f'={cif(("Test Suite", suite))}', f'={cif(("Test Suite", suite), ("Automated?", "Yes"))}',
         f'={cif(("Test Suite", suite), ("Automation Status", "Automated (expected fail)"))}',
         f'={cif(("Test Suite", suite), ("Automation Status", "Planned"))}', f'={cif(("Test Suite", suite), ("Automation Status", "Manual"))}',
         f'={cif(("Test Suite", suite), ("Automation Status", "Blocked"))}', f'=B{r_}-C{r_}', f'=IF(B{r_}=0,0,C{r_}/B{r_})',
         f'={cif(("Test Suite", suite), ("Priority", "P1"))}', f'={cif(("Test Suite", suite), ("Priority", "P2"))}', f'={cif(("Test Suite", suite), ("Priority", "P3"))}'],
        fmt={9: '0%'})
last = row - 1
put(['Total'] + [f'=SUM({get_column_letter(j)}{first}:{get_column_letter(j)}{last})' for j in range(2, 9)] + [f'=IF(B{row}=0,0,C{row}/B{row})']
    + [f'=SUM({get_column_letter(j)}{first}:{get_column_letter(j)}{last})' for j in range(10, 13)], total=True, fmt={9: '0%'})
TOTAL_ROW = row - 1
row += 1

# 2. regression by sub-suite
section('2. Regression suite by sub-suite (where the scripts live)',
        'The Regression suite is split into sub-suites by folder under automation/tests. "Functional" is the module-wise folder automation/tests/regression, one spec file per module.')
header(['Regression sub-suite', 'Total cases', 'Automated', 'of which expected fail (known defect)', 'Not automated', 'Automation coverage', 'P1 cases', 'P1 automated', 'Script folder'])
FOLDER_OF = {'Functional': 'automation/tests/regression', 'Responsive (phone/tablet/iPad)': 'automation/tests/responsive', 'Live (real servers)': 'automation/tests/live', 'API / Integrations': 'automation/tests/api',
             'Persistence': 'automation/tests/persistence', 'Offline': 'automation/tests/offline', 'Accessibility': 'automation/tests/accessibility', 'Performance': 'automation/tests/performance'}
first = row
for sub in SUB_ORDER[2:]:
    r_ = row
    put([sub, f'={cif(("Test Suite", "Regression"), ("Sub-suite", sub))}', f'={cif(("Test Suite", "Regression"), ("Sub-suite", sub), ("Automated?", "Yes"))}',
         f'={cif(("Test Suite", "Regression"), ("Sub-suite", sub), ("Automation Status", "Automated (expected fail)"))}', f'=B{r_}-C{r_}', f'=IF(B{r_}=0,0,C{r_}/B{r_})',
         f'={cif(("Test Suite", "Regression"), ("Sub-suite", sub), ("Priority", "P1"))}', f'={cif(("Test Suite", "Regression"), ("Sub-suite", sub), ("Priority", "P1"), ("Automated?", "Yes"))}',
         FOLDER_OF[sub]], fmt={6: '0%'})
last = row - 1
put(['Regression total'] + [f'=SUM({get_column_letter(j)}{first}:{get_column_letter(j)}{last})' for j in range(2, 6)] + [f'=IF(B{row}=0,0,C{row}/B{row})']
    + [f'=SUM({get_column_letter(j)}{first}:{get_column_letter(j)}{last})' for j in range(7, 9)] + [''], total=True, fmt={6: '0%'})
S.cell(row=row - 1, column=9).alignment = Alignment(horizontal='left')
for r_ in range(first, row):
    S.cell(row=r_, column=9).alignment = Alignment(horizontal='left', vertical='top')
row += 1

# 3. what each run executes
section('3. What each run executes',
        'Smoke and Sanity runs pick tests by tag, so the Sanity run also includes regression test cases tagged @sanity. The Regression run is the full suite: it runs every automated test, '
        'smoke and sanity included, on desktop Chrome, a phone, a tablet, an iPad (WebKit) and an offline profile. "Test cases" counts unique IDs (formula); "Test executions" counts '
        f'test-and-browser combinations from the Playwright test list taken on {FINAL_RUN["date"]} (fixed value).')
header(['Run', 'npm command', 'Browser / project', 'How tests are picked', 'Test cases', 'Test executions', 'of which from Smoke suite', 'from Sanity suite', 'from Regression suite', 'When it runs in CI'])
RUN_ROWS = [
    ('Smoke run', 'npm run test:smoke', 'chromium', 'Tag @smoke', 'In Smoke Run', RUNS['smoke'], 'Every push and pull request (inside the PR gate)'),
    ('Sanity run', 'npm run test:sanity', 'chromium, phone, tablet, ipad, offline', 'Tag @sanity (1-3 key checks per module)', 'In Sanity Run', RUNS['sanity'],
     'Every push and pull request inside the PR gate (chromium, phone, offline part); the tablet and iPad part nightly'),
    ('P1 run', 'npm run test:p1', 'chromium, phone, tablet, ipad, offline', 'Tag @P1', 'In P1 Run', RUNS['p1'],
     'Every push and pull request inside the PR gate (chromium, phone, offline part); the tablet and iPad part nightly'),
    ('CI PR gate', '(CI job automation-gate)', 'chromium, phone, offline', 'Tag @smoke or @sanity or @P1', 'In CI PR Gate', RUNS['gate'], 'Every push and pull request'),
    ('Regression run (full)', 'npm run test:regression', 'chromium, phone, tablet, ipad, offline', 'Everything except performance', 'In Regression Run', RUNS['regression'], 'Nightly, manual trigger, and every push to main'),
    ('Performance run', 'npm run test:performance', 'performance (1 worker, alone)', 'Folder tests/performance', 'In Performance Run', RUNS['performance'], 'After the nightly regression run'),
    ('Cross-browser run', 'npm run test:cross-browser', 'firefox, webkit', 'Smoke tests only', 'In Cross-browser Run', RUNS['crossbrowser'], 'Nightly and manual trigger'),
    ('Live run (real servers)', 'npm run test:live', 'live (1 worker)', 'Folder tests/live; needs the QA account in the environment', 'In Live Run', RUNS['live'], 'On demand only (needs the QA account)'),
]
RUN_ROW_AT = {}
for name, cmd, proj, pick, col, lst, when in RUN_ROWS:
    RUN_ROW_AT[name] = row
    put([name, cmd, proj, pick, f'=COUNTIF({rng(col)},"Yes")', sum(e['execs'] for e in lst.values()),
         f'={cif((col, "Yes"), ("Test Suite", "Smoke"))}', f'={cif((col, "Yes"), ("Test Suite", "Sanity"))}', f'={cif((col, "Yes"), ("Test Suite", "Regression"))}', when])
    for j in (2, 3, 4, 10):
        S.cell(row=row - 1, column=j).alignment = Alignment(horizontal='left', vertical='top', wrap_text=True)
row += 1

# 4. results
section(f"4. Results of {FINAL_RUN['name']}",
        FINAL_RUN['label'] + " \"Latest\" is the same unless a later targeted re-run replaced a test's result (see the Latest Result From column).")
header(['Run', 'Test cases in run', f"Passed ({FINAL_RUN['name']})", f"Expected fail ({FINAL_RUN['name']})", f"Failed ({FINAL_RUN['name']})",
        f"Flaky / skipped / other ({FINAL_RUN['name']})", 'Passed (latest)', 'Expected fail (latest)', 'Failed (latest)'])
for name, cmd, proj, pick, col, lst, when in RUN_ROWS:
    r_ = row
    put([name, f'=E{RUN_ROW_AT[name]}', f'={cif((col, "Yes"), (FR, "Passed"))}', f'={cif((col, "Yes"), (FR, "Expected fail reproduced"))}', f'={cif((col, "Yes"), (FR, "Failed"))}',
         f'=B{r_}-C{r_}-D{r_}-E{r_}',
         f'={cif((col, "Yes"), ("Latest Result", "Passed"))}', f'={cif((col, "Yes"), ("Latest Result", "Expected fail reproduced"))}', f'={cif((col, "Yes"), ("Latest Result", "Failed"))}'])
row += 1

# 5. module x suite
section('5. Test cases by module and suite',
        'Module comes from the test-case inventory. A module can appear in more than one suite: its core journey in Smoke, its quick checks in Sanity and the full detail in Regression.')
header(['Module', 'Smoke', 'Sanity', 'Regression', 'Total cases', 'Automated', 'of which expected fail', 'Not automated', 'Automation coverage', 'P1 cases', 'P1 automated'])
first = row
for m in sorted({r['Module'] for r in rows}, key=lambda m: (-sum(1 for r in rows if r['Module'] == m), m)):
    r_ = row
    put([m, f'={cif(("Module", m), ("Test Suite", "Smoke"))}', f'={cif(("Module", m), ("Test Suite", "Sanity"))}', f'={cif(("Module", m), ("Test Suite", "Regression"))}',
         f'=SUM(B{r_}:D{r_})', f'={cif(("Module", m), ("Automated?", "Yes"))}', f'={cif(("Module", m), ("Automation Status", "Automated (expected fail)"))}',
         f'=E{r_}-F{r_}', f'=IF(E{r_}=0,0,F{r_}/E{r_})', f'={cif(("Module", m), ("Priority", "P1"))}', f'={cif(("Module", m), ("Priority", "P1"), ("Automated?", "Yes"))}'],
        fmt={9: '0%'})
last = row - 1
put(['Total'] + [f'=SUM({get_column_letter(j)}{first}:{get_column_letter(j)}{last})' for j in range(2, 9)] + [f'=IF(E{row}=0,0,F{row}/E{row})']
    + [f'=SUM({get_column_letter(j)}{first}:{get_column_letter(j)}{last})' for j in range(10, 12)], total=True, fmt={9: '0%'})
row += 1
S.cell(row=row, column=1, value='Check: module total equals suite total').font = f_note
S.cell(row=row, column=2, value=f'=IF(E{row - 2}=B{TOTAL_ROW},"OK","MISMATCH")').font = f_note
S.freeze_panes = 'A4'

# ---------- Suite Structure ----------
ST = wb.create_sheet('Suite Structure')
ST.sheet_view.showGridLines = False
files = OrderedDict()
for cid, e in sorted(ALL.items(), key=lambda kv: (kv[1]['file'], kv[1]['line'])):
    files.setdefault(e['file'], []).append(cid)
FILE_ORDER = ['smoke', 'sanity', 'regression', 'responsive', 'live', 'api', 'persistence', 'offline', 'accessibility', 'performance']
by_id = {r['Test Case ID']: r for r in rows}
srows = []
for f in sorted(files, key=lambda f: (FILE_ORDER.index(f.split('/')[2]), f)):
    ids = files[f]
    groups = list(OrderedDict.fromkeys(ALL[i]['group'] for i in ids))
    mods = list(OrderedDict.fromkeys(by_id[i]['Module'] for i in ids))
    suites = list(OrderedDict.fromkeys(by_id[i]['Test Suite'] for i in ids))
    picked = [n for n, _, _, _, col, lst, _ in RUN_ROWS if any(i in lst for i in ids)]
    projects = sorted({p for i in ids for p in ALL[i]['projects']}, key=PROJECT_ORDER.index)
    srows.append(OrderedDict([
        ('Test Suite', ' + '.join(suites)), ('Sub-suite', FOLDER_SUB[f.split('/')[2]]), ('Test Suite File (spec)', f),
        ('Modules Covered', ', '.join(mods)), ('Test Groups In File', '\n'.join(groups)), ('Test Case IDs', ', '.join(ids)),
        ('Tests In File', None), ('P1 Tests', None), ('Expected-fail Tests', None), ('Browser / Project', ', '.join(projects)), ('Picked Up By', '\n'.join(picked)),
    ]))
WIDTHS.update({'Test Suite File (spec)': 44, 'Modules Covered': 24, 'Test Groups In File': 40, 'Test Case IDs': 34, 'Tests In File': 9, 'P1 Tests': 8,
               'Expected-fail Tests': 10, 'Picked Up By': 24})
ST['A1'] = 'Where every automated test lives'
ST['A1'].font = f_title
ST['A2'] = ('One row per spec file. Smoke and Sanity have their own folders; Regression is module-wise, one spec file per module. A Sanity run also picks up regression tests tagged '
            '@sanity, so a regression file can feed the Sanity run (see "Picked Up By"). Test counts are formulas over the "All Test Cases" sheet.')
ST['A2'].font = f_note
ST.merge_cells('A2:K2')
ST['A2'].alignment = Alignment(wrap_text=True, vertical='top')
ST.row_dimensions[2].height = 28
end = write_table(ST, list(srows[0].keys()), srows, 'SuiteFiles', start_row=4, freeze='D5')
spec_col = COL['Automation Script (spec file)']
for i in range(5, end + 1):
    ST[f'G{i}'] = f"=COUNTIF({MS}!${spec_col}$2:${spec_col}${LAST},C{i})"
    ST[f'H{i}'] = f'=COUNTIFS({MS}!${spec_col}$2:${spec_col}${LAST},C{i},{rng("Priority")},"P1")'
    ST[f'I{i}'] = f'=COUNTIFS({MS}!${spec_col}$2:${spec_col}${LAST},C{i},{rng("Automation Status")},"Automated (expected fail)")'
    for c in 'GHI':
        ST[f'{c}{i}'].font, ST[f'{c}{i}'].border, ST[f'{c}{i}'].alignment = f_base, border, center
tr = end + 1
ST.cell(row=tr, column=1, value='Total automated tests').font = f_bold
for c in 'GHI':
    ST[f'{c}{tr}'] = f'=SUM({c}5:{c}{end})'
    ST[f'{c}{tr}'].font, ST[f'{c}{tr}'].fill, ST[f'{c}{tr}'].alignment, ST[f'{c}{tr}'].border = f_bold, fill_total, center, border

# ---------- per-suite sheets ----------
SUITE_COLS = ['Test Case ID', 'Sub-suite', 'Module', 'Feature', 'Test Case Title', 'Preconditions', 'Test Data', 'Test Steps', 'Expected Result', 'Priority',
              'Test Type', 'Automation Status', 'Known Defect', 'Automation Script (spec file)', 'Test Group (describe block)', 'Tags', 'Browser / Project',
              FR, 'Latest Result', 'Notes']
sort_key = lambda r: (SUB_ORDER.index(r['Sub-suite']), r['Module'], r['Test Case ID'])

sm = wb.create_sheet('Smoke Suite')
write_table(sm, SUITE_COLS, sorted([r for r in rows if r['Test Suite'] == 'Smoke'], key=sort_key), 'SmokeSuite')

sa = wb.create_sheet('Sanity Suite')
san_rows = []
for r in rows:
    if r['Test Suite'] == 'Sanity' or r['In Sanity Run'] == 'Yes':
        d = OrderedDict(r)
        d['Inventory Suite'] = r['Test Suite']
        if r['Test Suite'] == 'Sanity':
            d['Why In This Run'] = 'Sanity suite case' + ('' if r['Automated?'] == 'Yes' else ' (not automated: checked by hand)')
        else:
            d['Why In This Run'] = 'Regression case tagged @sanity, so the Sanity run picks it up as a quick check of its module'
        san_rows.append(d)
san_rows.sort(key=lambda r: (r['Inventory Suite'] != 'Sanity', r['Module'], r['Test Case ID']))
write_table(sa, ['Test Case ID', 'Inventory Suite', 'Why In This Run'] + SUITE_COLS[1:], san_rows, 'SanitySuite', freeze='D2')

rg = wb.create_sheet('Regression Suite')
write_table(rg, SUITE_COLS, sorted([r for r in rows if r['Test Suite'] == 'Regression'], key=sort_key), 'RegressionSuite')

# ---------- master ----------
ms = wb.create_sheet('All Test Cases')
write_table(ms, COLS, sorted(rows, key=lambda r: (['Smoke', 'Sanity', 'Regression'].index(r['Test Suite']), SUB_ORDER.index(r['Sub-suite']), r['Module'], r['Test Case ID'])), 'AllTestCases')

# ---------- not automated ----------
na = wb.create_sheet('Not Automated')
na_cols = ['Test Case ID', 'Test Suite', 'Sub-suite', 'Module', 'Feature', 'Test Case Title', 'Priority', 'Automation Status', 'Automation Feasibility', 'Expected Result']
write_table(na, na_cols, sorted([r for r in rows if r['Automated?'] == 'No'], key=lambda r: (r['Priority'], r['Automation Status'], r['Test Case ID'])), 'NotAutomated')

# ---------- defects ----------
kd = wb.create_sheet('Defects Found')
kd['A1'] = 'App defects found by the automation (most severe first)'
kd['A1'].font = f_title
kd['A2'] = ('Each defect is written so it can be raised as it stands: steps, what should happen, what happens. Priorities are suggestions. "Expected fail" defects have an '
            'automated test that checks the correct behaviour and is marked as expected to fail: when the fix lands the test passes unexpectedly and the run flags it, so the marker '
            'can be removed. "Intermittent" defects were seen but cannot be reproduced on demand, so no test is marked for them. None has been filed as a GitHub issue; raising them is '
            "the QA owner's call.")
kd['A2'].font = f_note
kd.merge_cells('A2:J2')
kd['A2'].alignment = Alignment(wrap_text=True, vertical='top')
kd.row_dimensions[2].height = 42
WIDTHS.update({'Defect ID': 10, 'Suggested Priority': 10, 'Area': 16, 'What Is Wrong': 44, 'Steps To Reproduce': 52, 'Expected': 40, 'Actual': 48,
               'Test Case(s)': 16, 'Kind': 13, 'Result In Final Run': 22})
by_id_row = {r['Test Case ID']: r for r in rows}
kd_rows = []
for d in sorted(DEFECTS.values(), key=lambda d: (PRI_RANK[d['pri']], d.get('kind') == 'intermittent', d['id'])):
    tests = TESTS_OF.get(d['id'], [])
    kind = 'Intermittent' if d.get('kind') == 'intermittent' else 'Expected fail'
    if kind == 'Expected fail':
        assert tests, f"{d['id']} has no test calling knownDefect()"
        res = sorted({by_id_row[t][FR] for t in tests if t in by_id_row})
        res_txt = ', '.join(res)
    else:
        res_txt = 'Not reproducible on demand'
    steps = d['steps']
    kd_rows.append(OrderedDict([
        ('Defect ID', d['id']), ('Suggested Priority', d['pri']), ('Area', d.get('module', '')), ('What Is Wrong', d['title']),
        ('Steps To Reproduce', '\n'.join(f'{i}. {x}' for i, x in enumerate(steps, 1)) if len(steps) > 1 else (steps[0] if steps else '')),
        ('Expected', d.get('expected', '')), ('Actual', d.get('actual', '') + (('\n' + ' '.join(d['extra'])) if d.get('extra') else '')),
        ('Test Case(s)', ', '.join(tests) if tests else d.get('tests', '')), ('Kind', kind), ('Result In Final Run', res_txt),
    ]))
CENTERED.update({'Defect ID', 'Suggested Priority', 'Kind'})
write_table(kd, list(kd_rows[0].keys()), kd_rows, 'DefectsFound', start_row=4, freeze='B5')

# ---------- run history ----------
rh = wb.create_sheet('Run History')
rh['A1'] = 'Every recorded run'
rh['A1'].font = f_title
rh['A2'] = 'Copied from the run summaries saved after each run (automation/docs/09-FINAL-QA-REPORT.md). Runs 1-6 used 4 workers; later runs used 1 or 2.'
rh['A2'].font = f_note
HIST = [
    ('Run 1', '2026-10-29', 'Full regression (chromium, phone, tablet, offline; performance included)', 112, 8, 1, 0, '7 min 43 s', 'REG-037: the wait for a toast was shorter than two uploads take under load. Test code fixed.'),
    ('Run 2', '2026-10-29', 'Same as Run 1', 111, 8, 2, 0, '6 min 46 s', 'PRF-002 and PRF-003: timings taken next to three busy workers. Performance moved to its own one-worker run.'),
    ('Cross-browser', '2026-10-29', 'Smoke on Firefox and WebKit', 16, 0, 0, 0, '1 min 7 s', ''),
    ('Run 3', '2026-10-30', 'Full regression (performance excluded)', 107, 8, 3, 0, '10 min 8 s', 'REG-064, REG-078, REG-017: the first-launch Catalog opened late and covered the screen (app race, OBS-009). Test setup now waits for it.'),
    ('Performance 1', '2026-10-30', '3 performance budgets, alone, 1 worker', 3, 0, 0, 0, '38 s', ''),
    ('Run 4', '2026-10-30', 'Full regression (performance excluded)', 109, 8, 1, 0, '9 min 51 s', 'REG-062: page 1 took over 10 s to draw on a loaded machine. Wait raised to 30 s; draw speed is still checked by PRF-002.'),
    ('Performance 2', '2026-10-30', '3 performance budgets, alone, 1 worker', 3, 0, 0, 0, '14 s', 'Boot 0.58 s, open 40 pages 1.0 s, find in 40 pages 0.35 s.'),
    ('Run 5', '2026-10-30', 'Full regression (performance excluded)', 109, 8, 1, 0, '11 min 59 s', 'REG-070: the "Backup saved" toast came and went while the test was saving the file. Test now watches during the save.'),
    ('Run 6', '2026-10-30', 'Full regression (performance excluded)', 109, 8, 1, 0, '15 min 7 s', 'REG-041: the wait for two uploaded PDFs was too short. One shared wait for all multi-upload tests.'),
    ('Stress A', '2026-10-30', '6 tests changed after Runs 5-6, 3 times each, 4 workers', 14, 0, 4, 0, '5 min', 'Machine saturated by another project\'s test suite (100 % CPU). Showed 4 workers is too many under load.'),
    ('Stress B', '2026-10-30', 'Same 18 executions, 2 workers, same outside load', 18, 0, 0, 0, '6 min 18 s', 'All passed. 2 workers made the default.'),
    ('Run 7', '2026-10-30', 'Full regression on the final code, 2 workers', None, None, None, None, 'Stopped after 24 of 118', 'Stopped, not completed: machine at 100 % CPU from another project\'s suite. Replaced by the module runs and the final run below.'),
] + [tuple(h) for h in FINAL_RUN.get('history', [])]
WIDTHS.update({'Run': 14, 'Date': 11, 'Scope': 40, 'Passed': 8, 'Expected Fail': 9, 'Failed': 8, 'Flaky': 7, 'Duration': 14, 'What Happened': 70})
CENTERED.update({'Date', 'Passed', 'Expected Fail', 'Failed', 'Flaky', 'Duration'})
hist_rows = [OrderedDict(zip(['Run', 'Date', 'Scope', 'Passed', 'Expected Fail', 'Failed', 'Flaky', 'Duration', 'What Happened'], h)) for h in HIST]
write_table(rh, list(hist_rows[0].keys()), hist_rows, 'RunHistory', start_row=4, freeze='B5')

for ws in wb.worksheets:
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    if ws.tables:
        hdr = next(iter(ws.tables.values())).ref.split(':')[0][1:]
        ws.print_title_rows = f'{hdr}:{hdr}'
    ws.sheet_properties.tabColor = {'Summary': NAVY, 'Suite Structure': NAVY, 'Smoke Suite': '70AD47', 'Sanity Suite': 'FFC000', 'Regression Suite': '4472C4',
                                    'All Test Cases': '7F7F7F', 'Not Automated': 'A5A5A5', 'Defects Found': 'C00000', 'Run History': 'A5A5A5'}[ws.title]
wb.save(OUT)

# ---------- sanity prints ----------
from collections import Counter
print('rows', N, Counter(r['Test Suite'] for r in rows), 'automated', sum(r['Automated?'] == 'Yes' for r in rows))
for k, v in RUNS.items():
    print(k, 'ids', len(v), 'execs', sum(e['execs'] for e in v.values()), Counter(by_id[i]['Test Suite'] for i in v))
print('final', Counter(r[FR] for r in rows))
print('defects', len(DEFECTS), Counter(d['pri'] for d in DEFECTS.values()))
print('latest', Counter(r['Latest Result'] for r in rows))
print('sanity sheet rows', len(san_rows), 'files', len(srows))
