/**
 * Writes reports/summary.md: totals per suite folder and per project, every
 * failure with its first error line, and every flaky test. This is the file
 * 09-FINAL-QA-REPORT.md quotes, so its numbers come from a real run only.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

// Terminal colour codes in Playwright's error text (ESC [ … m), built without a control-character literal.
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

interface Row { suite: string; project: string; title: string; status: string; ms: number; error?: string; ids: string[] }

const suiteOf = (file: string) => {
  const parts = file.split(/[\\/]/)
  const i = parts.lastIndexOf('tests')
  return i >= 0 && parts[i + 1] ? parts[i + 1] : 'other'
}

export default class SummaryReporter implements Reporter {
  private rows = new Map<string, Row>()
  private started = Date.now()
  constructor(private opts: { outputFile: string }) {}

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name ?? '?'
    const key = `${project}::${test.id}`
    const outcome = test.outcome() // expected | unexpected | flaky | skipped
    // test.fail() marks a documented application defect: the test asserts the
    // CORRECT behaviour and is expected to fail until the defect is fixed.
    // It is reported as its own status, never as a pass.
    const knownDefect = test.expectedStatus === 'failed'
    const status =
      outcome === 'expected' ? (result.status === 'skipped' ? 'skipped' : knownDefect ? 'known-defect' : 'passed')
      : outcome === 'unexpected' ? (knownDefect ? 'defect-fixed?' : 'failed')
      : outcome
    const ids = [...test.title.matchAll(/\b(SMK|SAN|REG|PST|OFF|A11Y|PRF|API)-\d{3}\b/g)].map((m) => m[0])
    this.rows.set(key, {
      suite: suiteOf(test.location.file),
      project,
      title: test.titlePath().slice(2).join(' › '),
      status,
      ms: (this.rows.get(key)?.ms ?? 0) + result.duration,
      // The first line says what kind of check failed; Locator/Expected/Received say which and how.
      error: result.error?.message
        ?.replace(ANSI_COLOUR, '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l, i) => l && (i === 0 || /^(Locator|Expected|Received|Call log|- waiting for)/.test(l)))
        .slice(0, 4)
        .join(' | ')
        .slice(0, 400),
      ids,
    })
  }

  onEnd(result: FullResult) {
    const rows = [...this.rows.values()]
    const count = (f: (r: Row) => boolean) => rows.filter(f).length
    const statuses = ['passed', 'failed', 'flaky', 'skipped', 'known-defect'] as const
    const groups = [...new Set(rows.map((r) => `${r.suite}|${r.project}`))].sort()
    const envFile = path.resolve(path.dirname(this.opts.outputFile), 'environment.json')
    const env = existsSync(envFile) ? JSON.parse(readFileSync(envFile, 'utf8')) : {}

    const out: string[] = []
    out.push('# Automation run summary', '')
    out.push(`- Finished: ${new Date().toISOString()} (wall clock ${Math.round((Date.now() - this.started) / 1000)} s)`)
    out.push(`- Overall status: **${result.status}**`)
    out.push(`- Build under test: \`${env.buildId ?? 'unknown'}\` at ${env.baseURL ?? '?'}${env.staleBuild ? ' (**STALE build**)' : ''}`)
    out.push(`- Node ${env.node ?? process.version}, ${env.platform ?? process.platform}, workers ${env.workers ?? '?'}`, '')
    out.push('| Suite | Project | Total | Passed | Failed | Flaky | Skipped | Known defect (expected fail) |', '|---|---|---:|---:|---:|---:|---:|---:|')
    for (const g of groups) {
      const [suite, project] = g.split('|')
      const rs = rows.filter((r) => r.suite === suite && r.project === project)
      out.push(`| ${suite} | ${project} | ${rs.length} | ${statuses.map((s) => rs.filter((r) => r.status === s).length).join(' | ')} |`)
    }
    out.push(`| **All** | | **${rows.length}** | ${statuses.map((s) => `**${count((r) => r.status === s)}**`).join(' | ')} |`, '')

    const failed = rows.filter((r) => r.status === 'failed' || r.status === 'defect-fixed?')
    out.push(`## Failures (${failed.length})`, '')
    for (const r of failed) out.push(`- [${r.project}] ${r.title}\n  - ${r.error ?? '(no message)'}`)
    // An expected failure is only evidence if it failed AT the defect's assertion: print where.
    const known = rows.filter((r) => r.status === 'known-defect')
    out.push('', `## Known defects reproduced (${known.length})`, '')
    for (const r of known) out.push(`- [${r.project}] ${r.title}\n  - failed at: ${r.error ?? '(no message)'}`)
    const flaky = rows.filter((r) => r.status === 'flaky')
    out.push('', `## Flaky (${flaky.length})`, '')
    for (const r of flaky) out.push(`- [${r.project}] ${r.title}`)
    const skipped = rows.filter((r) => r.status === 'skipped')
    out.push('', `## Skipped (${skipped.length})`, '')
    for (const r of skipped) out.push(`- [${r.project}] ${r.title}`)
    // Traceability: every inventory ID (04-TEST-CASE-INVENTORY.md) a test title carries, with its result.
    const byId = new Map<string, string[]>()
    for (const r of rows) for (const id of r.ids) byId.set(id, [...(byId.get(id) ?? []), `${r.status} (${r.project})`])
    out.push('', `## Test-case IDs executed (${byId.size})`, '', '| ID | Result |', '|---|---|')
    for (const id of [...byId.keys()].sort()) out.push(`| ${id} | ${byId.get(id)!.join(', ')} |`)
    const slow = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 10)
    out.push('', '## Slowest 10', '')
    for (const r of slow) out.push(`- ${(r.ms / 1000).toFixed(1)} s — [${r.project}] ${r.title}`)

    mkdirSync(path.dirname(this.opts.outputFile), { recursive: true })
    writeFileSync(this.opts.outputFile, out.join('\n') + '\n')
  }

  printsToStdio() { return false }
}
