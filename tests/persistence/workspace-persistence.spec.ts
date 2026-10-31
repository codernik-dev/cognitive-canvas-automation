/**
 * Persistence: what the app promises to keep. Everything lives in
 * IndexedDB; the unlock and "where you were" live in sessionStorage.
 * Each test makes the state through the UI, waits for the debounced save
 * to land in IndexedDB, then reopens the app and checks the UI again.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { CanvasWorkbench } from '../../components/CanvasWorkbench.js'
import { snapshotDb, expectSameLibrary, PROJECT_STORES } from '../../helpers/backupState.js'
import { FIND_PDF } from '../../data/files.js'
import { ENV } from '../../config/env.js'

test.describe('Persistence', { tag: ['@persistence'] }, () => {
  test('PST-001 notes, highlights, links and strokes all come back after a reload', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    const a = (await app.canvas.place('note', 0.3, 0.3))!
    await app.canvas.writeNote(a, 'Persisted note')
    const b = (await app.canvas.place('note', 0.7, 0.65))!
    await app.canvas.linkItems(a, b)
    await app.viewer.tool('highlight').click()
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    await app.canvas.tool('ink').click()
    const [x, y] = await app.canvas.pointAt(0.4, 0.85)
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120, y + 10, { steps: 8 }); await page.mouse.up()

    for (const [store, n] of [['workspaceItems', 2], ['itemLinks', 1], ['highlights', 1], ['canvasStrokes', 1]] as const) await expectStoreCount(page, store, n)
    const positions = (await readStore<{ id: string; x: number; y: number }>(page, 'workspaceItems')).map(({ id, x, y }) => ({ id, x, y }))
    const before = await snapshotDb(page, PROJECT_STORES)

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(app.canvas.item(a)).toContainText('Persisted note')
    await expect(app.canvas.itemLinks).toHaveCount(1)
    await expect(app.canvas.itemLinks.first()).toHaveAttribute('data-link-from', a)
    await expect(app.canvas.itemLinks.first()).toHaveAttribute('data-link-to', b)
    await expect(app.viewer.highlights).toHaveCount(1)
    await expect(new CanvasWorkbench(page).strokeGroups).toHaveCount(1)
    // Row for row, nothing was lost or changed by the reload.
    expectSameLibrary(await snapshotDb(page, PROJECT_STORES), before, 'after a reload')
    // The DOM style carries 3 decimals of the stored float: compare to 0.01 world px.
    for (const p of positions) {
      const r = await app.canvas.worldRect(p.id)
      expect(r.x).toBeCloseTo(p.x, 2)
      expect(r.y).toBeCloseTo(p.y, 2)
    }
  })

  test('PST-002 a reload reopens the same project and document', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const [projectRow] = await readStore<{ id: string }>(page, 'projects')
    const [documentRow] = await readStore<{ id: string }>(page, 'documents')
    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    // The same rows reopened (the app's own record of where this tab was), not just a document of that name.
    const nav = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cc-nav-session') ?? 'null'))
    expect(nav).toMatchObject({ projectId: projectRow.id, documentId: documentRow.id })
  })

  test('PST-003 closing every tab ends the unlock but keeps the data', { tag: '@P1' }, async ({ pdfOpen: app, context, project }) => {
    const id = (await app.canvas.place('note', 0.5, 0.4))!
    await expectStoreCount(app.page, 'workspaceItems', 1)
    const before = await snapshotDb(app.page, PROJECT_STORES)
    await app.page.close()
    const fresh = new CognitiveCanvas(await context.newPage())
    await fresh.open()
    await fresh.login.unlockWith(ENV.testPin)
    await fresh.home.reach()
    await fresh.home.openProject(project.name)
    await fresh.documents.openDocument(FIND_PDF.displayName)
    await fresh.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(fresh.canvas.item(id)).toBeVisible()
    expectSameLibrary(await snapshotDb(fresh.page, PROJECT_STORES), before, 'after closing every tab')
  })
})
