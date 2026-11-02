#!/usr/bin/env node
/**
 * Signs the QA account in on the real MuulOrigin sign-in page and saves the
 * session (the .muulorigin.com cookies) as a Playwright storage state file.
 *
 *   node automation/helpers/live/signin.mjs <out.json>
 *
 * Runs as its own process on purpose: Playwright Test records every typed value
 * in its traces and HTML report, so typing the password inside a test would put
 * it in both. Here nothing is recorded. Reads CC_LIVE_EMAIL / CC_LIVE_PASSWORD;
 * prints neither, nor any cookie or token.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'))
const { chromium } = require('@playwright/test')

const [out] = process.argv.slice(2)
const email = process.env.CC_LIVE_EMAIL
const password = process.env.CC_LIVE_PASSWORD
if (!out || !email || !password) {
  console.error('usage: CC_LIVE_EMAIL=… CC_LIVE_PASSWORD=… node signin.mjs <out.json>')
  process.exit(2)
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('https://www.muulorigin.com/signin', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByPlaceholder('you@example.com').fill(email, { timeout: 30_000 })
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  // Signed in when the HttpOnly refresh cookie the products share is set.
  const deadline = Date.now() + 45_000
  while (!(await context.cookies()).some((c) => c.name === 'mo_refresh_token' && c.domain.endsWith('muulorigin.com'))) {
    if (Date.now() > deadline) {
      const shown = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' ').trim()
      throw new Error(`MuulOrigin sign-in did not complete${shown ? `: ${shown}` : ''}`)
    }
    await page.waitForTimeout(250)
  }
  await context.storageState({ path: out })
  console.log('signed in')
} finally {
  await browser.close()
}
