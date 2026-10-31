/**
 * Regression: backup to, and restore from, a local folder inside MoBrowser
 * (BackupDestinations local-backup / local-restore panels,
 * services/backup/vaultDestinations.ts, runBackup.ts). The folders and the
 * disk are the host stub's (helpers/mocks/moBrowserBridge.ts), kept in Node
 * so they survive the reload every restore ends with.
 *
 * Local backup needs no plan, so these run signed out.
 */
import { test, expect } from '../../fixtures/backup.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { snapshotDb, expectSameLibrary, RESTORED_STORES } from '../../helpers/backupState.js'
import { FIND_PDF } from '../../data/files.js'
import type { LocalFolder } from '../../helpers/mocks/moBrowserBridge.js'
import { createProjects, projectWithPdf, answerNextDialog, RESTORE_CONFIRM, BACKUP_FILE_NAME } from '../../workflows/backup.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

const FOLDER: LocalFolder = { id: 'e2e-folder-1', name: 'School backups', path: '/e2e/School' }
const SUB = '/e2e/School/CognitiveCanvas'

async function openLocal(app: CognitiveCanvas, mode: 'Backup' | 'Restore') {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.choose(mode, 'Local')
  await expect(app.dataCenter.panelHeading).toHaveText(mode === 'Backup' ? 'Back up to a local folder' : 'Restore from a folder')
}

async function chooseFolder(app: CognitiveCanvas, name = FOLDER.name) {
  await app.dataCenter.chooser('folder').click()
  await app.dataCenter.menuOption(name).click()
}

test.describe('Local folder backup in MoBrowser', { tag: ['@regression', '@backup', '@folder'] }, () => {
  test.use({ muulPlan: null, moBrowser: { folders: [FOLDER], folderChunkBytes: 1024 } })

  test('REG-103 a backup streamed into the chosen folder restores the deleted project from that folder', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    const { projectId } = await projectWithPdf(app, page, 'Folder Trip')
    await openLocal(app, 'Backup')
    // MoBrowser replaces the .zip download with the folder flow.
    await expect(dc.downloadZip).toHaveCount(0)
    await expect(dc.dialog.getByText('Choose a folder on this device, then run a backup right now.')).toBeVisible()
    // Never guessed, even with one folder.
    await expect(dc.chooser('folder')).toHaveText('Choose a folder…')
    await expect(dc.backUpNow).toBeDisabled()
    await expect(dc.dialog.getByText('One-off backup to the chosen folder. For scheduled backups, use Auto Backup.')).toBeVisible()
    await chooseFolder(app)
    await expect(dc.chooser('folder')).toHaveText('School backups/e2e/School')
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('cc2_backup_prefs_v1')))!)).toMatchObject({ defaultLocalDestId: FOLDER.id })
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backed up to "School backups"', 30_000)

    // The write protocol: probe, make the CognitiveCanvas subfolder, then one streamed file.
    expect(bridge.sent('backup', 'createFolder')[0]).toMatchObject({ folderPath: FOLDER.path, name: 'CognitiveCanvas' })
    const [begin] = bridge.sent('backup', 'beginWrite')
    expect(begin).toMatchObject({ folderPath: SUB, filename: expect.stringMatching(BACKUP_FILE_NAME) })
    const chunks = bridge.sent('backup', 'writeChunk')
    expect(chunks.length).toBe(Math.ceil(Number(begin.totalBytes) / 1024))
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i))
    expect(bridge.sent('backup', 'endWrite')[0]).toMatchObject({ totalBytes: begin.totalBytes })
    expect(bridge.filesIn(SUB)).toEqual([begin.filename])
    const zip = new BackupZip(bridge.disk.get(`${SUB}/${String(begin.filename)}`)!)
    expect(zip.manifest.projectIds).toEqual([projectId])
    // The file on disk holds the PDF itself, byte for byte.
    expect(zip.documentFiles(projectId)).toHaveLength(1)
    expect(Buffer.from(zip.files[zip.documentFiles(projectId)[0]]).equals(FIND_PDF.payload().buffer)).toBe(true)
    await dc.close.click()

    const before = await snapshotDb(page, RESTORED_STORES)
    await app.home.deleteProject('Folder Trip')
    await expectStoreCount(page, 'projects', 0)
    await openLocal(app, 'Restore')
    await expect(dc.dialog.getByText('Choose a folder, then pick a backup by date to restore.')).toBeVisible()
    await dc.destinationRow('School backups').click()
    await expect(dc.restoreRows).toHaveCount(1)
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreRows.first().click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await app.toasts.expectShown(`Restored from "${String(begin.filename)}" — refreshing…`, 30_000)
    await loaded
    await app.home.reach()
    expect((await readStore<{ id: string }>(page, 'projects')).map((p) => p.id)).toEqual([projectId])
    // Read back from the folder 1 KB at a time, the library is exactly what was backed up (every field; PDF bytes by SHA-256).
    expectSameLibrary(await snapshotDb(page, RESTORED_STORES), before, 'restored from the folder')
    expect(bridge.sent('backup', 'stat')).toHaveLength(1)
  })

  test('REG-466 a backup note is saved beside the backups and shown on the restore row', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Noted Folder'])
    await openLocal(app, 'Backup')
    await chooseFolder(app)
    await dc.noteInput.fill('End of week 3')
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backup saved: End of week 3', 30_000)
    await expect(dc.noteInput).toHaveValue('')
    const [file] = bridge.filesIn(SUB).filter((f) => f.endsWith('.zip'))
    expect(JSON.parse(bridge.disk.get(`${SUB}/cc-backup-descriptions.json`)!.toString('utf8'))).toEqual({ [file]: 'End of week 3' })

    await dc.modeToggle('Restore').click()
    await dc.destinationRow('School backups').click()
    await expect(dc.restoreRows.first()).toHaveAccessibleName(/^Restore backup from .+ — End of week 3$/)
    await expect(dc.restoreRows.first()).toContainText('End of week 3')
  })

  test('REG-467 the restore list shows only this app\'s backups, from the subfolder and the folder itself, newest name first', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    const zip = Buffer.alloc(3000)
    bridge.putFile(`${SUB}/cc-backup-2026-10-01_09-30-00.zip`, zip)
    bridge.putFile(`${SUB}/cc-backup-2026-10-05_14-05-00.zip`, zip)
    bridge.putFile(`${FOLDER.path}/cc_backup_2026-09-01_08-00-00.zip`, zip)
    bridge.putFile(`${FOLDER.path}/old-copy.ccbak`, zip)
    bridge.putFile(`${FOLDER.path}/other-app-backup.zip`, zip)
    bridge.putFile(`${FOLDER.path}/notes.txt`, zip)
    bridge.putFile(`${FOLDER.path}/Unrelated/cc-backup-2026-01-01_00-00-00.zip`, zip)
    await openLocal(app, 'Restore')
    await dc.destinationRow('School backups').click()
    await expect(dc.dialog.getByText('Backups in School backups — restoring overwrites projects with the same name.')).toBeVisible()
    const names = ['cc-backup-2026-10-01_09-30-00.zip', 'cc-backup-2026-10-05_14-05-00.zip', 'cc_backup_2026-09-01_08-00-00.zip', 'old-copy.ccbak'].sort((a, b) => b.localeCompare(a))
    const label = (n: string) => ({
      'cc-backup-2026-10-01_09-30-00.zip': 'Restore backup from Oct 1, 9:30 AM',
      'cc-backup-2026-10-05_14-05-00.zip': 'Restore backup from Oct 5, 2:05 PM',
      'cc_backup_2026-09-01_08-00-00.zip': 'Restore backup from Sep 1, 8:00 AM',
      'old-copy.ccbak': 'Restore backup from old-copy.ccbak',
    } as Record<string, string>)[n]
    await expect(dc.restoreRows).toHaveCount(4)
    for (const [i, n] of names.entries()) await expect(dc.restoreRows.nth(i)).toHaveAccessibleName(label(n))
    await expect(dc.restoreRows.nth(0)).toContainText('Latest')
    await expect(dc.restoreRows.nth(1)).not.toContainText('Latest')
    await expect(dc.restoreRows.filter({ hasText: 'Oct 1, 9:30 AM' })).toContainText('3 KB')
  })

  test('REG-468 an empty folder says so, ← Folders goes back, and a folder backup the host returns short fails without changing anything', { tag: '@P2' }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Unchanged'])
    await openLocal(app, 'Restore')
    await dc.destinationRow('School backups').click()
    await expect(dc.dialog.getByText('No backups found in this folder.')).toBeVisible()
    await dc.backToFolders.click()
    await expect(dc.destinationRow('School backups')).toBeVisible()

    const path = `${SUB}/cc-backup-2026-10-05_14-05-00.zip`
    bridge.putFile(path, Buffer.alloc(4096, 7))
    bridge.statOverride.set(path, 9999)
    const before = await readStore(page, 'projects')
    await dc.destinationRow('School backups').click()
    const accepted = answerNextDialog(page, true)
    await dc.restoreRows.first().click()
    await accepted
    await app.toasts.expectShown('Restore failed: Could not read the backup (missing or incomplete)', 30_000)
    expect(await readStore(page, 'projects')).toEqual(before)
    await expect(dc.restoreRows.first()).toBeEnabled()
  })

  test('REG-469 a write the host refuses is reported, the partial file is abandoned and nothing is left on disk', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    await createProjects(app, ['Disk Full'])
    await openLocal(app, 'Backup')
    await chooseFolder(app)
    bridge.override('backup', { ok: false, error: 'Disk full' }, { action: 'endWrite' })
    await app.dataCenter.backUpNow.click()
    await app.toasts.expectShown('Backup failed: Disk full', 30_000)
    expect(bridge.sent('backup', 'abortWrite')).toHaveLength(1)
    expect(bridge.filesIn(SUB)).toEqual([])
  })
})

test.describe('Local folders configured in the browser', { tag: ['@regression', '@backup', '@folder'] }, () => {
  test.use({ muulPlan: null, moBrowser: { folders: [] } })
  test('REG-470 with no folder in the browser both panels say how to add one, and Refresh folders picks up a new one', { tag: '@P3' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['No Folder Yet'])
    await openLocal(app, 'Restore')
    await expect(dc.dialog.getByText('No local folders to restore from.')).toBeVisible()
    await dc.modeToggle('Backup').click()
    await dc.chooser('folder').click()
    await expect(dc.dialog.getByText("No folders yet. Add one in the browser's credential manager.")).toBeVisible()
    bridge.folders = [FOLDER]
    await dc.refreshFolders.click()
    await dc.menuOption(FOLDER.name).click()
    await expect(dc.backUpNow).toBeEnabled()
  })
})
