/**
 * PWA update flow (services/pwa/registerSW.ts, shared/PwaPrompts.tsx
 * UpdateNotification, public/sw.js), with the REAL service worker (the
 * offline project allows it).
 *
 * "A new build" is simulated without a second deploy: after the first visit,
 * every request for /sw.js is answered with the served worker whose cache
 * version is changed (the build stamps that version from its asset hashes,
 * so a real deploy changes exactly this). The browser sees a byte-different
 * worker, installs it, and it waits; the app must then offer the update, and
 * Update must hand over to the new worker and reload into it.
 *
 * Every test here needs a registered worker, which DEF-007 prevents today,
 * so each asserts the correct behaviour under that defect.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DIST_DIR } from '../../config/env.js'
import { test, expect } from '../../fixtures/test.js'
import { knownDefect } from '../../helpers/defects.js'
import { UpdateBanner } from '../../pages/PlatformScreens.js'
import type { BrowserContext, Page } from '@playwright/test'

const SERVED_SW = readFileSync(path.join(DIST_DIR, 'sw.js'), 'utf8')
const VERSION = /'cognitive-canvas-cache-' \+ \('([^']*)'\)/
const CURRENT_VERSION = SERVED_SW.match(VERSION)?.[1]
const NEXT_VERSION = 'automation-next-build'

/** The service worker registers on the first visit and controls the page from the next load (same wait as offline.spec.ts). */
async function serviceWorkerInControl(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { message: 'no service worker registered', timeout: 15_000 })
    .toBeGreaterThan(0)
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { message: 'service worker never took control', timeout: 15_000 }).toBe(true)
}

/** From now on the server hands out the next build's worker. */
async function deployNextBuild(context: BrowserContext) {
  expect(CURRENT_VERSION, 'dist/sw.js carries a cache version').toBeTruthy()
  const next = SERVED_SW.replace(VERSION, `'cognitive-canvas-cache-' + ('${NEXT_VERSION}')`)
  expect(next).not.toBe(SERVED_SW)
  await context.route((url) => url.pathname === '/sw.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'cache-control': 'no-cache' }, body: next }))
}

const appCaches = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('cognitive-canvas-cache-')).sort())

test.describe('Updates', { tag: ['@regression', '@offline', '@pwa'] }, () => {
  test('REG-107 a new build shows "A new version is available." and Update reloads into it', { tag: '@P2' }, async ({ signedIn: app, page, context }) => {
    knownDefect('DEF-007')
    await serviceWorkerInControl(page)
    expect(await appCaches(page)).toEqual([`cognitive-canvas-cache-${CURRENT_VERSION}`])
    await app.home.createProject('Survives The Update')
    await app.documents.backToProjects.click()

    await deployNextBuild(context)
    // The app checks for a newer worker every time it loads.
    await app.reload()
    const banner = new UpdateBanner(page)
    await expect(banner.message).toBeVisible({ timeout: 30_000 })
    await expect(banner.update).toBeVisible()
    await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), banner.update.click()])

    // Now on the new build: its worker controls the page and the old cache is gone.
    await expect.poll(() => appCaches(page), { timeout: 15_000 }).toEqual([`cognitive-canvas-cache-${NEXT_VERSION}`])
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated')
    await expect(banner.message).toBeHidden()
    // Nothing was lost on the way.
    await app.home.reach()
    await expect(app.home.card('Survives The Update')).toBeVisible()
  })

  test('OFF-009 dismissing the update banner keeps the current build for the rest of the session, and the banner does not come back on reload', { tag: '@P3' }, async ({ signedIn: app, page, context }) => {
    knownDefect('DEF-007')
    await serviceWorkerInControl(page)
    await deployNextBuild(context)
    await app.reload()
    const banner = new UpdateBanner(page)
    await expect(banner.message).toBeVisible({ timeout: 30_000 })
    await banner.dismiss.click()
    await expect(banner.message).toBeHidden()
    expect(await page.evaluate(() => sessionStorage.getItem('cc2_sw_update_dismissed'))).toBe('1')
    await app.reload()
    await expect(app.header.home).toBeVisible()
    await expect(banner.message).toBeHidden()
    expect(await appCaches(page)).toEqual([`cognitive-canvas-cache-${CURRENT_VERSION}`])
  })
})
