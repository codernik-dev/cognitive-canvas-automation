/**
 * The phone workspace around a PDF (Pixel 5, project "phone"):
 * MobileWorkspaceSplit (Document / Split / Canvas), MobileDocStatusBar,
 * MobilePageStrip, the phone fit-to-width page scale, and MobileDocToolBox
 * (the document tool dial, its palette drawer and its Undo / Redo).
 *
 * Fingers are real touches through the browser's input protocol
 * (helpers/mobileInput.ts), so the app sees pointerType 'touch' exactly as
 * on a phone.
 */
import { test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { fingerDrag } from '../../helpers/mobileInput.js'
import { openPdfOnPhone, pageRegion, tileArmed } from '../../helpers/mobileFlows.js'
import { FIND_PDF } from '../../data/files.js'
import { OcrDialog } from '../../components/DocumentsOcr.js'

interface HighlightRow { id: string; documentId: string; pageNumber: number; color: string; tip?: string; freehandPath: string }
interface ItemRow { id: string; type: string; documentId: string; data: { type: string; content?: string; sourcePageNumber?: number; blobId?: string; source?: string } }
interface AreaLinkRow { id: string; documentId: string; pageNumber: number; workspaceItemId: string; rect: { x: number; y: number; width: number; height: number } }

test.describe('Phone document view', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-825 Document / Split / Canvas: the switch appears once a PDF is open; Split shows both panes with a divider that resizes them within 22-78 %; the PDF is never reloaded', { tag: ['@P1', '@sanity'] }, async ({ project: _p, app, ws, page }) => {
    await expect(ws.modes).toHaveCount(0) // document list: nothing to split yet
    await openPdfOnPhone(app, ws)
    await expect(ws.modes.getByRole('button')).toHaveText(['Document', 'Split', 'Canvas'])
    await expect(ws.docPane).toBeVisible()
    await expect(ws.wsPane).toBeHidden()
    // The document's scroll container: remounting the document pane would replace it (and reload the PDF).
    const scroller = await app.viewer.scroller.elementHandle()

    await ws.mode('Split').click()
    await expect(ws.wsPane).toBeVisible()
    await expect(ws.divider).toBeVisible()
    expect(await ws.docShare()).toBeCloseTo(0.42, 2)
    // The page refits to the narrower pane: page width = pane width - 16 px.
    await expect.poll(async () => Math.round((await app.viewer.pageEl(1).boundingBox())!.width - (await app.viewer.scroller.evaluate((el) => el.clientWidth - 16)))).toBeLessThanOrEqual(2)

    const knob = (await ws.divider.boundingBox())!
    const row = (await ws.paneRow.boundingBox())!
    const at: [number, number] = [knob.x + knob.width / 2, knob.y + knob.height / 2]
    await fingerDrag(page, at, [row.x + row.width * 0.6, at[1]], 8)
    expect(await ws.docShare()).toBeCloseTo(0.6, 1)
    const moved = (await ws.divider.boundingBox())!
    await fingerDrag(page, [moved.x + moved.width / 2, at[1]], [row.x + row.width - 2, at[1]], 8)
    expect(await ws.docShare()).toBeCloseTo(0.78, 2) // clamped
    await expect(ws.divider).toBeVisible()

    await ws.mode('Canvas').click()
    await expect(ws.docPane).toBeHidden()
    await expect(app.canvas.surface).toBeVisible()
    expect((await ws.wsPane.boundingBox())!.width).toBeCloseTo(row.width, 0)
    await ws.mode('Split').click()
    expect(await ws.docShare()).toBeCloseTo(0.78, 2) // the split remembers where it was left
    await ws.mode('Document').click()
    await expect(ws.wsPane).toBeHidden()
    await expect(ws.divider).toHaveCount(0)
    // Both panes stay mounted across the three modes: the same scroll container, still holding the drawn page.
    expect(await scroller!.evaluate((el) => el.isConnected && el.querySelector('[data-page="1"]') !== null)).toBe(true)
    await app.viewer.pageRendered(1)
  })

  test('REG-826 the phone status bar replaces the page dock: "Page N / total", zoom - / % / +, and the page fits the screen width', { tag: '@P2' }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    await expect(app.viewer.nav).toHaveCount(0) // no floating desktop dock
    await expect(page.locator('[data-tour="toolbar-pin"]')).toHaveCount(0) // no pinned toolbar either: tools are in the dial
    const fit = async () => (await app.viewer.pageEl(1).boundingBox())!.width - (await app.viewer.scroller.evaluate((el) => el.clientWidth - 16))
    expect(Math.abs(await fit())).toBeLessThanOrEqual(2)

    await expect(ws.zoomReset).toHaveText('100%')
    const fitted = (await app.viewer.pageEl(1).boundingBox())!.width
    await ws.zoomIn.click()
    await expect(ws.zoomReset).toHaveText('110%')
    await expect.poll(async () => (await app.viewer.pageEl(1).boundingBox())!.width / fitted, { message: 'page width at 110 %' }).toBeCloseTo(1.1, 1)
    await ws.zoomOut.click()
    await ws.zoomOut.click()
    await expect(ws.zoomReset).toHaveText('90%')
    await ws.zoomReset.click()
    await expect(ws.zoomReset).toHaveText('100%')
    await expect.poll(async () => Math.abs(await fit())).toBeLessThanOrEqual(2)

    // Scrolling the document moves the page number.
    const pane = (await app.viewer.scroller.boundingBox())!
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
    await page.mouse.wheel(0, 20_000)
    await expect(ws.pageLabel).toHaveText('Page 4 / 4')
  })

  test('REG-827 the Pages button opens the thumbnail rail; tapping a thumbnail jumps to that page; the desktop index panel never appears', { tag: '@P2' }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    await expect(ws.pagesToggle).toHaveAttribute('aria-pressed', 'false')
    await expect(ws.thumbs).toHaveCount(0)
    await ws.pagesToggle.click()
    await expect(ws.pagesToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(ws.pagesToggle).toHaveAttribute('title', 'Hide page thumbnails')
    await expect(ws.thumbs).toHaveCount(FIND_PDF.pageCount)
    await expect(ws.thumbs).toHaveText(['1', '2', '3', '4'])
    await expect(ws.thumb(1).getByRole('img', { name: 'Page 1' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('div.w-44')).toHaveCount(0) // the desktop IndexPanel column

    await ws.thumb(3).click()
    await expect(ws.pageLabel).toHaveText('Page 3 / 4')
    await expect(app.viewer.pageEl(3)).toBeInViewport()
    await ws.pagesToggle.click()
    await expect(ws.thumbs).toHaveCount(0)
    await expect(ws.pagesToggle).toHaveAttribute('title', 'Show page thumbnails')
  })

  test('REG-828 the Document tools dial opens a sheet of every document tool; Link Area waits for a selection; a tile arms its tool and closes the sheet', { tag: ['@P1'] }, async ({ project: _p, app, ws }) => {
    await openPdfOnPhone(app, ws)
    const dial = ws.docDial
    await expect(dial.fab).toHaveAttribute('aria-expanded', 'false')
    await dial.open()
    expect(await dial.tileLabels()).toEqual(['Pan', 'Select Area', 'Highlight', 'Eraser', 'Extract Image', 'Link Area', 'OCR', 'Find', 'Tour'])
    await expect(dial.tile('link-area')).toBeDisabled()
    // A touch device starts on Pan.
    expect(await tileArmed(ws, 'pan')).toBe(true)
    await dial.backdrop.click({ position: { x: 20, y: 20 } })
    await dial.expectClosed()

    await dial.pick('highlight')
    await expect(dial.fab).toHaveClass(/bg-primary-500/) // armed
    await dial.open()
    expect(await tileArmed(ws, 'highlight')).toBe(true)
    // Tapping the armed tool again puts it away (back to Pan on a touch device).
    await dial.tile('highlight').click()
    await dial.expectClosed()
    await expect(dial.fab).not.toHaveClass(/bg-primary-500/)
    await dial.open()
    expect(await tileArmed(ws, 'pan')).toBe(true)
  })

  test('REG-829 a finger highlights with the Highlight tile; the colour drawer picks the colour; Undo and Redo ride beside the dial only while a stroke tool is armed', { tag: ['@P1'] }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    const dial = ws.docDial
    await dial.pick('highlight')
    const drawer = dial.drawer('Pen / Highlighter')
    await expect(drawer).toHaveAttribute('aria-expanded', 'false')
    await drawer.click()
    await expect(drawer).toHaveAttribute('aria-expanded', 'true')
    for (const c of ['Important', 'Critical', 'Agree', 'Reference', 'Question', 'Revisit']) await expect(page.getByTitle(c, { exact: true })).toBeVisible()
    await page.getByTitle('Critical', { exact: true }).click()
    await expect(ws.undo).toHaveCount(0) // nothing to undo yet

    await expect(ws.drawLayer(1)).toBeAttached()
    const [from, to] = await pageRegion(app, 1, [0.12, 0.17], [0.7, 0.17])
    await fingerDrag(page, from, to, 14)
    await expectStoreCount(page, 'highlights', 1)
    const [h] = await readStore<HighlightRow>(page, 'highlights')
    expect(h).toMatchObject({ pageNumber: 1, color: '#fca5a5', tip: 'highlighter' })
    await expect(app.viewer.highlights).toHaveCount(1)

    await expect(ws.undo).toBeEnabled()
    await expect(ws.redo).toBeDisabled()
    await ws.undo.click()
    await expectStoreCount(page, 'highlights', 0)
    await expect(ws.redo).toBeEnabled()
    await ws.redo.click()
    await expectStoreCount(page, 'highlights', 1)

    // Putting the tool away hides the pair; picking it up again brings the same history back.
    await dial.open()
    await dial.tile('highlight').click()
    await expect(ws.undo).toHaveCount(0)
    await dial.pick('highlight')
    await expect(ws.undo).toBeEnabled()
  })

  test('REG-830 the Eraser tile offers its sizes in the drawer and a finger erases a highlight', { tag: '@P2' }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    const dial = ws.docDial
    await dial.pick('highlight')
    await expect(ws.drawLayer(1)).toBeAttached()
    const [from, to] = await pageRegion(app, 1, [0.12, 0.17], [0.7, 0.17])
    await fingerDrag(page, from, to, 14)
    await expectStoreCount(page, 'highlights', 1)
    const [original] = await readStore<HighlightRow>(page, 'highlights')

    await dial.pick('highlight-eraser')
    const drawer = dial.drawer('Eraser size')
    await drawer.click()
    for (const s of ['Small', 'Medium', 'Large', 'Extra Large']) await expect(page.getByTitle(s, { exact: true })).toBeVisible()
    await page.getByTitle('Extra Large', { exact: true }).click()
    await expect(ws.drawLayer(1)).toBeAttached()
    const [top, bottom] = await pageRegion(app, 1, [0.4, 0.1], [0.4, 0.25])
    await fingerDrag(page, top, bottom, 14)
    // The eraser cuts the stroke where the finger crossed it: two pieces of the same colour remain.
    await expect.poll(async () => (await readStore<HighlightRow>(page, 'highlights')).some((r) => r.id === original.id)).toBe(false)
    const pieces = await readStore<HighlightRow>(page, 'highlights')
    expect(pieces).toHaveLength(2)
    for (const piece of pieces) expect(piece).toMatchObject({ pageNumber: 1, color: original.color, documentId: original.documentId })
    await expect(ws.undo).toBeEnabled()
  })

  test('REG-831 in Split, a note placed with the canvas dial unlocks Link Area, and a finger draws the link on the page', { tag: ['@P1'] }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    await ws.mode('Split').click()
    await ws.canvasDial.pick('note')
    const [cx, cy] = await app.canvas.pointAt(0.5, 0.3)
    await page.touchscreen.tap(cx, cy)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'note')
    const [note] = await readStore<ItemRow>(page, 'workspaceItems')

    await ws.docDial.open()
    await expect(ws.docDial.tile('link-area')).toBeEnabled()
    await ws.docDial.tile('link-area').click()
    await ws.docDial.expectClosed()
    const [from, to] = await pageRegion(app, 1, [0.1, 0.14], [0.6, 0.24])
    await fingerDrag(page, from, to, 10)
    await expectStoreCount(page, 'areaLinks', 1)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    expect(link).toMatchObject({ workspaceItemId: note.id, pageNumber: 1 })
    expect(link.rect.x).toBeCloseTo(0.1, 1)
    expect(link.rect.width).toBeCloseTo(0.5, 1)
    await expect(app.viewer.areaLinks).toHaveCount(1)
  })

  test('REG-832 a finger with Select Area turns the text under it into a linked note; Extract Image makes an image item', { tag: '@P2' }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    await ws.docDial.pick('select-area')
    const [from, to] = await pageRegion(app, 1, [0.08, 0.15], [0.85, 0.21])
    await fingerDrag(page, from, to, 10)
    await expectStoreCount(page, 'areaLinks', 1)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    const note = (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.id === link.workspaceItemId)!
    expect(note.type).toBe('note')
    expect(note.data.content).toContain('quick brown fox')
    expect(note.data.sourcePageNumber).toBe(1)
    // One-shot tool: back to Pan.
    await expect(ws.docDial.fab).not.toHaveClass(/bg-primary-500/)

    await ws.docDial.pick('extract-image')
    const [a, b] = await pageRegion(app, 1, [0.1, 0.3], [0.6, 0.5])
    await fingerDrag(page, a, b, 10)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'image')
    const image = (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.type === 'image')!
    expect(image.data).toMatchObject({ type: 'image', source: 'select-area' })
    await expectStoreCount(page, 'mediaBlobs', 1, (m) => m.id === image.data.blobId)
    await expectStoreCount(page, 'areaLinks', 2)
  })

  test('REG-833 the Find tile opens and closes the find bar, and the OCR tile opens the OCR dialog', { tag: '@P2' }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    await ws.docDial.pick('find')
    await app.find.search('ZULUFOUR')
    await app.find.expectCount(1, 1)
    await ws.docDial.open()
    await expect(ws.docDial.tileFace('find')).toHaveClass(/bg-primary-500/)
    await ws.docDial.tile('find').click()
    await expect(app.find.input).toHaveCount(0)

    await ws.docDial.pick('ocr')
    const ocr = new OcrDialog(page)
    await expect(ocr.heading).toBeVisible()
    await ocr.root.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(ocr.heading).toBeHidden()
  })

  test('REG-834 the dial button can be dragged out of the way without opening its sheet; a plain tap still opens it', { tag: '@P3' }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    const fab = ws.docDial.fab
    const start = (await fab.boundingBox())!
    const at: [number, number] = [start.x + start.width / 2, start.y + start.height / 2]
    await fingerDrag(page, at, [at[0] - 150, at[1] - 200], 10)
    await ws.docDial.expectClosed()
    const moved = (await fab.boundingBox())!
    expect(moved.x).toBeCloseTo(start.x - 150, -1)
    expect(moved.y).toBeCloseTo(start.y - 200, -1)
    await fab.click()
    await expect(fab).toHaveAttribute('aria-expanded', 'true')
  })
})
