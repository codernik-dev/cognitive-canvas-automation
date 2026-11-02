/**
 * Runs once before any test. Fails fast, with a sentence, on the two
 * environment mistakes that otherwise surface as 40 confusing timeouts:
 * no build at all, and a build older than the source it is meant to test.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { FullConfig } from '@playwright/test'
import { ENV, APP_DIR, AUTOMATION_DIR, DIST_DIR, baseURL, reportsFolder } from './env.js'

const DIST = DIST_DIR
// The run's own report folder, where the summary reporter looks for this file.
const REPORTS = path.join(AUTOMATION_DIR, reportsFolder)

function newestMtime(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)
  }
  return newest
}

function buildIdOf(distDir: string): string {
  const assets = path.join(distDir, 'assets')
  for (const f of readdirSync(assets).filter((n) => n.endsWith('.js'))) {
    // vite.config.ts defines __BUILD_ID__ and __BUILD_TIME__; the minifier emits them side by side.
    const m = readFileSync(path.join(assets, f), 'utf8').match(/[`"]([0-9a-f]{7,12}(?:-dirty)?)[`"]\s*,\s*\w+\s*=\s*[`"]\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z[`"]/)
    if (m) return m[1]
  }
  return 'unknown'
}

export default async function globalSetup(config: FullConfig) {
  if (ENV.baseUrlOverride) {
    console.log(`[automation] using the build already served at ${baseURL}`)
    return
  }
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`[automation] ${path.join(DIST, 'index.html')} is missing. Build the app, then run: npm run sync-app -- <app folder>`)
  }
  const distAge = statSync(path.join(DIST, 'index.html')).mtimeMs
  const srcAge = newestMtime(path.join(APP_DIR, 'src'))
  const stale = srcAge > distAge
  const msg = `[automation] dist built ${new Date(distAge).toISOString()}; newest src change ${new Date(srcAge).toISOString()}`
  if (stale) {
    // A stale build tests yesterday's app. CI always builds first, so this is a local mistake: say it loudly.
    if (ENV.ci) throw new Error(`${msg}. dist/ is older than src/: rebuild.`)
    console.warn(`${msg}\n[automation] WARNING: dist/ is older than src/. Results describe the old build. Build the app, then run \`npm run sync-app -- <app folder>\`.`)
  } else {
    console.log(msg)
  }
  mkdirSync(REPORTS, { recursive: true })
  writeFileSync(
    path.join(REPORTS, 'environment.json'),
    JSON.stringify({ baseURL, buildId: buildIdOf(DIST), distBuiltAt: new Date(distAge).toISOString(), staleBuild: stale, node: process.version, platform: process.platform, ci: ENV.ci, workers: config.workers }, null, 2),
  )
}
