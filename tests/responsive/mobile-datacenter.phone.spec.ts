/**
 * The phone Data Center (DataCenterMobile.tsx, chosen by DataCenterModal when
 * useIsPhone): a grid of destination tiles, each showing its last backup,
 * that drills into a full-screen detail page per destination reusing the
 * desktop panels (BackupView / RestoreView with isMobileDetail, SourceGate,
 * BackupDestinations, CloudSyncSection). Opened from the Menu sheet's
 * Backup & Restore row (there is no header button on a phone).
 *
 * REG-478 (tests/regression/data-center.spec.ts) covers the grid and its
 * plan badges; here: every flow inside a destination, on a phone. Cloud is the
 * stateful fake store, GitHub / folders the MoBrowser host stub (fixtures/backup.ts).
 */
import { test, backupTest, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { answerNextDialog, RESTORE_CONFIRM } from '../../workflows/backup.js'
import type { GitRepo } from '../../helpers/mocks/moBrowserBridge.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { MobileShell } from '../../pages/MobileShell.js'

interface ProjectRow { id: string; name: string }
const REPO: GitRepo = { id: 'e2e-repo-phone', name: 'Phone backups', owner: 'e2e-owner', repository: 'cc-phone-backups', branch: 'main' }
/** whenLabel() for a backup made today: the time only, e.g. "4:05 PM". */
const TODAY_TIME = /^\d{1,2}:\d{2}\s?(AM|PM)$/

async function createOnPhone(app: CognitiveCanvas, mobile: MobileShell, names: string[]) {
  for (const name of names) {
    await mobile.home.createProject(name)
    await app.documents.expectOpen(name)
    await app.documents.backToProjects.click()
    await expect(mobile.home.row(name)).toBeVisible()
  }
}

async function openPhoneDataCenter(app: CognitiveCanvas, mobile: MobileShell) {
  await mobile.menu.choose('Backup & Restore')
  await expect(app.dataCenter.dialog.getByText('Data Center', { exact: true })).toBeVisible()
}

/**
 * The detail page's title (the tapped destination's name). Scoped to the open
 * dialog itself: the Auto Backup pages have no Backup/Restore toggle, which is
 * what DataCenter.dialog uses to find the Data Center.
 */
const detailTitle = (app: CognitiveCanvas, label: string) => app.page.getByRole('dialog').locator('div.truncate').filter({ hasText: new RegExp(`^${label}$`) })

test.describe('Phone Data Center, signed out', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-842 Local on a phone: the detail page exports a .zip of the projects ticked, with no desktop title, then closes', { tag: ['@P1'] }, async ({ signedIn: app, mobile, page }) => {
    const dc = app.dataCenter
    await createOnPhone(app, mobile, ['Phone Backup', 'Left Out'])
    const ids = Object.fromEntries((await readStore<ProjectRow>(page, 'projects')).map((p) => [p.name, p.id]))
    await openPhoneDataCenter(app, mobile)
    await dc.phoneTile('Local On this device').click()
    await expect(dc.backToDataCenter).toBeVisible()
    await expect(detailTitle(app, 'Local')).toBeVisible()
    await expect(dc.exportHeading).toHaveCount(0) // the desktop page title is not repeated on the phone page
    await expect(dc.modeToggle('Backup')).toBeVisible() // flip without going back
    await expect(dc.selectionCount).toHaveText('Select Projects (2/2)')
    await dc.projectRow('Left Out').click()
    await expect(dc.downloadZip).toHaveText('Download .zip (1)')
    await dc.description.fill('From my phone')
    const downloading = page.waitForEvent('download')
    await dc.downloadZip.click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/^CognitiveCanvas_backup_\d{4}-\d{2}-\d{2}_\d{1,2}-\d{2}-(am|pm)\.zip$/)
    await app.toasts.expectShown('Backup saved: From my phone', 30_000)
    const zip = BackupZip.fromFile(await download.path())
    expect(zip.manifest.projectIds).toEqual([ids['Phone Backup']])
    await expect(dc.dialog).toBeHidden()
  })

  test('REG-843 Local restore on a phone: the restore tiles leave out Auto Backup, and a .zip picked on the detail page brings a deleted project back after confirming', { tag: ['@P1'] }, async ({ signedIn: app, mobile, page }, testInfo) => {
    const dc = app.dataCenter
    await createOnPhone(app, mobile, ['Round Trip'])
    const [original] = await readStore<ProjectRow>(page, 'projects')
    await openPhoneDataCenter(app, mobile)
    await dc.phoneTile('Local On this device').click()
    const downloading = page.waitForEvent('download')
    await dc.downloadZip.click()
    const file = testInfo.outputPath('phone-backup.zip')
    await (await downloading).saveAs(file)
    await expect(dc.dialog).toBeHidden()

    await mobile.home.rowAction('Round Trip', 'Delete')
    await page.getByRole('dialog', { name: 'Delete Project' }).getByRole('button', { name: 'Delete', exact: true }).click()
    await expectStoreCount(page, 'projects', 0)

    await openPhoneDataCenter(app, mobile)
    await dc.modeToggle('Restore').click()
    await expect(dc.dialog.getByText('Where do you want to restore from?')).toBeVisible()
    await expect(dc.dialog.locator('div.grid > button')).toHaveCount(3)
    await expect(dc.phoneTile('Auto Backup Off')).toHaveCount(0)
    await dc.phoneTile('Local On this device').click()
    await expect(dc.restoreHeading).toHaveCount(0)
    await dc.pickRestoreFile(file)
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreNow.click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await loaded
    await expect(mobile.home.row('Round Trip')).toBeVisible({ timeout: 30_000 })
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.id)).toEqual([original.id])
  })

  test('REG-844 signed out, the paid tiles open their plan gate full page, Restore asks only for sign-in, and Auto Backup has no Backup/Restore switch', { tag: '@P2' }, async ({ signedIn: app, mobile }) => {
    const dc = app.dataCenter
    await openPhoneDataCenter(app, mobile)
    await dc.phoneTile('Pro Cloud Sync across devices').click()
    await expect(dc.dialog.getByRole('heading', { name: 'Cloud backup needs the Pro plan' })).toBeVisible()
    await expect(dc.dialog.getByText('Sign in, then upgrade to unlock Cloud backup & restore.')).toBeVisible()
    await expect(dc.gateButton('Sign in')).toBeVisible()
    await dc.modeToggle('Restore').click()
    await expect(dc.dialog.getByRole('heading', { name: 'Sign in to see your cloud backups' })).toBeVisible()
    await expect(dc.dialog.getByText('No plan is needed to restore — just your account.')).toBeVisible()

    await dc.backToDataCenter.click()
    await dc.phoneTile('Economy GitHub Commit to repository').click()
    await expect(dc.dialog.getByRole('heading', { name: 'GitHub backup needs the Economy plan' })).toBeVisible()

    await dc.backToDataCenter.click()
    await dc.modeToggle('Backup').click()
    await dc.phoneTile('Auto Backup Off').click()
    await expect(detailTitle(app, 'Auto Backup')).toBeVisible()
    const page = app.page.getByRole('dialog')
    await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0) // schedule-only: no restore to flip to
    await expect(page.getByRole('heading', { name: 'Open in MoBrowser' })).toBeVisible() // an ordinary browser cannot run the schedule
    await expect(page.getByRole('switch')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page).toHaveCount(0)
  })
})

backupTest.describe('Phone Data Center, Pro', { tag: ['@regression', '@mobile', '@api'] }, () => {
  backupTest.use({ muulPlan: 'pro' })

  backupTest('REG-845 on Pro the Cloud tile carries no badge; a cloud backup made on the phone is uploaded, the tile then shows its time, and restoring it brings the project back', { tag: ['@P1'] }, async ({ signedIn: app, mobile, page, cloud }) => {
    const dc = app.dataCenter
    await createOnPhone(app, mobile, ['Cloud Phone'])
    const [original] = await readStore<ProjectRow>(page, 'projects')
    await openPhoneDataCenter(app, mobile)
    const cloudTile = dc.dialog.getByRole('button', { name: /^Cloud / })
    await expect(cloudTile).toHaveAccessibleName('Cloud Sync across devices') // no backups yet, no plan badge
    await cloudTile.click()
    await expect(detailTitle(app, 'Cloud')).toBeVisible()
    await expect(dc.createBackup).toBeDisabled() // the note is required for the cloud
    await dc.description.fill('Phone cloud')
    await dc.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    expect(cloud.state.uploads).toHaveLength(1)
    expect(cloud.state.uploads[0].fields).toMatchObject({ product: 'CognitiveCanvas', storageType: 'cloud', description: 'Phone cloud' })
    expect(new BackupZip(cloud.state.uploads[0].file!.bytes).manifest.projectIds).toEqual([original.id])
    await expect(dc.dialog).toBeHidden()

    await openPhoneDataCenter(app, mobile)
    await expect(cloudTile).toHaveAccessibleName(new RegExp(`^Cloud ${TODAY_TIME.source.slice(1, -1)}$`))
    await mobile.page.getByRole('button', { name: 'Close', exact: true }).first().click()
    await mobile.home.rowAction('Cloud Phone', 'Delete')
    await page.getByRole('dialog', { name: 'Delete Project' }).getByRole('button', { name: 'Delete', exact: true }).click()
    await expectStoreCount(page, 'projects', 0)

    await openPhoneDataCenter(app, mobile)
    await dc.modeToggle('Restore').click()
    await cloudTile.click()
    const row = dc.cloudRow('Phone cloud')
    await expect(row.locator('input[name="cloudBackup"]')).toBeChecked()
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreNow.click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await loaded
    await expect(mobile.home.row('Cloud Phone')).toBeVisible({ timeout: 30_000 })
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.id)).toEqual([original.id])
    expect(cloud.state.downloads).toHaveLength(1)
  })

})

backupTest.describe('Phone Data Center, automatic cloud backup on', { tag: ['@regression', '@mobile', '@api'] }, () => {
  // The schedule page signposts cloud backup only while it is on; the folder schedule needs MoBrowser (no folders yet).
  backupTest.use({ muulPlan: 'pro', muulCloudSync: true, moBrowser: { folders: [] } })

  backupTest('REG-846 the Auto Backup tile opens the schedule page, whose Manage leads to the automatic cloud backup page named for itself', { tag: '@P3' }, async ({ signedIn: app, mobile }) => {
    const dc = app.dataCenter
    await openPhoneDataCenter(app, mobile)
    await dc.phoneTile('Auto Backup Off').click()
    await expect(detailTitle(app, 'Auto Backup')).toBeVisible()
    const sheet = app.page.getByRole('dialog')
    await expect(sheet.getByText(/^Automatic cloud backup is on · last backed up /)).toBeVisible()
    await sheet.getByRole('button', { name: 'Manage', exact: true }).click()
    await expect(detailTitle(app, 'Automatic cloud backup')).toBeVisible()
    await expect(sheet.getByRole('switch')).toBeVisible() // CloudSyncSection's own switch
    await expect(sheet.getByRole('button', { name: 'Backup', exact: true })).toHaveCount(0)
  })
})

backupTest.describe('Phone Data Center, GitHub inside the Android app', { tag: ['@regression', '@mobile', '@api'] }, () => {
  backupTest.use({ muulPlan: 'dev', moBrowser: { repos: [REPO] }, muulAndroid: { chromeTop: 0, chromeBottom: 0 } })

  backupTest('REG-847 on Economy the GitHub tile backs up to the repository through the host and then shows the backup\'s time; Restore lists it', { tag: '@P2' }, async ({ signedIn: app, mobile, bridge }) => {
    const dc = app.dataCenter
    await createOnPhone(app, mobile, ['Git Phone'])
    await openPhoneDataCenter(app, mobile)
    const gitTile = dc.dialog.getByRole('button', { name: /^GitHub / })
    await expect(gitTile).toHaveAccessibleName('GitHub Commit to repository') // no "Economy" badge on Economy
    await gitTile.click()
    await expect(dc.panelHeading).toHaveText('Back up to GitHub')
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backed up to Phone backups', 30_000)
    expect(bridge.pushes).toHaveLength(1)
    expect(bridge.pushes[0].repo).toBe(REPO.id)
    await dc.backToDataCenter.click()
    await expect(gitTile).toHaveAccessibleName(new RegExp(`^GitHub ${TODAY_TIME.source.slice(1, -1)}$`))

    await dc.modeToggle('Restore').click()
    await gitTile.click()
    await expect(dc.panelHeading).toHaveText('Restore from GitHub')
    await dc.destinationRow('Phone backups').click()
    await expect(dc.restoreRows).toHaveCount(1)
  })
})
