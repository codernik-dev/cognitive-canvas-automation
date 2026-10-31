/**
 * Regression: dropping onto the canvas (WorkspaceDropHandler.tsx,
 * documents/PdfTextDragHandler.tsx, services/layout/fileDropGuard.ts).
 *
 * The canvas takes one kind of drop: a PDF text excerpt
 * ('application/x-cc-excerpt'), which becomes a note linked to its page.
 * Files dropped on the canvas are not a canvas feature; the app-wide guard
 * must still keep the tab on the app and say what to do.
 *
 * Synthetic drops use a DataTransfer built in the page and Playwright's
 * dispatchEvent (helpers/canvasMedia.ts dropOn), the supported way to emulate
 * a drop.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { dropOn } from '../../helpers/canvasMedia.js'
import { FIND_PDF, IMAGES } from '../../data/files.js'

interface NoteData { type: 'note'; content: string; sourceExcerpt: string | null; sourcePageNumber: number | null; color: string }
const EXCERPT = 'Canvas threads link highlights to notes.'

test.describe('Dropping onto the canvas', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-392 a dropped PDF excerpt becomes a note at the drop point, linked to its page, and its PAGE badge jumps there', { tag: ['@P2', '@sanity'] }, async ({ pdfOpen: app, ws, page, docId }) => {
    // Whole pixels: a drag event reports the pointer in whole CSS pixels.
    const raw = await ws.at(0.6, 0.4)
    const at = { x: Math.round(raw.x), y: Math.round(raw.y) }
    const world = await ws.screenToWorld(at)
    await dropOn(page, ws.surface, at, { items: { 'application/x-cc-excerpt': JSON.stringify({ text: EXCERPT, pageNumber: 2, documentId: docId }), 'text/plain': EXCERPT } })
    await expectStoreCount(page, 'workspaceItems', 1)
    const [row] = await readStore<ItemRow<NoteData>>(page, 'workspaceItems')
    expect(row).toMatchObject({ type: 'note', documentId: docId, width: 200, height: 120 })
    expect(row.x).toBeCloseTo(world.x - 100, 0)
    expect(row.y).toBeCloseTo(world.y - 60, 0)
    expect(row.data).toMatchObject({ type: 'note', content: EXCERPT, sourceExcerpt: EXCERPT, sourcePageNumber: 2, color: 'yellow' })
    await ws.expectSelected(row.id)
    await expect(ws.item(row.id)).toContainText(EXCERPT)
    const badge = ws.item(row.id).getByRole('button', { name: 'PAGE 2' })
    await expect(badge).toHaveAttribute('title', 'Go to page 2')
    await app.viewer.jumpTo(4)
    await app.viewer.expectPage(4, FIND_PDF.pageCount)
    await badge.click()
    await app.viewer.expectPage(2, FIND_PDF.pageCount)

    // The timeline names the page too.
    await ws.timelineToggle.click()
    await expect(page.locator(`div.max-w-2xl [data-item-id="${row.id}"]`)).toContainText('p. 2')
  })

  test('REG-393 a drop with a broken excerpt, or with no excerpt at all, creates nothing', { tag: '@P3' }, async ({ ws, page }) => {
    const at = await ws.at(0.5, 0.5)
    await dropOn(page, ws.surface, at, { items: { 'application/x-cc-excerpt': '{not json' } })
    await dropOn(page, ws.surface, at, { items: { 'text/plain': 'just some words' } })
    // Sentinel note: had either drop created a note, there would be two.
    await ws.place('note', 0.3, 0.3)
    await expectStoreCount(page, 'workspaceItems', 1)
    await expect(ws.items).toHaveCount(1)
  })

  test('REG-394 a picture dropped on the open canvas keeps the app open, adds nothing and is not reported as "Open a project first"', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    const url = page.url()
    await dropOn(page, ws.surface, await ws.at(0.5, 0.5), { files: [IMAGES.png()] })
    // The tab stays on the app: no navigation to the dropped file.
    expect(page.url()).toBe(url)
    await expect(ws.surface).toBeVisible()
    await ws.place('note', 0.3, 0.3)
    await expectStoreCount(page, 'workspaceItems', 1)
    // Nor did the picture go anywhere else: no new document, no stored image.
    await expectStoreCount(page, 'documents', 1)
    await expectStoreCount(page, 'mediaBlobs', 0)
    // A project IS open, so the guard's "no project" hint would be wrong here.
    await expect(app.toasts.withText('Open a project first, then drop files there to add them.')).toHaveCount(0)
  })
  // Real selected PDF text dragged with the mouse is REG-290 (text-selection.spec.ts, DEF-207).
})
