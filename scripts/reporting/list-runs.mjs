#!/usr/bin/env node
/**
 * Writes Playwright's test list for each run command (what each npm script
 * would execute) to automation/reports/reporting/<run>.json. build_workbook.py
 * reads them to fill the "In ... Run" columns and the Suite Structure sheet.
 *
 *   node automation/scripts/reporting/list-runs.mjs
 *
 * Listing collects tests without starting the server or opening a browser.
 * Keep RUNS in step with the test:* scripts in package.json.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const OUT = process.env.CC_REPORTING_DIR ?? path.join(ROOT, 'automation', 'reports', 'reporting')
const DEVICES = ['--project=chromium', '--project=phone', '--project=tablet', '--project=ipad', '--project=offline']

const RUNS = {
  'list-all': [],
  smoke: ['--project=chromium', '--grep', '@smoke'],
  sanity: [...DEVICES, '--grep', '@sanity'],
  p1: [...DEVICES, '--grep', '@P1'],
  gate: ['--project=chromium', '--project=phone', '--project=offline', '--grep', '@smoke|@sanity|@P1'],
  regression: DEVICES,
  performance: ['--project=performance'],
  crossbrowser: ['--project=firefox', '--project=webkit'],
  a11y: ['--project=chromium', '--grep', '@a11y'],
  live: ['--project=live'],
}

mkdirSync(OUT, { recursive: true })
const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js')
for (const [name, args] of Object.entries(RUNS)) {
  execFileSync(process.execPath, [cli, 'test', '-c', path.join(ROOT, 'automation', 'playwright.config.ts'), ...args, '--list', '--reporter=json'], {
    cwd: ROOT,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(OUT, `${name}.json`) },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  console.log(`listed ${name}`)
}
