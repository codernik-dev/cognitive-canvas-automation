/**
 * Touch and stylus input on a tablet (1024x1366 Chromium with a touchscreen,
 * project "tablet"): the app's pointerType rules, which a desktop mouse never
 * reaches (SAN-004 / SAN-005's emulated counterparts).
 *
 *   canvas   once a stylus has been seen, a finger with Draw / Eraser pans
 *            instead of drawing (useCanvasEvents.ts "pen/finger split");
 *   PDF      a finger performs the armed tool, pen or no pen (#363 follow-up,
 *            PdfHighlightLayer / PdfSelectAreaOverlay); to scroll, Pan or two
 *            fingers; while a stylus is down its touches never become a page
 *            scroll (usePenGestureGuard); Link Area ignores fingers once a
 *            stylus has been seen (PdfAreaLinkOverlay);
 *   pinch    two fingers zoom the document within 50-250 % (usePinchZoom) and
 *            never the page;
 *   hold     a document card is reordered by press-and-hold (180 ms), a quick
 *            swipe is a scroll (DocumentListView);
 *   swipe    single-page view turns pages by horizontal swipe; a touch tap on
 *            the edge does not (SinglePagePdfView).
 *
 * Pens are TRUSTED pen pointer events from the browser's input protocol
 * (helpers/mobileInput.ts). A real Apple Pencil / S Pen (pressure, tilt,
 * palm contact, Touch.touchType) is not reproduced.
 */
import { test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { fingerDrag, fingerDown, fingerMoveAndLift, penDrag, pinch, swipe, penDownInPage, penUpInPage, touchStartRefused } from '../../helpers/mobileInput.js'
import { pagePoint, pageRegion, openPdfOnTablet } from '../../helpers/mobileFlows.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { knownDefect } from '../../helpers/defects.js'

interface ItemRow { id: string; type: string; data: { content?: string } }
interface AreaLinkRow { id: string; pageNumber: number; workspaceItemId: string; rect: { x: number; y: number; width: number; height: number } }

test.describe('Tablet touch and stylus', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-860 on the canvas a finger draws until a stylus is seen; then the pen draws and a finger with Draw armed pans instead (palm rejection)', { tag: ['@P1', '@sanity'] }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app, null)
    await app.canvas.tool('ink').click()
    await fingerDrag(page, await app.canvas.pointAt(0.2, 0.25), await app.canvas.pointAt(0.7, 0.25), 12)
    await expectStoreCount(page, 'canvasStrokes', 1)

    await penDrag(page, await app.canvas.pointAt(0.2, 0.45), await app.canvas.pointAt(0.7, 0.45), 12)
    await expectStoreCount(page, 'canvasStrokes', 2)

    const before = await app.canvas.transform()
    await fingerDrag(page, await app.canvas.pointAt(0.3, 0.7), await app.canvas.pointAt(0.6, 0.6), 10)
    await app.canvas.settled()
    const after = await app.canvas.transform()
    expect(after.x - before.x).toBeGreaterThan(60)
    expect(after.y - before.y).toBeLessThan(-20)
    await expectStoreCount(page, 'canvasStrokes', 2) // the finger drew nothing
    // The tool is still Draw: the pen keeps drawing.
    await penDrag(page, await app.canvas.pointAt(0.2, 0.8), await app.canvas.pointAt(0.6, 0.8), 10)
    await expectStoreCount(page, 'canvasStrokes', 3)
  })

  test('REG-861 a stylus highlights the PDF; a finger performs the armed Highlight too; with Pan a finger scrolls the document and draws nothing', { tag: ['@P1'] }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app)
    await app.viewer.tool('highlight').click()
    const [a, b] = await pageRegion(app, 2, [0.12, 0.17], [0.7, 0.17])
    await penDrag(page, a, b, 14)
    await expectStoreCount(page, 'highlights', 1, (h) => h.pageNumber === 2)
    const [c, d] = await pageRegion(app, 2, [0.12, 0.27], [0.7, 0.27])
    await fingerDrag(page, c, d, 14)
    await expectStoreCount(page, 'highlights', 2)

    await app.viewer.tool('highlight').click() // put away: back to Pan on a touch device
    await expect(app.viewer.tool('pan')).toHaveClass(/bg-primary-500/)
    const top = await app.viewer.scroller.evaluate((el) => el.scrollTop)
    const box = (await app.viewer.scroller.boundingBox())!
    // A finger pushing the page up: real touches, native scrolling (touch-action pan-x pan-y).
    await fingerDrag(page, [box.x + box.width / 2, box.y + box.height * 0.8], [box.x + box.width / 2, box.y + box.height * 0.3], 10)
    await expect.poll(() => app.viewer.scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(top + 200)
    await expectStoreCount(page, 'highlights', 2)
  })

  test('REG-862 a stylus Select Area makes a linked note, and while the stylus is down its touches are kept from scrolling the page; a finger alone is not', { tag: ['@P1'] }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app)
    await app.viewer.tool('select-area').click()
    const at = await pagePoint(app, 2, 0.5, 0.6)
    expect(await touchStartRefused(page, at)).toBe(false) // no stylus down: the finger is the browser's to scroll
    await penDownInPage(page, at)
    expect(await touchStartRefused(page, at)).toBe(true)
    await penUpInPage(page, at)
    expect(await touchStartRefused(page, at)).toBe(false)
    await expectStoreCount(page, 'workspaceItems', 0) // a tap is not a selection

    const [from, to] = await pageRegion(app, 2, [0.08, 0.15], [0.85, 0.21])
    await penDrag(page, from, to, 10)
    await expectStoreCount(page, 'areaLinks', 1)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    const note = (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.id === link.workspaceItemId)!
    expect(note.type).toBe('note')
    expect(note.data.content).toContain('Canvas threads link highlights to notes')
    expect(link.pageNumber).toBe(2)
    expect(link.rect.x).toBeCloseTo(0.08, 1)
  })

  test('REG-863 once a stylus has been seen, Link Area ignores a finger and takes the link from the pen', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app)
    // The stylus touches the page once (with Pan): the app now knows a pen is in use.
    const tapAt = await pagePoint(app, 2, 0.8, 0.8)
    await penDrag(page, tapAt, tapAt, 1)
    const noteId = (await app.canvas.place('note', 0.55, 0.35))!
    await expect(app.viewer.tool('link-area')).toBeEnabled()
    await app.viewer.tool('link-area').click()
    // Sideways, so a refused finger cannot turn into a vertical scroll either.
    const [f0, f1] = await pageRegion(app, 2, [0.1, 0.5], [0.6, 0.5])
    await fingerDrag(page, f0, f1, 10)
    const [p0, p1] = await pageRegion(app, 2, [0.1, 0.14], [0.45, 0.22])
    await penDrag(page, p0, p1, 10)
    await expectStoreCount(page, 'areaLinks', 1)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    expect(link).toMatchObject({ workspaceItemId: noteId, pageNumber: 2 })
    expect(link.rect.y).toBeCloseTo(0.14, 1) // the pen's rectangle, not the finger's (y 0.5)
    expect(link.rect.height).toBeCloseTo(0.08, 1)
  })

  test('REG-864 two fingers zoom the document, stopping at 250 % and 50 %, and never zoom the page itself', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    knownDefect('DEF-804')
    await openPdfOnTablet(app, null)
    await expect(app.viewer.zoomReset).toHaveText('100%')
    const box = (await app.viewer.scroller.boundingBox())!
    const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2]
    await pinch(page, center, 50, 75)
    await expect(app.viewer.zoomReset).toHaveText('150%')
    await pinch(page, center, 30, 150)
    await expect(app.viewer.zoomReset).toHaveText('250%')
    await pinch(page, center, 150, 20)
    await expect(app.viewer.zoomReset).toHaveText('50%')
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
  })

  test('REG-865 press-and-hold on a document card lifts it, and a finger drag reorders the list and saves the order', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    knownDefect('DEF-805')
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    const names = () => app.documents.cards.evaluateAll((els) => els.map((e) => e.querySelector('p')?.textContent ?? ''))
    await expect.poll(names).toEqual([SECOND_PDF.displayName, FIND_PDF.displayName]) // newest first
    const docs = await readStore<{ id: string; name: string }>(page, 'documents')
    const idOf = (n: string) => docs.find((d) => d.name === n)!.id
    const lower = (await app.documents.card(FIND_PDF.displayName).boundingBox())!
    const upper = (await app.documents.card(SECOND_PDF.displayName).boundingBox())!
    // Press and hold: once the app lifts the card (every card turns touch-action:none), drag it up and lift the finger.
    const at: [number, number] = [lower.x + lower.width / 2, lower.y + lower.height / 2]
    await fingerDown(page, at)
    await expect(app.documents.cards.first()).toHaveCSS('touch-action', 'none')
    await fingerMoveAndLift(page, at, [at[0], upper.y + 4], 10)
    await expect.poll(names).toEqual([FIND_PDF.displayName, SECOND_PDF.displayName]) // dropped: no lifted copy left behind
    await expect.poll(async () => (await readStore<{ documentOrder?: string[] }>(page, 'projects'))[0].documentOrder).toEqual([idOf(FIND_PDF.displayName), idOf(SECOND_PDF.displayName)])
    await expect(app.viewer.pageEl(1)).toHaveCount(0) // still on the list: holding is not opening
  })

  test('REG-867 a quick finger swipe over a document card is a scroll: nothing is lifted, reordered or opened', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    const names = () => app.documents.cards.evaluateAll((els) => els.map((e) => e.querySelector('p')?.textContent ?? ''))
    await expect.poll(names).toEqual([SECOND_PDF.displayName, FIND_PDF.displayName])
    const lower = (await app.documents.card(FIND_PDF.displayName).boundingBox())!
    await fingerDrag(page, [lower.x + lower.width / 2, lower.y + lower.height / 2], [lower.x + lower.width / 2, lower.y - 40], 4)
    await expect(app.documents.cards).toHaveCount(2)
    await expect(app.documents.cards.first()).not.toHaveCSS('touch-action', 'none')
    expect(await names()).toEqual([SECOND_PDF.displayName, FIND_PDF.displayName])
    expect((await readStore<{ documentOrder?: string[] }>(page, 'projects'))[0].documentOrder).toBeUndefined()
    await expect(app.viewer.pageEl(1)).toHaveCount(0)
  })

  test('REG-866 in single-page view a quick sideways swipe turns the page either way; an up-and-down swipe does not', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app)
    await app.viewer.singlePageView.click()
    await app.viewer.expectPage(1, 4)
    const box = (await app.viewer.pane.boundingBox())!
    const y = box.y + box.height / 2
    await swipe(page, [box.x + box.width * 0.75, y], [box.x + box.width * 0.25, y])
    await app.viewer.expectPage(2, 4)
    await swipe(page, [box.x + box.width * 0.25, y], [box.x + box.width * 0.75, y])
    await app.viewer.expectPage(1, 4)
    // Mostly vertical: not a page turn (|dx| must exceed 1.5 x |dy|).
    await swipe(page, [box.x + box.width * 0.6, y + 150], [box.x + box.width * 0.4, y - 150])
    await expect(app.viewer.pageButton).toHaveText('1/4')
    await swipe(page, [box.x + box.width * 0.75, y], [box.x + box.width * 0.25, y])
    await app.viewer.expectPage(2, 4)
  })
})
