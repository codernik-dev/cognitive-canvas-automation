/**
 * Regression: the PDF area tools that create canvas content and the threads
 * that tie it back to the page (PdfSelectAreaOverlay, PdfExtractImageOverlay,
 * PdfAreaLinkOverlay, ConnectionThreads).
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { expectThreadAnchored } from '../../assertions/geometry.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { pngSizeOf, compareBlobWithPage } from '../../helpers/documents.js'
import type { Page } from '@playwright/test'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

interface AreaLinkRow { id: string; pageNumber: number; workspaceItemId: string; rect: { x: number; y: number; width: number; height: number } }
interface ItemRow { id: string; type: string; data: Record<string, unknown> }

/**
 * Place a note, link it to a region of page 1, return both ids. The default
 * region stays in the left half of the page so its right edge (where the
 * thread starts) is still inside the pane after a zoom-in.
 */
async function linkedNote(app: CognitiveCanvas, page: Page, region: [[number, number], [number, number]] = [[0.1, 0.14], [0.45, 0.22]]) {
  const noteId = (await app.canvas.place('note', 0.55, 0.35))!
  await expect(app.viewer.tool('link-area')).toBeEnabled()
  await app.viewer.tool('link-area').click()
  await app.viewer.dragOnPage(1, region[0], region[1])
  await expectStoreCount(page, 'areaLinks', 1)
  const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
  return { noteId, linkId: link.id, link }
}

test.describe('Area tools', { tag: ['@regression', '@area-tools'] }, () => {
  test('REG-046 Select Area turns the text under it into a linked note', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    await app.viewer.tool('select-area').click()
    await app.viewer.dragOnPage(1, [0.08, 0.15], [0.85, 0.21])
    await expectStoreCount(page, 'areaLinks', 1)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    const note = (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.id === link.workspaceItemId)
    expect(note?.type).toBe('note')
    expect(JSON.stringify(note?.data)).toContain('quick brown fox')
    expect(note?.data.sourcePageNumber).toBe(1)
    expect(note?.data.sourceExcerpt).toMatch(/^The quick brown fox jumps over the lazy dog\./)
    await expect(app.canvas.item(link.workspaceItemId)).toContainText('quick brown fox')
    expect(link.pageNumber).toBe(1)
    // The linked region is exactly the area that was dragged (page fractions, to 0.005).
    expect(link.rect.x).toBeCloseTo(0.08, 2)
    expect(link.rect.y).toBeCloseTo(0.15, 2)
    expect(link.rect.width).toBeCloseTo(0.77, 2)
    expect(link.rect.height).toBeCloseTo(0.06, 2)
  })

  test('REG-047 Extract Image saves the region as an image item, its bytes and a link', { tag: '@P1' }, async ({ pdfOpen: app, page }) => {
    const css = (await app.viewer.canvasOf(1).boundingBox())!
    const dpr = await page.evaluate(() => window.devicePixelRatio)
    await app.viewer.tool('extract-image').click()
    await app.viewer.dragOnPage(1, [0.1, 0.08], [0.5, 0.2])
    await expectStoreCount(page, 'mediaBlobs', 1)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'image')
    await expectStoreCount(page, 'areaLinks', 1)
    const [blob] = await readStore<{ id: string; mimeType: string; data: { __bytes: number } }>(page, 'mediaBlobs')
    expect(blob.mimeType).toBe('image/png')
    expect(blob.data.__bytes).toBeGreaterThan(100)
    // The PNG has the dragged region's shape (40 % x 12 % of the page) at no less than its on-screen size.
    // The page canvas may be rendered sharper than it is shown (its backing size changes as it re-renders),
    // so the pixel size is a lower bound and the aspect ratio is the exact check.
    const png = await pngSizeOf(page, blob.id)
    expect(png.signature).toBe('89504e470d0a1a0a')
    expect(png.width).toBeGreaterThanOrEqual(Math.floor(0.4 * css.width * dpr) - 2)
    expect(png.height).toBeGreaterThanOrEqual(Math.floor(0.12 * css.height * dpr) - 2)
    expect(Math.abs(png.width / png.height - (0.4 * css.width) / (0.12 * css.height))).toBeLessThan(0.05)
    // And it shows what is on the page there: the same pixels as that region of page 1 (compared on a
    // coarse grid), with real ink in it ("Chapter One"), not a blank or a crop from somewhere else.
    const seen = await compareBlobWithPage(page, blob.id, 1, { x: 0.1, y: 0.08, width: 0.4, height: 0.12 })
    expect(seen.meanDiff, 'mean difference per channel from the page region (0-255)').toBeLessThan(12)
    expect(seen.darkShare, 'share of inked pixels in the extract').toBeGreaterThan(0.01)
    // The image item points at that blob and is shown on the canvas; the link covers the same region.
    const [item] = await readStore<ItemRow & { width: number; height: number }>(page, 'workspaceItems')
    expect(item.data).toMatchObject({ type: 'image', blobId: blob.id, mimeType: 'image/png', sourcePageNumber: 1, name: 'Page 1 excerpt' })
    expect(item.width).toBeCloseTo(Math.min(300, png.width / dpr), 0)
    await expect(app.canvas.item(item.id).locator('img')).toBeVisible()
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    expect(link.workspaceItemId).toBe(item.id)
    expect(link.rect.x).toBeCloseTo(0.1, 2)
    expect(link.rect.y).toBeCloseTo(0.08, 2)
    expect(link.rect.width).toBeCloseTo(0.4, 2)
    expect(link.rect.height).toBeCloseTo(0.12, 2)
  })

  test('REG-048 Link Area is disabled until an item is selected, then links the item to the region', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    await expect(app.viewer.tool('link-area')).toBeDisabled()
    const { noteId, link } = await linkedNote(app, page)
    expect(link.workspaceItemId).toBe(noteId)
    expect(link.pageNumber).toBe(1)
    // The stored region is the dragged one: 0.10-0.45 across, 0.14-0.22 down.
    expect(link.rect.x).toBeCloseTo(0.1, 2)
    expect(link.rect.y).toBeCloseTo(0.14, 2)
    expect(link.rect.width).toBeCloseTo(0.35, 2)
    expect(link.rect.height).toBeCloseTo(0.08, 2)
    await expect(app.viewer.areaLinks).toHaveCount(1)
    await expect(app.canvas.item(noteId)).toContainText('PAGE 1')
  })

  test('REG-049 removing an area link from the PDF deletes it', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const { noteId } = await linkedNote(app, page)
    await app.viewer.areaLinks.first().hover()
    await app.viewer.areaLinks.first().getByRole('button', { name: 'Remove link' }).click()
    await expectStoreCount(page, 'areaLinks', 0)
    await expect(app.viewer.areaLinks).toHaveCount(0)
    // Only the link went: the note stays, without its page badge.
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.id === noteId)
    await expect(app.canvas.item(noteId)).not.toContainText('PAGE 1')
  })
})

test.describe('Connection threads', { tag: ['@regression', '@links', '@geometry'] }, () => {
  test('REG-050 the thread joins the PDF region to its note', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    const { noteId, linkId } = await linkedNote(app, page)
    await app.canvas.select(noteId)
    await expectThreadAnchored(page, linkId, noteId)
  })

  test('REG-051 the thread follows the note when it is dragged', { tag: '@P1' }, async ({ pdfOpen: app, page }) => {
    const { noteId, linkId } = await linkedNote(app, page)
    await app.canvas.dragItem(noteId, 120, 90)
    await app.canvas.select(noteId)
    await expectThreadAnchored(page, linkId, noteId)
  })

  test('REG-052 the thread stays on its region after the PDF is zoomed', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const { noteId, linkId } = await linkedNote(app, page)
    await app.viewer.zoomIn.click()
    await app.viewer.zoomIn.click()
    await expect(app.viewer.zoomReset).toHaveText('120%')
    await app.viewer.pageRendered(1)
    await app.canvas.select(noteId)
    await expectThreadAnchored(page, linkId, noteId)
  })

  test('REG-053 the thread comes back after switching to another document and back', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const { noteId, linkId } = await linkedNote(app, page)
    await app.viewer.backToDocuments.click()
    await app.documents.openDocument(SECOND_PDF.displayName)
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    await expect(app.canvas.item(noteId)).toHaveCount(0)
    await app.viewer.backToDocuments.click()
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.canvas.select(noteId)
    await expectThreadAnchored(page, linkId, noteId)
  })

  test('REG-054 the PAGE badge on a linked note jumps the PDF to that page', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const { noteId } = await linkedNote(app, page)
    await app.viewer.jumpTo(4)
    await app.viewer.expectPage(4, FIND_PDF.pageCount)
    await app.canvas.item(noteId).getByTitle('Go to page 1').click()
    await app.viewer.expectPage(1, FIND_PDF.pageCount)
  })
})
