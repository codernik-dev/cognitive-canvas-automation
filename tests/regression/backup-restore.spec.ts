/**
 * Regression: restore edge cases through the Data Center's "Local" source.
 * Every file involved lives in the test's output folder and its throwaway
 * browser profile; nothing touches a real backup, repository or cloud.
 */
import { test, expect } from '../../fixtures/test.js'
import { expectStoreCount } from '../../helpers/idb.js'
import { zipWithout } from '../../helpers/backupZip.js'
import { knownDefect } from '../../helpers/defects.js'
import { snapshotDb, expectSameLibrary, RESTORED_STORES } from '../../helpers/backupState.js'
import { exportProjectWithContent, restoreAndReload } from '../../workflows/backup.js'

test.describe('Restore rules', { tag: ['@regression', '@backup'] }, () => {
  test('REG-070 restoring a backup over the same project replaces it row for row instead of duplicating it', { tag: '@P2' }, async ({ pdfOpen: app, page }, testInfo) => {
    const { file } = await exportProjectWithContent(app, page, testInfo)
    const before = await snapshotDb(page, RESTORED_STORES)
    await restoreAndReload(app, page, file)
    await expectStoreCount(page, 'projects', 1)
    await expectStoreCount(page, 'documents', 1)
    await expectStoreCount(page, 'workspaceItems', 1)
    await expectStoreCount(page, 'highlights', 1)
    // Same ids, same fields, same bytes: only the restore's own timestamps move.
    expectSameLibrary(await snapshotDb(page, RESTORED_STORES), before, 'after restoring over itself')
  })

  test('REG-071 cancelling the restore confirmation changes nothing', { tag: '@P2' }, async ({ pdfOpen: app, page }, testInfo) => {
    const { file } = await exportProjectWithContent(app, page, testInfo)
    const before = await snapshotDb(page)
    await app.dataCenter.openFromHeader()
    await app.dataCenter.restoreLocal(file, false)
    await expect(app.dataCenter.restoreNow).toBeEnabled()
    await expect(app.dataCenter.dialog.getByText('Restoring your data…')).toHaveCount(0)
    expect(await snapshotDb(page)).toEqual(before)
  })
})

test.describe('Invalid backups', { tag: ['@regression', '@backup', '@files'] }, () => {
  test.beforeEach(async ({ project: _p, app }) => {
    await app.header.home.click()
    await app.dataCenter.openFromHeader()
  })

  test('REG-072 a file that is not a ZIP is refused with the reason', { tag: '@P2' }, async ({ app, page }) => {
    knownDefect('DEF-002')
    await app.dataCenter.restoreLocal({ name: 'not-a-backup.zip', mimeType: 'application/zip', buffer: Buffer.from('plain text, not a zip') })
    await expect(page.getByText('This file is not a ZIP archive, so it cannot be a backup or a catalog package.')).toBeVisible({ timeout: 20_000 })
  })

  test('REG-073 a ZIP that is not a Cognitive Canvas backup is refused and the library is untouched', { tag: '@P1' }, async ({ app, page }) => {
    const before = await snapshotDb(page)
    await app.dataCenter.restoreLocal({ name: 'no-manifest.zip', mimeType: 'application/zip', buffer: zipWithout(false) })
    await expect(page.getByText(/Restore failed/).first()).toBeVisible({ timeout: 20_000 })
    await expect(app.dataCenter.restoreNow).toBeEnabled()
    await expectStoreCount(page, 'projects', 1)
    expect(await snapshotDb(page)).toEqual(before)
  })
})
