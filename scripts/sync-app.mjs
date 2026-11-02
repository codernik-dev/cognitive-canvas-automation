#!/usr/bin/env node
/**
 * Copies what the suite needs from a built checkout of the app into app/
 * (git-ignored). After this the suite needs nothing from the app's folder.
 * It only reads the app's folder, and it replaces app/ as a whole.
 *
 *   npm run sync-app -- D:\github\Cognitive-Canvas
 *
 * Build the app first (npm run build in its folder). Copied:
 * dist/, plus the few source files the tests read their expected values from.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app')
const COPIED = [
  'dist',
  'e2e/fixtures', // the legacy PDF and MP3 (data/files.ts)
  'src/i18n/locales', // helpers/shell.ts
  'src/components/tours/tourSteps.ts', // helpers/mobileTours.ts
  'src/services/subscription/__fixtures__/entitlements-cognitive-canvas.json', // helpers/mocks/muulAccount.ts
]

function fail(message) {
  console.error(`[sync-app] ${message}`)
  process.exit(1)
}

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)
  }
  return newest
}

const from = process.argv[2] && path.resolve(process.argv[2])
if (!from) fail('Say which folder: npm run sync-app -- <app folder>')
for (const rel of COPIED) if (!existsSync(path.join(from, rel))) fail(`${path.join(from, rel)} is missing. Is this the app's folder, and is it built (npm run build)?`)

// A stale build tests yesterday's app: refuse here, where it can still be rebuilt.
const distAge = statSync(path.join(from, 'dist', 'index.html')).mtimeMs
if (newestMtime(path.join(from, 'src')) > distAge) fail(`${from}: dist/ is older than src/. Run npm run build there first.`)

rmSync(OUT, { recursive: true, force: true })
for (const rel of COPIED) {
  mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true })
  // Keep the timestamps: global-setup compares src/ with dist/.
  cpSync(path.join(from, rel), path.join(OUT, rel), { recursive: true, preserveTimestamps: true })
}

let commit = 'unknown'
try {
  commit = execFileSync('git', ['-C', from, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // Not a git checkout: the snapshot still works, only this note is less useful.
}
writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify({ from, commit, distBuiltAt: new Date(distAge).toISOString(), syncedAt: new Date().toISOString() }, null, 2) + '\n')
console.log(`[sync-app] app/ now holds commit ${commit}, built ${new Date(distAge).toISOString()}`)
