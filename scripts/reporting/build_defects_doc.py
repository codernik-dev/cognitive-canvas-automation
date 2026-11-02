"""Writes docs/08-DEFECTS-AND-LIMITATIONS.md from the defect register.

  python scripts/reporting/build_defects_doc.py   (reads run_config.json for the run that reproduced each defect)

Same sources as the workbook: defects_old.json + defects_register.NEW, the knownDefect()
calls in the specs (which test asserts which defect), and the final run's results.
"""
import json, re, sys
from collections import OrderedDict, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
from defects_register import NEW  # noqa: E402

OLD = json.load(open(HERE / 'defects_old.json', encoding='utf-8'))
DEFECTS = OrderedDict((d['id'], d) for d in OLD + NEW)
RUN = json.load(open(HERE / 'run_config.json', encoding='utf-8'))

TEST_RE = re.compile(r"\btest(?:\.\w+)?\(\s*['\"`]((?:SMK|SAN|REG|PST|OFF|A11Y|PRF|API)-\d{3})\b")
TESTS_OF = defaultdict(list)
# First the run's own known-defect annotations (data-driven tests included) ...
ID_RE0 = re.compile(r'\b((?:SMK|SAN|REG|PST|OFF|A11Y|PRF|API)-\d{3})\b')
for f in RUN['files']:
    def _visit(s):
        for sp in s.get('specs', []):
            m = ID_RE0.search(sp['title'])
            for t in sp['tests']:
                for a in t.get('annotations', []):
                    d = re.match(r'(DEF-\d{3})', a.get('description', '')) if a.get('type') == 'known-defect' else None
                    if m and d and m.group(1) not in TESTS_OF[d.group(1)]:
                        TESTS_OF[d.group(1)].append(m.group(1))
        for c in s.get('suites', []):
            _visit(c)
    for s in json.load(open(REPO / f, encoding='utf-8'))['suites']:
        _visit(s)
# ... then the literal calls in the specs.
for spec in sorted((REPO / 'tests').rglob('*.spec.ts')):
    cur = None
    for line in spec.read_text(encoding='utf-8').splitlines():
        m = TEST_RE.search(line)
        if m:
            cur = m.group(1)
        for d in re.findall(r"knownDefect\(\s*'(DEF-\d{3})'", line):
            if cur and cur not in TESTS_OF[d]:
                TESTS_OF[d].append(cur)
# Data-driven tests (titles built in a loop) are not visible to the scan above; take them from the inventory status.
import csv  # noqa: E402
for r in csv.DictReader(open(REPO / 'data/test-inventory.csv', encoding='utf-8')):
    for d in re.findall(r'DEF-\d{3}', r['status']):
        if r['id'] not in TESTS_OF[d]:
            TESTS_OF[d].append(r['id'])
missing = sorted(set(TESTS_OF) - set(DEFECTS))
assert not missing, f'defects asserted by tests but not in the register: {missing}'

# Result of each test in the final run.
ID_RE = re.compile(r'\b((?:SMK|SAN|REG|PST|OFF|A11Y|PRF|API)-\d{3})\b')
RESULT = defaultdict(set)
for f in RUN['files']:
    j = json.load(open(REPO / f, encoding='utf-8'))

    def visit(s):
        for sp in s.get('specs', []):
            m = ID_RE.search(sp['title'])
            for t in sp['tests']:
                if m:
                    known = t['expectedStatus'] == 'failed'
                    RESULT[m.group(1)].add('reproduced' if (known and t['status'] == 'expected') else
                                           'FIXED?' if (known and t['status'] == 'unexpected') else t['status'])
        for c in s.get('suites', []):
            visit(c)
    for s in j['suites']:
        visit(s)

PRI_ORDER = {'P1': 0, 'P2': 1, 'P3': 2}
defects = sorted(DEFECTS.values(), key=lambda d: (PRI_ORDER[d['pri']], d.get('module', ''), d['id']))
counts = defaultdict(int)
for d in defects:
    counts[d['pri']] += 1
n_int = sum(1 for d in defects if d.get('kind') == 'intermittent')


def tests_line(d):
    ts = sorted(TESTS_OF.get(d['id'], []), key=lambda t: (t.split('-')[0], int(t.split('-')[1])))
    if d.get('kind') == 'intermittent':
        return f"Seen in: {d.get('tests', '')} (intermittent: no test is marked as expected to fail)"
    rep = sorted({x for t in ts for x in RESULT.get(t, {'not run'})})
    status = 'reproduced in ' + RUN['name'] if rep == ['reproduced'] else ', '.join(rep) + f" in {RUN['name']}"
    return f"{', '.join(ts)} ({status})"


L = []
L += ['# 08 — Defects and Limitations', '',
      f"Checked on commit `{RUN['commit']}`, production build. Desktop Chrome (1366×800) unless the area says otherwise; phone = Pixel 5 emulation, tablet = 1024×1366 Chromium "
      'with touch, iPad = WebKit with the iPad profile. Every defect below was reproduced by an automated test, except the four marked *intermittent*, which were seen but cannot '
      'be reproduced on demand. Priorities are suggestions. None has been filed as a GitHub issue.', '',
      '## Summary', '',
      '| Suggested priority | Defects | of which intermittent |', '|---|---:|---:|']
for p in ('P1', 'P2', 'P3'):
    L.append(f"| {p} | {counts[p]} | {sum(1 for d in defects if d['pri'] == p and d.get('kind') == 'intermittent')} |")
L += [f'| **All** | **{len(defects)}** | **{n_int}** |', '',
      '| ID | Priority | Area | What is wrong |', '|---|---|---|---|']
for d in defects:
    L.append(f"| {d['id']} | {d['pri']} | {d.get('module', '')} | {d['title']}{' (intermittent)' if d.get('kind') == 'intermittent' else ''} |")
L += ['', '## Defects found (most severe first, related ones together)', '']
cur = None
for d in defects:
    if (d['pri'], d.get('module', '')) != cur:
        cur = (d['pri'], d.get('module', ''))
        L += [f"### {d['pri']} · {d.get('module', '')}", '']
    L.append(f"#### {d['id']} — {d['title']} — **{d['pri']}**{' — *intermittent*' if d.get('kind') == 'intermittent' else ''}")
    L.append(f"- **Test:** {tests_line(d)}")
    if d.get('steps'):
        L.append('- **Steps:**')
        L += [f'  {i}. {s}' for i, s in enumerate(d['steps'], 1)]
    L.append(f"- **Expected:** {d.get('expected', '')}")
    L.append(f"- **Actual:** {d.get('actual', '')}")
    for e in d.get('extra', []):
        L.append(f'- {e}')
    L.append('')

L += [(HERE / 'defects_doc_tail.md').read_text(encoding='utf-8').rstrip(), '']
out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'docs/08-DEFECTS-AND-LIMITATIONS.md'
out.write_text('\n'.join(L), encoding='utf-8')
print('written', out, len(defects), 'defects', dict(counts), 'intermittent', n_int)
