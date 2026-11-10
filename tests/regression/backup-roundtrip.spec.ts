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
import { FIND_PDF } from '../../data/files.js'
import { exportAllLocal, restoreAndReload, projectIds, projectWithPdf, createProjects } from '../../workflows/backup.js'
import { addEveryKindOfContent, settle, RICH_STORES, RICH_ITEM_TYPES } from '../../workflows/richContent.js'
import type { StoreName } from '../../helpers/idb.js'

test.describe('Full-fidelity round trip', { tag: ['@regression', '@backup', '@data-integrity'] }, () => {
  test('REG-488 every kind of content survives export, project deletion and restore byte for byte', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, project }, testInfo) => {
    // A long journey (twelve kinds of content, an export, a restore): the budget is for its length, not for a slow step.
    test.setTimeout(300_000)
    await addEveryKindOfContent(app, page, project.name)
    // The text index is not part of a backup (see the observations in the report), so it is not compared.
    const before = await snapshotDb(page, RESTORED_STORES)
    // Every kind made above is really there before the export (the remaining stores stay empty and are compared too).
    for (const store of RICH_STORES) {
      expect(before[store]!.length, `${store} has content`).toBeGreaterThan(0)
    }
    expect(before.workspaceItems!.map((i) => i.type).sort()).toEqual(RICH_ITEM_TYPES)

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
