/**
 * A project holding every kind of content the app stores, built through the
 * UI exactly as the full-fidelity backup round trip (REG-488) builds it, plus
 * the readers the persistence sweep uses to prove it all came back.
 *
 *   canvas   a written note, a typed text box, a link between them, a pen
 *            stroke, a line, an MP3 audio note and (optionally) a recorded
 *            MP4 video note
 *   PDF      an area link from the note, highlights in three colours, an
 *            extracted image
 *   files    FIND_PDF, SECOND_PDF and a Markdown document with a text highlight
 */
import { expect, type Page } from '@playwright/test'
import type { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { CanvasDialogs } from '../components/CanvasWorkbench.js'
import { TextDocTools, DocToolbar } from '../components/DocumentsTools.js'
import { CanvasInk } from '../pages/PlatformScreens.js'
import { recordClip } from './canvasMedia.js'
import { readStore, expectStoreCount, type StoreName } from './idb.js'
import { BINARY, FIND_PDF, SECOND_PDF, TEXT_FILES } from '../data/files.js'

export const EVERY_KIND_TEXT = { note: 'Every kind note', box: 'Every kind text box' }

export interface EveryKind {
  noteId: string
  boxId: string
  projectId: string
  /** Workspace item types created, sorted. */
  types: string[]
}

/** Wait until the debounced saves have written `counts` rows per store. */
export async function settle(page: Page, counts: Partial<Record<StoreName, number>>) {
  for (const [store, n] of Object.entries(counts) as [StoreName, number][]) await expectStoreCount(page, store, n, () => true, 30_000)
}

/**
 * Build the project from an open FIND_PDF (the pdfOpen state). `video` adds a
 * recorded MP4 note; it needs Chromium's fake camera (the chromium project, or
 * a persistent context launched with the same flags).
 */
export async function buildEveryKind(app: CognitiveCanvas, page: Page, projectName: string, opts: { video: boolean } = { video: true }): Promise<EveryKind> {
  const dialogs = new CanvasDialogs(page)
  const text = new TextDocTools(page)
  const toolbar = new DocToolbar(page)

  const noteId = (await app.canvas.place('note', 0.3, 0.25))!
  await app.canvas.writeNote(noteId, EVERY_KIND_TEXT.note)
  const boxId = (await app.canvas.place('text', 0.72, 0.25))!
  await app.canvas.select(boxId)
  await page.keyboard.type(EVERY_KIND_TEXT.box)
  await page.keyboard.press('Escape')
  await app.canvas.linkItems(noteId, boxId)
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

  await app.canvas.select(noteId)
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

  await app.canvas.place('audio', 0.82, 0.55)
  const audio = dialogs.media(dialogs.audio, 'Audio')
  await audio.tab('Upload').click()
  await audio.file.setInputFiles(BINARY.toneMp3)
  await audio.name.fill('Tone')
  await audio.create.click()
  await expect(dialogs.audio).toBeHidden({ timeout: 30_000 })
  let items = 5
  let blobs = 2
  if (opts.video) {
    const clip = await recordClip(page.context(), 2, 'mp4')
    await app.canvas.place('video', 0.5, 0.55)
    const video = dialogs.media(dialogs.video, 'Video')
    await video.file.setInputFiles({ name: 'every-kind.mp4', mimeType: 'video/mp4', buffer: clip.bytes })
    await video.create.click()
    await expect(dialogs.video).toBeHidden({ timeout: 30_000 })
    items++
    blobs++
  }
  await settle(page, { mediaBlobs: blobs, workspaceItems: items })

  await app.viewer.backToDocuments.click()
  await app.documents.uploadFiles(SECOND_PDF.payload())
  await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
  await app.viewer.backToDocuments.click()
  await app.documents.uploadFiles(TEXT_FILES.markdown())
  await expect(text.markdownBody).toContainText('MARKDOWNMARKER')
  await text.highlight.click()
  await text.dragSelect(text.markdownBody, 'MARKDOWNMARKER')
  await settle(page, { documents: 3, textHighlights: 1 })

  // Let every upload finish its text index (one row set per document) before anyone snapshots.
  await app.header.home.click()
  await app.home.openProject(projectName)
  await expect.poll(async () => new Set((await readStore<{ documentId: string }>(page, 'searchText')).map((r) => r.documentId)).size, { timeout: 30_000 }).toBe(3)

  const project = (await readStore<{ id: string; name: string }>(page, 'projects')).find((p) => p.name === projectName)!
  const types = (await readStore<{ type: string }>(page, 'workspaceItems')).map((i) => i.type).sort()
  return { noteId, boxId, projectId: project.id, types }
}

/**
 * Prove through the UI that every kind is on screen again: the three
 * documents on the list, then on FIND_PDF the note and text box words, the
 * link, the three highlights, the area links, the line, the image, audio and
 * video cards and the stroke; then the Markdown document's highlight.
 */
export async function expectEveryKindOnScreen(app: CognitiveCanvas, page: Page, built: EveryKind, projectName: string) {
  await app.home.reach()
  await app.home.openProject(projectName)
  await app.documents.expectOpen(projectName)
  for (const name of [FIND_PDF.displayName, SECOND_PDF.displayName, TEXT_FILES.markdown().name]) await expect(app.documents.card(name)).toBeVisible()
  await app.documents.openDocument(FIND_PDF.displayName)
  await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
  await expect(app.canvas.item(built.noteId)).toContainText(EVERY_KIND_TEXT.note)
  await expect(app.canvas.item(built.boxId)).toContainText(EVERY_KIND_TEXT.box)
  await expect(app.canvas.itemLinks).toHaveCount(1)
  await expect(app.viewer.highlights).toHaveCount(3)
  await expect(app.viewer.areaLinks.first()).toBeAttached()
  await expect(app.canvas.lines).toHaveCount(1)
  const items = await readStore<{ id: string; type: string }>(page, 'workspaceItems')
  for (const kind of ['image', 'audio', 'video']) {
    for (const it of items.filter((i) => i.type === kind)) await expect(app.canvas.item(it.id), `${kind} card on the canvas`).toBeVisible()
  }
  await expect(app.canvas.item(items.find((i) => i.type === 'image')!.id).locator('img')).toBeVisible()
  await expect(new CanvasInk(page).paths).toHaveCount(1)
  await app.viewer.backToDocuments.click()
  await app.documents.openDocument(TEXT_FILES.markdown().name)
  const text = new TextDocTools(page)
  await expect(text.markdownBody).toContainText('MARKDOWNMARKER')
  await expect(text.marks).toHaveCount(1)
  await expect(text.marks).toHaveText('MARKDOWNMARKER')
}

export interface LegacyContent {
  projectId: string
  documentId: string
  /** Note id -> its words. */
  notes: Record<string, string>
}

/**
 * A smaller project for the migration specs, made from an open FIND_PDF:
 * two written notes and a link between them, one highlight, one pen stroke,
 * an area link from the first note, an extracted image (a media blob), and a
 * third note deleted again (which leaves a record tombstone, the v12 store).
 */
export async function buildLegacyContent(app: CognitiveCanvas, page: Page, projectName: string): Promise<LegacyContent> {
  const a = (await app.canvas.place('note', 0.3, 0.3))!
  await app.canvas.writeNote(a, 'Legacy note one')
  const b = (await app.canvas.place('note', 0.7, 0.3))!
  await app.canvas.writeNote(b, 'Legacy note two')
  await app.canvas.linkItems(a, b)
  const doomed = (await app.canvas.place('note', 0.5, 0.75))!
  await settle(page, { workspaceItems: 3, itemLinks: 1 })
  await app.canvas.select(doomed)
  await page.keyboard.press('Delete')
  await settle(page, { workspaceItems: 2, recordTombstones: 1 })
  await app.canvas.tool('ink').click()
  const [x, y] = await app.canvas.pointAt(0.4, 0.85)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y + 10, { steps: 8 })
  await page.mouse.up()
  // The pen stays armed (a click would draw): back to Pan before selecting.
  await app.canvas.tool('pan').click()
  await app.canvas.select(a)
  await app.viewer.tool('link-area').click()
  await app.viewer.dragOnPage(1, [0.1, 0.14], [0.45, 0.22])
  await app.viewer.tool('highlight').click()
  await app.viewer.dragOnPage(1, [0.12, 0.3], [0.7, 0.3])
  await app.viewer.tool('extract-image').click()
  await app.viewer.dragOnPage(1, [0.1, 0.5], [0.5, 0.62])
  await settle(page, { canvasStrokes: 1, highlights: 1, areaLinks: 2, mediaBlobs: 1, workspaceItems: 3 })
  await expect.poll(async () => (await readStore(page, 'searchText')).length, { timeout: 30_000 }).toBe(FIND_PDF.pageCount)
  const project = (await readStore<{ id: string; name: string }>(page, 'projects')).find((p) => p.name === projectName)!
  const doc = (await readStore<{ id: string }>(page, 'documents'))[0]
  return { projectId: project.id, documentId: doc.id, notes: { [a]: 'Legacy note one', [b]: 'Legacy note two' } }
}
