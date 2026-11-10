#!/usr/bin/env node
/**
 * One-time set-up of the MoBrowser TEST profile used by the live GitHub and
 * folder tests (tests/live/github-folder.mobrowser.live.spec.ts).
 *
 *   npm run mobrowser:setup
 *
 * Opens MoBrowser on the test profile (never your own profile) so you can add,
 * in MoBrowser's credential manager:
 *   - the GitHub repository the tests may push to (default codernik-dev/cc-test-), and
 *   - the QA backup folder (created here, empty).
 * Close MoBrowser when done; the tests reuse what you added.
 *
 * Overrides: CC_MOBROWSER_EXE, CC_MOBROWSER_PROFILE, CC_MOBROWSER_TEST_FOLDER, CC_MOBROWSER_TEST_REPO.
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EXE = process.env.CC_MOBROWSER_EXE ?? 'C:\\Program Files\\mobrowser\\mobrowser.exe'
const PROFILE = process.env.CC_MOBROWSER_PROFILE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'cognitive-canvas-qa', 'mobrowser-profile')
const FOLDER = process.env.CC_MOBROWSER_TEST_FOLDER ?? path.join(os.homedir(), 'Documents', 'CognitiveCanvas-QA-Backups')
const REPO = process.env.CC_MOBROWSER_TEST_REPO ?? 'codernik-dev/cc-test-'

if (!existsSync(EXE)) {
  console.error(`MoBrowser not found at ${EXE}. Install it, or set CC_MOBROWSER_EXE.`)
  process.exit(1)
}
const lock = path.join(PROFILE, 'parent.lock')
if (existsSync(lock)) {
  try {
    closeSync(openSync(lock, 'r+'))
  } catch {
    console.error('The MoBrowser test profile is already open (a test run, or this set-up). Close it first.')
    process.exit(1)
  }
}
mkdirSync(PROFILE, { recursive: true })
mkdirSync(FOLDER, { recursive: true })

console.log(`
MoBrowser is opening on the TEST profile:
  ${PROFILE}
Your own MoBrowser profile is not used.

In that MoBrowser window, open the credential manager and add:
  1. GitHub: the repository ${REPO}, its branch, and a token
     that may push to it. The tests push backup commits there and read them back.
  2. Local folder:
       ${FOLDER}
     (just created, empty). The tests write backups there and delete them after.

Then close MoBrowser and run the live tests:
  npm run live
`)
spawn(EXE, ['-no-remote', '-profile', PROFILE, 'https://cognitivecanvas.muulorigin.com/'], { stdio: 'ignore', detached: true }).unref()
