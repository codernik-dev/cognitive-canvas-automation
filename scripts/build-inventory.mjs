#!/usr/bin/env node
/**
 * Builds docs/04-TEST-CASE-INVENTORY.md and docs/05-COVERAGE-MATRIX.md from
 * data/test-inventory.csv (the source of truth), the spec files (where each
 * case is automated) and reports/results.json (how it did on the last run).
 *
 *   npm run inventory            regenerate both documents
 *   npm run inventory -- --check also fail (exit 1) on drift between the CSV and the specs
 *
 * Drift = an inventory row marked Automated with no test carrying its ID, or
 * a test whose ID is not in the inventory. Either means traceability broke.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const AUTO = path.resolve(HERE, '..')
const ID_RE = /\b(SMK|SAN|REG|PST|OFF|A11Y|PRF|API)-\d{3}\b/

function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

// ── Where each ID is automated ──
// Playwright's own test list, so data-driven tests (titles built in a loop) count
// too. --list collects tests without starting the server or opening a browser.
const refs = new Map()
{
  const listFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'cc-inventory-')), 'list.json')
  execFileSync(process.execPath, [path.join(AUTO, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '-c', path.join(AUTO, 'playwright.config.ts'), '--list', '--reporter=json'], {
    cwd: AUTO,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: listFile },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const id = spec.title.match(ID_RE)?.[0]
      if (id && !refs.has(id)) refs.set(id, `tests/${spec.file.replace(/\\/g, '/')}:${spec.line}`)
    }
    for (const s of suite.suites ?? []) visit(s)
  }
  for (const s of JSON.parse(readFileSync(listFile, 'utf8')).suites ?? []) visit(s)
  rmSync(path.dirname(listFile), { recursive: true, force: true })
}

// ── Last results ──
// `--results a.json --results b.json` merges several runs, oldest first: a test's
// result in a later file replaces its result from an earlier one (repeats within
// one file are all listed). The default is the last run in reports/results.json.
const results = new Map()
const argResults = process.argv.flatMap((v, i, all) => (all[i - 1] === '--results' ? [path.resolve(v)] : []))
const resultsFiles = argResults.length ? argResults : [path.join(AUTO, 'reports', 'results.json')]
const runs = []
for (const resultsFile of resultsFiles.filter((f) => existsSync(f))) {
  const json = JSON.parse(readFileSync(resultsFile, 'utf8'))
  runs.push(`${json.stats?.startTime ?? '?'}: ${json.stats?.expected ?? 0} as expected, ${json.stats?.unexpected ?? 0} unexpected, ${json.stats?.flaky ?? 0} flaky, ${json.stats?.skipped ?? 0} skipped`)
  const fileResults = new Map()
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const id = spec.title.match(ID_RE)?.[0]
      if (!id) continue
      for (const t of spec.tests ?? []) {
        const known = t.expectedStatus === 'failed'
        const s = t.status === 'expected' ? (known ? 'known defect reproduced' : 'passed') : t.status === 'unexpected' ? (known ? 'DEFECT FIXED? (expected fail passed)' : 'FAILED') : t.status
        fileResults.set(id, [...(fileResults.get(id) ?? []), `${s} (${t.projectName})`])
      }
    }
    for (const s of suite.suites ?? []) visit(s)
  }
  for (const s of json.suites ?? []) visit(s)
  for (const [id, list] of fileResults) results.set(id, [...new Set(list)].map((v) => `${v}${list.filter((x) => x === v).length > 1 ? ` ×${list.filter((x) => x === v).length}` : ''}`))
}
const runInfo = runs.length ? runs.join('; ') : 'no run recorded'

const rows = parseCsv(readFileSync(path.join(AUTO, 'data', 'test-inventory.csv'), 'utf8'))
const ids = new Set(rows.map((r) => r.id))
const drift = []
for (const r of rows) if (r.status.startsWith('Automated') && !refs.has(r.id)) drift.push(`${r.id} is marked "${r.status}" but no test carries this ID`)
for (const id of refs.keys()) if (!ids.has(id)) drift.push(`${id} is automated (${refs.get(id)}) but missing from the inventory`)

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const now = new Date().toISOString().slice(0, 10)

// ── 04 inventory ──
const inv = [
  '# 04 — Test Case Inventory',
  '',
  `> Generated by \`npm run inventory\` on ${now} from \`data/test-inventory.csv\` (edit the CSV, not this file).`,
  `> "Automated Test Reference" is found by scanning the spec files for the ID; "Last result" comes from \`reports/results.json\` (${runInfo}).`,
  '',
  `Total cases: **${rows.length}**. Status meanings: **Automated** (a spec asserts it), **Automated (known defect DEF-nnn)** (a spec asserts the correct behaviour and is expected to fail until the defect is fixed), **Planned** (automatable, not written yet), **Manual** (needs a real device, real assistive technology or a staging backend), **Blocked** (cannot run until something else changes).`,
  '',
]
for (const suite of ['Smoke', 'Sanity', 'Regression']) {
  const rs = rows.filter((r) => r.suite === suite)
  inv.push(`## ${suite} (${rs.length})`, '')
  inv.push('| ID | Module | Feature | Scenario / Title | Preconditions | Test Data | Steps | Expected Result | Priority | Test Type | Automation Feasibility | Automation Status | Automated Test Reference | Last result | Requirement / Source Reference |')
  inv.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rs) {
    inv.push(`| ${r.id} | ${cell(r.module)} | ${cell(r.feature)} | ${cell(r.title)} | ${cell(r.preconditions)} | ${cell(r.test_data)} | ${cell(r.steps)} | ${cell(r.expected)} | ${r.priority} | ${cell(r.type)} | ${cell(r.feasibility)} | ${cell(r.status)} | ${refs.has(r.id) ? `\`${refs.get(r.id)}\`` : '—'} | ${cell((results.get(r.id) ?? ['not run']).join('; '))} | ${cell(r.source)} |`)
  }
  inv.push('')
}
if (drift.length) inv.push('## Traceability drift', '', ...drift.map((d) => `- ${d}`), '')
writeFileSync(path.join(AUTO, 'docs', '04-TEST-CASE-INVENTORY.md'), inv.join('\n'))

// ── 05 coverage matrix ──
const isAuto = (r) => r.status.startsWith('Automated')
const modules = [...new Set(rows.map((r) => r.module))].sort()
const statuses = ['Automated', 'Automated (known defect)', 'Planned', 'Manual', 'Blocked']
const statusOf = (r) => (r.status.startsWith('Automated (known') ? 'Automated (known defect)' : r.status)
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)} %` : '—')
const mx = [
  '# 05 — Coverage Matrix',
  '',
  `> Generated by \`npm run inventory\` on ${now}. Last run: ${runInfo}.`,
  '',
  '## What the percentages mean',
  '',
  '- **Scenario automation coverage** = automated cases ÷ all inventoried cases in that row. The denominator is the inventory (04), which lists every implemented, testable behaviour found in the source (01), plus device-only and backend-only cases. It is **not code coverage**.',
  '- **Code coverage** is measured separately by Vitest for unit tests (`npm run test:coverage`); the end-to-end suite does not instrument the bundle. See 09-FINAL-QA-REPORT.md for both numbers.',
  '- A case counts as automated when a spec asserts it, including a known-defect case (it runs and asserts the correct behaviour).',
  '',
  '## By module',
  '',
  `| Module | Total | ${statuses.join(' | ')} | Scenario automation coverage | P1 cases | P1 automated |`,
  `|---|---:|${statuses.map(() => '---:').join('|')}|---:|---:|---:|`,
]
let tot = 0, totAuto = 0, p1 = 0, p1Auto = 0
for (const m of modules) {
  const rs = rows.filter((r) => r.module === m)
  const a = rs.filter(isAuto).length
  const p = rs.filter((r) => r.priority === 'P1')
  const pa = p.filter(isAuto).length
  tot += rs.length; totAuto += a; p1 += p.length; p1Auto += pa
  mx.push(`| ${m} | ${rs.length} | ${statuses.map((s) => rs.filter((r) => statusOf(r) === s).length).join(' | ')} | ${pct(a, rs.length)} | ${p.length} | ${pa} |`)
}
mx.push(`| **All** | **${tot}** | ${statuses.map((s) => `**${rows.filter((r) => statusOf(r) === s).length}**`).join(' | ')} | **${pct(totAuto, tot)}** | **${p1}** | **${p1Auto}** |`, '')
const browserOnly = rows.filter((r) => !/^Manual/.test(r.feasibility) && !/^Blocked/.test(r.feasibility))
mx.push(`Excluding cases that need a real device, assistive technology, an external host or a staging backend (${rows.length - browserOnly.length} cases), browser-automatable coverage is **${pct(browserOnly.filter(isAuto).length, browserOnly.length)}** (${browserOnly.filter(isAuto).length} of ${browserOnly.length}).`, '')
mx.push('## By suite and priority', '', '| Suite | P1 | P2 | P3 | Automated | Total |', '|---|---:|---:|---:|---:|---:|')
for (const suite of ['Smoke', 'Sanity', 'Regression']) {
  const rs = rows.filter((r) => r.suite === suite)
  mx.push(`| ${suite} | ${['P1', 'P2', 'P3'].map((p) => rs.filter((r) => r.priority === p).length).join(' | ')} | ${rs.filter(isAuto).length} | ${rs.length} |`)
}
mx.push('', '## By test type', '', '| Test type (a case can have several) | Cases | Automated |', '|---|---:|---:|')
const types = new Map()
for (const r of rows) for (const t of r.type.split(',').map((x) => x.trim().replace(/ \(.*\)$/, ''))) {
  const v = types.get(t) ?? [0, 0]
  types.set(t, [v[0] + 1, v[1] + (isAuto(r) ? 1 : 0)])
}
for (const [t, [n, a]] of [...types].sort((x, y) => y[1][0] - x[1][0])) mx.push(`| ${t} | ${n} | ${a} |`)
mx.push('', '## Not automated, by reason', '', '| ID | Title | Status | Why |', '|---|---|---|---|')
for (const r of rows.filter((r) => !isAuto(r))) mx.push(`| ${r.id} | ${cell(r.title)} | ${r.status} | ${cell(r.feasibility)} |`)
if (drift.length) mx.push('', '## Traceability drift', '', ...drift.map((d) => `- ${d}`))
writeFileSync(path.join(AUTO, 'docs', '05-COVERAGE-MATRIX.md'), mx.join('\n') + '\n')

console.log(`inventory: ${rows.length} cases, ${totAuto} automated, ${refs.size} ids in specs, ${drift.length} drift issue(s)`)
for (const d of drift) console.log(`  drift: ${d}`)
if (process.argv.includes('--check') && drift.length) process.exit(1)
