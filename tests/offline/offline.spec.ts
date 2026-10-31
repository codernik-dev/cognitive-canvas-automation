/**
 * Offline / PWA, with the REAL service worker (project "offline" allows it)
 * and the browser's own offline switch, not mocked responses. Proves the
 * app shell, the PDF engine and IndexedDB keep working with no network.
 */
import { test, expect } from '../../fixtures/test.js'
import { expectStoreCount, readStore } from '../../helpers/idb.js'
import { FIND_PDF } from '../../data/files.js'
import { knownDefect } from '../../helpers/defects.js'
import type { Page } from '@playwright/test'

/**
 * The service worker registers on the first visit and controls the page
 * from the next load. Bounded: a worker that has not registered within
 * 15 s is not going to (DEF-007), and the test should say so, not hang.
 */
async function serviceWorkerInControl(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { message: 'no service worker registered', timeout: 15_000 })
    .toBeGreaterThan(0)
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { message: 'service worker never took control', timeout: 15_000 }).toBe(true)
}

test.describe('Offline', { tag: ['@offline', '@pwa'] }, () => {
  test('OFF-000 the service worker registers on the first visit and takes control', { tag: '@P1' }, async ({ signedIn: _app, page }) => {
    knownDefect('DEF-007')
    await serviceWorkerInControl(page)
  })

  test('OFF-001 after one online visit the app reopens with no network and the PDF still renders', { tag: '@P1' }, async ({ pdfOpen: app, page, context }) => {
    knownDefect('DEF-007')
    await serviceWorkerInControl(page)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await context.setOffline(true)
    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.viewer.jumpTo(3)
    await app.viewer.pageRendered(3)
  })

  // Losing the network mid-session needs no service worker: the app is already loaded.
  test('OFF-002 work done after the network drops is saved and is still there once back online', { tag: '@P1' }, async ({ pdfOpen: app, page, context }) => {
    await context.setOffline(true)
    const id = (await app.canvas.place('note', 0.5, 0.4))!
    await app.canvas.writeNote(id, 'Written offline')
    await expect.poll(async () => JSON.stringify(await readStore(page, 'workspaceItems'))).toContain('Written offline')
    await context.setOffline(false)
    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(app.canvas.item(id)).toContainText('Written offline')
  })

  test('OFF-003 with the network gone, a network feature fails in words and the rest of the app carries on', { tag: '@P2' }, async ({ signedIn: app, page, context }) => {
    await context.setOffline(true)
    await app.header.exploreContent.click()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    await app.header.home.click()
    await app.home.createProject('Made Offline')
    await app.documents.expectOpen('Made Offline')
    await expectStoreCount(page, 'projects', 1)
  })
})
