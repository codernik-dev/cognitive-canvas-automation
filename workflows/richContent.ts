/**
 * Every kind of content a project holds, made through the UI the way a person
 * makes it, in the open workspace (a PDF already open):
 *
 *   canvas   a written note, a typed text box, a link between them, a pen
 *            stroke, a line
 *   PDF      an area link from the note, highlights in three colours, an
 *            extracted image
 *   media    an MP3 audio note and a recorded MP4 video note
 *   more     a second PDF, and a Markdown document with a text highlight
 *
 * Shared by the backup round trip (REG-488) and the sharing fidelity tests,
 * which then compare the library row by row (helpers/backupState.ts).
 */
import { expect, type Page } from '@playwright/test'
import { readStore, expectStoreCount, type StoreName } from '../helpers/idb.js'
import { recordClip } from '../helpers/canvasMedia.js'
import { CanvasDialogs } from '../components/CanvasWorkbench.js'
import { TextDocTools, DocToolbar } from '../components/DocumentsTools.js'
import { BINARY, SECOND_PDF, TEXT_FILES } from '../data/files.js'
import type { CognitiveCanvas } from '../pages/CognitiveCanvas.js'

/** The stores that hold content once everything below is made (the rest stay empty). */
export const RICH_STORES = ['projects', 'documents', 'workspaceItems', 'highlights', 'itemLinks', 'areaLinks', 'canvasStrokes', 'mediaBlobs', 'textHighlights'] as const
/** The canvas item types made below. */
export const RICH_ITEM_TYPES = ['audio', 'image', 'line', 'note', 'text', 'video']

/** Wait until the debounced saves have written `counts` rows per store. */
export async function settle(page: Page, counts: Partial<Record<StoreName, number>>) {
  for (const [store, n] of Object.entries(counts) as [StoreName, number][]) await expectStoreCount(page, store, n, () => true, 30_000)
}

async function upload(app: CognitiveCanvas, file: Parameters<CognitiveCanvas['documents']['uploadFiles']>[0]) {
  await app.viewer.backToDocuments.click()
  await app.documents.uploadFiles(file)
}

/**
 * Make every kind of content in the open project `projectName`, then wait
 * until all three documents have their text index, so a snapshot taken next
 * holds everything. Ends on the project's document list.
 */
export async function addEveryKindOfContent(app: CognitiveCanvas, page: Page, projectName: string) {
  const dialogs = new CanvasDialogs(page)
  const text = new TextDocTools(page)
  const toolbar = new DocToolbar(page)

  // Canvas: a written note, a typed text box, a link between them, a pen stroke, a line.
  const note = (await app.canvas.place('note', 0.3, 0.25))!
  await app.canvas.writeNote(note, 'Round trip note')
  const box = (await app.canvas.place('text', 0.72, 0.25))!
  await app.canvas.select(box)
  await page.keyboard.type('Round trip text box')
  await page.keyboard.press('Escape')
  await app.canvas.linkItems(note, box)
  await app.canvas.tool('ink').click()
  const [ix, iy] = await app.canvas.pointAt(0.3, 0.7)
  await page.mouse.move(ix, iy)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(ix + i * 15, iy + Math.sin(i) * 20)
  await page.mouse.up()
  await app.canvas.tool('line').click()
  const [lx, ly] = await app.canvas.pointAt(0.6, 0.85)
  await page.mouse.move(lx - 80, ly)
  await page.mouse.down()
  await page.mouse.move(lx + 80, ly, { steps: 10 })
  await page.mouse.up()
  await settle(page, { workspaceItems: 3, itemLinks: 1, canvasStrokes: 1 })

  // PDF: an area link from the note, highlights in three colours, an extracted image.
  await app.canvas.select(note)
  await app.viewer.tool('link-area').click()
  await app.viewer.dragOnPage(1, [0.1, 0.14], [0.45, 0.22])
  await app.viewer.tool('highlight').click()
  for (const [i, colour] of (['Important', 'Critical', 'Agree'] as const).entries()) {
    // The palette folds away after each stroke.
    if (i > 0) await toolbar.openPalette.click()
    await app.viewer.colour(colour).click()
    await app.viewer.dragOnPage(1, [0.12, 0.3 + i * 0.05], [0.7, 0.3 + i * 0.05])
  }
  await app.viewer.tool('extract-image').click()
  await app.viewer.dragOnPage(1, [0.1, 0.5], [0.5, 0.62])
  await settle(page, { areaLinks: 2, highlights: 3, mediaBlobs: 1 })

  // Media: an MP3 audio note and a recorded MP4 video note.
  await app.canvas.place('audio', 0.82, 0.55)
  const audio = dialogs.media(dialogs.audio, 'Audio')
  await audio.tab('Upload').click()
  await audio.file.setInputFiles(BINARY.toneMp3)
  await audio.name.fill('Tone')
  await audio.create.click()
  await expect(dialogs.audio).toBeHidden({ timeout: 30_000 })
  const clip = await recordClip(page.context(), 2, 'mp4')
  await app.canvas.place('video', 0.5, 0.55)
  const video = dialogs.media(dialogs.video, 'Video')
  await video.file.setInputFiles({ name: 'round-trip.mp4', mimeType: 'video/mp4', buffer: clip.bytes })
  await video.create.click()
  await expect(dialogs.video).toBeHidden({ timeout: 30_000 })
  await settle(page, { mediaBlobs: 3, workspaceItems: 6 })

  // A second PDF, and a Markdown document with a text highlight.
  await upload(app, SECOND_PDF.payload())
  await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
  await upload(app, TEXT_FILES.markdown())
  await expect(text.markdownBody).toContainText('MARKDOWNMARKER')
  await text.highlight.click()
  await text.dragSelect(text.markdownBody, 'MARKDOWNMARKER')
  await settle(page, { documents: 3, textHighlights: 1 })

  // Let every upload finish its processing (the text index of all three documents).
  await app.header.home.click()
  await app.home.openProject(projectName)
  await expect.poll(async () => new Set((await readStore<{ documentId: string }>(page, 'searchText')).map((r) => r.documentId)).size, { timeout: 30_000 }).toBe(3)
}
