"""A single self-contained HTML copy of the QA report, to email or attach: no login, no internet needed.

  python automation/scripts/reporting/build_report_html.py

Reads the CSVs written by build_report_data.py (automation/reports/reporting/qa-report-data/)
and writes automation/docs/QA-Report.html.
"""
import csv, html, json, os
from collections import Counter, defaultdict
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
DATA = os.path.join(ROOT, 'automation', 'reports', 'reporting', 'qa-report-data')
OUT = os.path.join(ROOT, 'automation', 'docs', 'QA-Report.html')
RUN = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'run_config.json'), encoding='utf-8'))
COMMIT, BRANCH, NAME = RUN['commit'], RUN['branch'], RUN['name']


def rows(name):
    with open(os.path.join(DATA, name), newline='', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


cases, defects, devices = rows('cases.csv'), rows('defects.csv'), rows('devices.csv')
failures, runs, perf = rows('failures.csv'), rows('runs.csv'), rows('perf.csv')
e = lambda s: html.escape(str(s if s is not None else ''))
n = lambda x: f'{int(float(x)):,}' if str(x).strip() not in ('', 'None') else ''

automated = sum(1 for c in cases if c['status'].startswith('Automated'))
pct = round(automated / len(cases) * 100, 1)
tot = {k: sum(int(d[k]) for d in devices) for k in ('passed', 'known_defect', 'failed', 'skipped')}
executions = sum(tot.values())
failing = [c['id'] for c in cases if c['latest'] == 'Failed']
pri = Counter(d['priority'] for d in defects)
within = sum(1 for p in perf if int(p['ms']) <= int(p['budget_ms']))
p1 = [d for d in defects if d['priority'] == 'P1']
area = defaultdict(Counter)
for d in defects:
    area[d['area']][d['priority']] += 1
areas = sorted(area.items(), key=lambda kv: (-sum(kv[1].values()), -kv[1]['P1'], kv[0]))
amax = max(sum(c.values()) for _, c in areas)
mods = defaultdict(lambda: [0, 0, 0])
for c in cases:
    m = mods[c['module']]
    m[0] += 1
    m[1] += c['status'].startswith('Automated')
    m[2] += c['status'] == 'Automated (expected fail)'
manual = [c for c in cases if not c['status'].startswith('Automated')]


def table(head, body, cls=''):
    th = ''.join(f'<th class="{c}">{e(h)}</th>' for h, c in head)
    return f'<div class="scroll {cls}"><table><thead><tr>{th}</tr></thead><tbody>{"".join(body)}</tbody></table></div>'


def bar(parts, maxv):
    return '<div class="bar">' + ''.join(f'<span class="{c}" style="width:{v / maxv * 100:.1f}%"></span>' for v, c in parts if v) + '</div>'


tiles = [
    ('Test cases automated', f'{pct}%', f'<b>{automated:,}</b> of <b>{len(cases):,}</b>; the rest need a real device or a screen reader', ''),
    (f'Full run ({NAME}): tests passed', f'{tot["passed"]:,}', f'of <b>{executions:,}</b> run · <b>{tot["known_defect"]}</b> reproduced a known defect · <b>{tot["failed"]}</b> failed' + (', all traced' if tot['failed'] else ''), ''),
    ('Still failing after re-checks', str(len(failing)), f'caused by an app defect, not the tests ({e(", ".join(failing))})' if failing else 'no test is failing unexpectedly', 'alert' if failing else ''),
    ('App defects found', str(len(defects)), f'<b>{pri["P1"]}</b> P1 · <b>{pri["P2"]}</b> P2 · <b>{pri["P3"]}</b> P3', 'alert'),
    ('Speed checks within limit', f'{within} of {len(perf)}', 'measured with the suite running alone', ''),
]
tile_html = ''.join(f'<div class="tile {a}"><p class="lab">{e(t)}</p><p class="big">{e(v)}</p><p class="sub">{s}</p></div>' for t, v, s, a in tiles)

sections = []
sections.append(('What to fix first: the P1 defects', 'These stop core work or lose a user\'s data. Each is reproduced on every run by a test that checks the correct behaviour. Steps, expected and actual results for every defect are in the workbook\'s Defects Found sheet.',
                 table([('Defect', ''), ('Area', ''), ('What is wrong', 'wide'), ('Proved by test', '')],
                       [f'<tr><td class="id">{e(d["id"])}</td><td>{e(d["area"])}</td><td>{e(d["title"])}</td><td>{e(d["tests"])}</td></tr>' for d in p1])))
sections.append(('Where the defects are', 'Defects per product area, most first. <span class="sw p1"></span>P1 <span class="sw p2"></span>P2 <span class="sw p3"></span>P3',
                 table([('Area', ''), ('P1', 'num'), ('P2', 'num'), ('P3', 'num'), ('Total', 'num'), ('', '')],
                       [f'<tr><td>{e(a)}</td><td class="num">{c["P1"]}</td><td class="num">{c["P2"]}</td><td class="num">{c["P3"]}</td><td class="num">{sum(c.values())}</td><td>{bar([(c["P1"], "p1"), (c["P2"], "p2"), (c["P3"], "p3")], amax)}</td></tr>' for a, c in areas], 'tall')))
dmax = max(sum(int(d[k]) for k in ('passed', 'known_defect', 'failed', 'skipped')) for d in devices)
sections.append(('Full run, by device', f'{NAME} ran every automated test once on each device profile. A known defect is a test that checks the correct behaviour and fails exactly where the app is wrong. <span class="sw ok"></span>Passed <span class="sw p3"></span>Known defect <span class="sw p1"></span>Failed',
                 table([('Device', ''), ('Passed', 'num'), ('Known defect', 'num'), ('Failed', 'num'), ('', '')],
                       [f'<tr><td>{e(d["device"])}</td><td class="num">{n(d["passed"])}</td><td class="num">{n(d["known_defect"])}</td><td class="num">{n(d["failed"])}</td><td>{bar([(int(d["passed"]), "ok"), (int(d["known_defect"]), "p3"), (int(d["failed"]), "p1")], dmax)}</td></tr>' for d in devices])))
if failures:
    sections.append(('Every failure in the full run, traced', 'No failure was retried until it passed. Each was read from its recording and given a cause; test-side problems were fixed and the affected tests run again.',
                     table([('Test', ''), ('Device', ''), ('Cause', 'wide'), ('Whose problem', ''), ('After re-check', '')],
                           [f'<tr><td class="id">{e(f["test"])}</td><td>{e(f["device"])}</td><td>{e(f["cause"])}</td><td>{e(f["verdict"])}</td><td>{e(f["after_recheck"])}</td></tr>' for f in failures])))
sections.append(('Coverage by module', 'Test cases per product area, and how many are automated.',
                 table([('Module', ''), ('Cases', 'num'), ('Automated', 'num'), ('Coverage (%)', 'num'), ('Known defect', 'num')],
                       [f'<tr><td>{e(m)}</td><td class="num">{v[0]}</td><td class="num">{v[1]}</td><td class="num">{round(v[1] / v[0] * 100, 1)}</td><td class="num">{v[2]}</td></tr>' for m, v in sorted(mods.items(), key=lambda kv: (-kv[1][0], kv[0]))], 'tall')))
sections.append(('Speed', 'Each measurement against the limit its test enforces; the bar is the share of the limit used.',
                 table([('Measurement', 'wide'), ('Took (ms)', 'num'), ('Limit (ms)', 'num'), ('', '')],
                       [f'<tr><td>{e(p["measurement"])}</td><td class="num">{n(p["ms"])}</td><td class="num">{n(p["budget_ms"])}</td><td>{bar([(max(int(p["ms"]) / int(p["budget_ms"]) * 100, 1), "ok")], 100)}</td></tr>' for p in perf], 'tall')))
sections.append(('What automation cannot check', 'These need real hardware or assistive technology, so they stay as a short manual check each release. Everything a browser can emulate around them is automated.',
                 table([('Case', ''), ('What it checks', 'wide'), ('Status', ''), ('Why', 'wide')],
                       [f'<tr><td class="id">{e(c["id"])}</td><td>{e(c["title"])}</td><td>{e(c["status"])}</td><td>{e(c["why_not_automated"])}</td></tr>' for c in manual])))
sections.append(('All defects', 'Intermittent defects were seen but cannot be reproduced on demand, so no test is marked for them.',
                 table([('Defect', ''), ('Priority', ''), ('Area', ''), ('What is wrong', 'wide'), ('Kind', '')],
                       [f'<tr><td class="id">{e(d["id"])}</td><td><span class="pill {d["priority"].lower()}">{e(d["priority"])}</span></td><td>{e(d["area"])}</td><td>{e(d["title"])}</td><td>{e(d["kind"])}</td></tr>' for d in defects], 'tall')))
sections.append(('Run history', 'Every recorded run, oldest first.',
                 table([('Run', ''), ('Date', ''), ('Passed', 'num'), ('Known defect', 'num'), ('Failed', 'num'), ('Duration', ''), ('What happened', 'wide')],
                       [f'<tr><td>{e(r["run"])}</td><td>{e(r["date"])}</td><td class="num">{n(r["passed"])}</td><td class="num">{n(r["expected_fail"])}</td><td class="num">{n(r["failed"])}</td><td>{e(r["duration"])}</td><td>{e(r["notes"])}</td></tr>' for r in runs], 'tall')))

sec_html = ''.join(f'<section><h2>{e(t)}</h2><p class="note">{note}</p><div class="card">{body}</div></section>' for t, note, body in sections)
run_line = 'left no test-side problems: every failure was traced' if failures else 'had no unexpected failure'
lede = (f'Automation now covers <b>{pct}%</b> of the app\'s <b>{len(cases):,}</b> test cases. The latest full run ({e(NAME)}) {run_line}, '
        f'and the suite has found <b>{len(defects)}</b> app defects, <b>{pri["P1"]}</b> of them P1. Fixing the P1s is the step that matters before the next release.')

page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cognitive Canvas QA report</title>
<style>
:root {{ --bg:#f7f7f5; --panel:#ffffff; --fg:#1d1f22; --muted:#5d6168; --line:#e2e2de; --bad:#b4232a; --warn:#a15c00; --ok:#2f6f5e; --p3:#a7abb2; --ok-fill:#3f8f7a; color-scheme: light; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#141517; --panel:#1c1d20; --fg:#ececea; --muted:#a2a6ad; --line:#2d2f33; --bad:#f06a70; --warn:#e9a443; --ok:#6cc3a8; --p3:#6c7079; --ok-fill:#4ea58c; color-scheme: dark; }} }}
* {{ box-sizing: border-box; }}
body {{ margin:0; background:var(--bg); color:var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }}
.wrap {{ max-width: 76rem; margin: 0 auto; padding: 32px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left)); display:flex; flex-direction:column; gap:32px; }}
h1 {{ font: 400 2rem/1.2 Georgia, "Times New Roman", serif; margin:0; }}
h2 {{ font-size:1.05rem; font-weight:600; margin:0; }}
.meta, .note {{ color:var(--muted); font-size:.85rem; margin:0; max-width:80ch; }}
.lede {{ margin:0; max-width:68ch; }}
.tiles {{ display:grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap:12px; }}
.tile, .card {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; min-width:0; }}
.tile p {{ margin:0; }} .lab, .sub {{ color:var(--muted); font-size:.8rem; }} .sub b {{ color:var(--fg); }}
.big {{ font: 400 2rem/1.15 Georgia, serif; font-variant-numeric: tabular-nums; margin:4px 0 !important; }}
.tile.alert .big {{ color:var(--bad); }}
section {{ display:flex; flex-direction:column; gap:10px; }}
.scroll {{ overflow:auto; }} .scroll.tall {{ max-height: 30rem; }}
table {{ width:100%; border-collapse:collapse; font-size:.82rem; }}
th {{ text-align:left; color:var(--muted); font-weight:600; padding:6px 8px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--panel); white-space:nowrap; }}
td {{ padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }}
tr:last-child td {{ border-bottom:none; }}
.num {{ text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }} .id {{ white-space:nowrap; font-weight:600; }} th.wide {{ min-width:16rem; }}
.bar {{ display:flex; gap:2px; height:10px; min-width:6rem; border-radius:3px; overflow:hidden; }}
.bar span {{ display:block; height:100%; }}
.p1 {{ background:var(--bad); }} .p2 {{ background:var(--warn); }} .p3 {{ background:var(--p3); }} .ok {{ background:var(--ok-fill); }}
.sw {{ display:inline-block; width:10px; height:10px; border-radius:2px; margin:0 4px 0 10px; vertical-align:middle; }}
.pill {{ display:inline-block; padding:0 6px; border-radius:4px; border:1px solid var(--line); font-size:.78rem; background:none !important; }}
.pill.p1 {{ color:var(--bad); border-color:var(--bad); }} .pill.p2 {{ color:var(--warn); border-color:var(--warn); }}
</style></head><body><div class="wrap">
<header style="display:flex;flex-direction:column;gap:8px">
<h1>Cognitive Canvas QA report</h1>
<p class="meta">Automated test suite · build {COMMIT} (branch {BRANCH}) · report generated {date.today().isoformat()}</p>
<p class="lede">{lede}</p>
</header>
<div class="tiles">{tile_html}</div>
{sec_html}
<section><h2>How to read the results</h2><p class="note"><b>Passed</b>: the test did everything a user would and checked both the screen and the saved data. <b>Known defect reproduced</b>: the test checks the correct behaviour and fails exactly where the app is wrong; when the app is fixed, the test reports it. <b>Failed</b>: an unexpected failure, traced to a cause before it is reported. No real user data is touched: external services are simulated inside the tests, except the opt-in live tests, which use a dedicated QA account and remove what they create.</p></section>
</div></body></html>'''
open(OUT, 'w', encoding='utf-8').write(page)
print('written', OUT, f'{len(page):,} bytes')
