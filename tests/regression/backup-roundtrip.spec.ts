/**
 * Regression: full-fidelity Local backup round trips (backupService.ts
 * exportProjects, restoreService.ts restoreProject with preserveIds).
 *
 * The library is compared store by store and row by row (helpers/backupState.ts
 * snapshotDb: every field, and every binary field by length and SHA-256), so
 * "restored" means byte-identical, not "the counts look right". Only fields a
 * restore legitimately rewrites are left out, each one named with its reason.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { snapshotDb, ofProject, expectSameLibrary, RESTORED_STORES } from '../../helpers/backupState.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { recordClip } from '../../helpers/canvasMedia.js'
import { CanvasDialogs } from '../../components/CanvasWorkbench.js'
import { TextDocTools, DocToolbar } from '../../components/DocumentsTools.js'
import { BINARY, FIND_PDF, SECOND_PDF, TEXT_FILES } from '../../data/files.js'
import { exportAllLocal, restoreAndReload, projectIds, projectWithPdf, createProjects } from '../../workflows/backup.js'
import type { StoreName } from '../../helpers/idb.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page } from '@playwright/test'

/** Wait until the debounced saves have written `counts` rows per store. */
async function settle(page: Page, counts: Partial<Record<StoreName, number>>) {
  for (const [store, n] of Object.entries(counts) as [StoreName, number][]) await expectStoreCount(page, store, n, () => true, 30_000)
}

async function upload(app: CognitiveCanvas, file: Parameters<CognitiveCanvas['documents']['uploadFiles']>[0]) {
  await app.viewer.backToDocuments.click()
  await app.documents.uploadFiles(file)
}

test.describe('Full-fidelity round trip', { tag: ['@regression', '@backup', '@data-integrity'] }, () => {
  test('REG-488 every kind of content survives export, project deletion and restore byte for byte', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, project }, testInfo) => {
    // A long journey (twelve kinds of content, an export, a restore): the budget is for its length, not for a slow step.
    test.setTimeout(300_000)
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

    // Let every upload finish its processing (the text index of all three documents) before the snapshot.
    await app.header.home.click()
    await app.home.openProject(project.name)
    await expect.poll(async () => new Set((await readStore<{ documentId: string }>(page, 'searchText')).map((r) => r.documentId)).size, { timeout: 30_000 }).toBe(3)
    // The text index is not part of a backup (see the observations in the report), so it is not compared.
    const before = await snapshotDb(page, RESTORED_STORES)
    // Every kind made above is really there before the export (the remaining stores stay empty and are compared too).
    for (const store of ['projects', 'documents', 'workspaceItems', 'highlights', 'itemLinks', 'areaLinks', 'canvasStrokes', 'mediaBlobs', 'textHighlights'] as const) {
      expect(before[store]!.length, `${store} has content`).toBeGreaterThan(0)
    }
    expect(before.workspaceItems!.map((i) => i.type).sort()).toEqual(['audio', 'image', 'line', 'note', 'text', 'video'])

    await app.header.home.click()
    const { file } = await exportAllLocal(app, testInfo)
    const zip = BackupZip.fromFile(file)
    const [pid] = zip.manifest.projectIds
    // Every document, the Markdown one included, is packed as documents/<id>/file.pdf.
    expect(zip.documentFiles(pid)).toHaveLength(3)
    expect(Object.keys(zip.files).filter((n) => /^media\/[^/]+\/file\./.test(n))).toHaveLength(3)

    await app.home.deleteProject(project.name)
    for (const store of Object.keys(before) as StoreName[]) await expectStoreCount(page, store, 0, () => true, 30_000)
    await restoreAndReload(app, page, file)
    await app.home.reach()
    const after = await snapshotDb(page, RESTORED_STORES)
    expectSameLibrary(after, before, 'after restore')
    expect(await readStore(page, 'recordTombstones')).toEqual([])
  })
})

test.describe('Restore scope', { tag: ['@regression', '@backup', '@data-integrity'] }, () => {
  test('REG-490 restoring a two-project selection brings back exactly those two and leaves a third, changed since, alone', { tag: '@P1' }, async ({ signedIn: app, page }, testInfo) => {
    await projectWithPdf(app, page, 'Part One')
    await projectWithPdf(app, page, 'Part Two')
    await createProjects(app, ['Left Out'])
    const ids = await projectIds(page)
    // Export Part One + Left Out only.
    await app.dataCenter.openFromHeader()
    await app.dataCenter.source('Local').click()
    await app.dataCenter.projectRow('Part Two').click()
    const download = page.waitForEvent('download')
    await app.dataCenter.downloadZip.click()
    const file = testInfo.outputPath('subset.zip')
    await Promise.all([app.toasts.expectShown(/^Backup saved/, 30_000), (await download).saveAs(file)])
    expect([...BackupZip.fromFile(file).manifest.projectIds].sort()).toEqual([ids['Part One'], ids['Left Out']].sort())
    const before = await snapshotDb(page, RESTORED_STORES)

    await app.home.deleteProject('Part One')
    await app.home.deleteProject('Left Out')
    await app.home.renameProject('Part Two', 'Part Two Changed')
    const partTwoBefore = ofProject(await snapshotDb(page, RESTORED_STORES), ids['Part Two'])

    await restoreAndReload(app, page, file)
    const after = await snapshotDb(page, RESTORED_STORES)
    expect((after.projects ?? []).map((p) => p.id).sort()).toEqual(Object.values(ids).sort())
    expectSameLibrary(ofProject(after, ids['Part One']), ofProject(before, ids['Part One']), 'Part One')
    expectSameLibrary(ofProject(after, ids['Left Out']), ofProject(before, ids['Left Out']), 'Left Out')
    // Not in the backup: untouched, rename included.
    expectSameLibrary(ofProject(after, ids['Part Two']), partTwoBefore, 'Part Two')
    expect(after.projects!.find((p) => p.id === ids['Part Two'])!.name).toBe('Part Two Changed')
  })

  test('REG-491 restoring over a project edited since its backup replaces it exactly: added work removed, changed work reverted, nothing duplicated', { tag: '@P1' }, async ({ pdfOpen: app, page, project }, testInfo) => {
    const note = (await app.canvas.place('note', 0.4, 0.3))!
    await app.canvas.writeNote(note, 'Original words')
    await settle(page, { workspaceItems: 1 })
    await app.header.home.click()
    const { file } = await exportAllLocal(app, testInfo)
    const before = await snapshotDb(page, RESTORED_STORES)

    // Edit after the backup: change the note, add a second one and a highlight.
    await app.home.openProject(project.name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.canvas.writeNote(note, ' and later words')
    await app.canvas.place('note', 0.7, 0.6)
    await app.viewer.tool('highlight').click()
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    await settle(page, { workspaceItems: 2, highlights: 1 })
    await expect.poll(async () => JSON.stringify((await readStore(page, 'workspaceItems')).find((i) => i.id === note))).toContain('later words')

    await app.header.home.click()
    await restoreAndReload(app, page, file)
    const after = await snapshotDb(page, RESTORED_STORES)
    expectSameLibrary(after, before, 'after restoring over the edits')
    expect(after.projects).toHaveLength(1)
  })
})
