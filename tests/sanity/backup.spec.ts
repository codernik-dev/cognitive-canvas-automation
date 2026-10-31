/** Sanity: a local backup is complete and restores what it holds. */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { snapshotDb, expectSameLibrary, RESTORED_STORES } from '../../helpers/backupState.js'
import { FIND_PDF } from '../../data/files.js'
import { test as account } from '../../fixtures/backup.js'
import { exportProjectWithContent, restoreAndReload, projectWithPdf, answerNextDialog, RESTORE_CONFIRM } from '../../workflows/backup.js'
import type { GitRepo } from '../../helpers/mocks/moBrowserBridge.js'

const REPO: GitRepo = { id: 'e2e-repo-1', name: 'Test backups', owner: 'e2e-owner', repository: 'cc-test-backups', branch: 'main' }

test.describe('Backup sanity', { tag: ['@sanity', '@backup', '@P1'] }, () => {
  test('SAN-010 a local backup downloads a ZIP holding the project, its PDF and its notes', async ({ pdfOpen: app, page, project }, testInfo) => {
    const { file, suggestedName } = await exportProjectWithContent(app, page, testInfo)
    expect(suggestedName).toMatch(/\.zip$/)
    const zip = BackupZip.fromFile(file)
    const [proj] = await readStore<{ id: string }>(page, 'projects')
    expect(zip.manifest).toMatchObject({ version: 1, appName: 'cognitive-canvas' })
    expect(zip.manifest.projectIds).toEqual([proj.id])
    const root = zip.projectRoot(proj.id)
    expect(zip.json<{ name: string }>(`${root}project.json`).name).toBe(project.name)
    expect(JSON.stringify(zip.json(`${root}data/workspaceItems.json`))).toContain('Backed up note')
    expect(zip.json<unknown[]>(`${root}data/highlights.json`)).toHaveLength(1)
    // The rows in the ZIP are the rows in the database, field for field.
    for (const store of ['workspaceItems', 'highlights', 'itemLinks', 'areaLinks', 'canvasStrokes'] as const) {
      expect(zip.json<unknown[]>(`${root}data/${store}.json`), store).toEqual(await readStore(page, store))
    }
    expect(zip.json<{ id: string }>(`${root}project.json`)).toEqual(proj)
    const pdfs = zip.documentFiles(proj.id)
    expect(pdfs).toHaveLength(1)
    expect(Buffer.from(zip.files[pdfs[0]]).equals(FIND_PDF.payload().buffer), 'the PDF bytes round-trip unchanged').toBe(true)
  })

  test('SAN-011 restoring the backup after deleting the project brings back its PDF, note and highlight', async ({ pdfOpen: app, page, project }, testInfo) => {
    const { noteId, file } = await exportProjectWithContent(app, page, testInfo)
    const before = await snapshotDb(page, RESTORED_STORES)
    await app.home.deleteProject(project.name)
    await expectStoreCount(page, 'projects', 0)

    await restoreAndReload(app, page, file)
    expectSameLibrary(await snapshotDb(page, RESTORED_STORES), before, 'after restore')
    await app.home.reach()
    await app.home.openProject(project.name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(app.canvas.item(noteId)).toContainText('Backed up note')
    await expect(app.viewer.highlights).toHaveCount(1)
  })
})

/**
 * GitHub through the MoBrowser host, against the bridge stub
 * (helpers/mocks/moBrowserBridge.ts): a dedicated test repository that
 * exists only in memory. The detailed protocol checks are in
 * tests/regression/backup-github.spec.ts.
 */
account.describe('GitHub backup sanity (MoBrowser bridge stub)', { tag: ['@sanity', '@backup', '@github', '@api'] }, () => {
  account.use({ muulPlan: 'dev', moBrowser: { repos: [REPO], gitChunkBytes: 1024 } })

  account('SAN-007 a backup pushed to the test repository is listed there and restores the deleted project', { tag: '@P1' }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    const { projectId } = await projectWithPdf(app, page, 'Git Trip')
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Backup', 'GitHub')
    await expect(dc.panelHeading).toHaveText('Back up to GitHub')
    // One connected repository is chosen without asking.
    await expect(dc.chooser('repository')).toHaveText('Test backupse2e-owner/cc-test-backups · main')
    await expect(dc.dialog.getByText('One-off push to "Test backups". For scheduled backups, use Auto Backup.')).toBeVisible()
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backed up to Test backups', 30_000)
    expect(bridge.pushes).toHaveLength(1)
    expect(new BackupZip(bridge.pushes[0].bytes).manifest.projectIds).toEqual([projectId])
    await dc.close.click()

    await app.home.deleteProject('Git Trip')
    await expectStoreCount(page, 'projects', 0)
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Restore', 'GitHub')
    await expect(dc.panelHeading).toHaveText('Restore from GitHub')
    await dc.destinationRow('Test backups').click()
    await expect(dc.restoreRows).toHaveCount(1)
    await expect(dc.restoreRows.first()).toContainText('Latest')
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreRows.first().click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await app.toasts.expectShown('Restored from GitHub — refreshing…', 30_000)
    await loaded
    await app.home.reach()
    expect((await readStore<{ id: string }>(page, 'projects')).map((p) => p.id)).toEqual([projectId])
    const [doc] = await readStore<{ name: string; data: { __bytes: number } }>(page, 'documents')
    expect(doc).toMatchObject({ name: FIND_PDF.displayName, data: { __bytes: FIND_PDF.payload().buffer.length } })
    // The ranged read path: size first, then the bytes.
    expect(bridge.sent('GIT_STAT')).toHaveLength(1)
    expect(bridge.sent('GIT_PULL').filter((m) => (m.payload as { offset?: number }).offset !== undefined).length).toBeGreaterThan(0)
  })
})
