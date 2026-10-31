/**
 * Regression: Data Center > Auto Backup > Folder & GitHub, the scheduled
 * backup to a local folder or a GitHub repository (BackupDestinations
 * panel 'auto-schedule', hooks/useAutoBackup.ts, backupPrefs.ts,
 * autoBackupStatus.ts). Runs only inside MoBrowser: the host stub
 * (helpers/mocks/moBrowserBridge.ts) holds the folders and repositories.
 *
 * The scheduler's own timers are long (first check after 8 s, then every
 * 5 s, an interval of at least 10 s): REG-473 runs them on Playwright's clock
 * so a "nothing changed, so nothing ran" check needs no real waiting.
 */
import { test, expect } from '../../fixtures/backup.js'
import { BackupZip } from '../../helpers/backupZip.js'
import type { GitRepo, LocalFolder } from '../../helpers/mocks/moBrowserBridge.js'
import { createProjects, bootToHome } from '../../workflows/backup.js'
import { knownDefect } from '../../helpers/defects.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page } from '@playwright/test'

const FOLDER: LocalFolder = { id: 'e2e-folder-1', name: 'School backups', path: '/e2e/School' }
const SUB = '/e2e/School/CognitiveCanvas'
const REPO: GitRepo = { id: 'e2e-repo-1', name: 'Test backups', owner: 'e2e-owner', repository: 'cc-test-backups', branch: 'main' }

async function openSchedule(app: CognitiveCanvas) {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.source('Auto Backup').click()
  await app.dataCenter.autoChild('Folder & GitHub').click()
  await expect(app.dataCenter.panelHeading).toHaveText('Automatic backup')
}

const prefs = async (page: Page) => JSON.parse((await page.evaluate(() => localStorage.getItem('cc2_backup_prefs_v1'))) ?? '{}') as Record<string, unknown>

test.describe('Automatic backup in an ordinary browser', { tag: ['@regression', '@backup', '@auto-backup'] }, () => {
  test.use({ muulPlan: null })
  test('REG-471 outside MoBrowser the schedule page explains that the app is needed and offers no switch', { tag: '@P3' }, async ({ signedIn: app }) => {
    await openSchedule(app)
    await expect(app.dataCenter.dialog.getByText('Keep a rolling backup running in the background while the app is open.')).toBeVisible()
    await expect(app.dataCenter.openInMoBrowser).toBeVisible()
    await expect(app.dataCenter.downloadMoBrowser).toBeVisible()
    await expect(app.dataCenter.autoSwitch).toHaveCount(0)
  })
})

test.describe('Automatic backup to a folder', { tag: ['@regression', '@backup', '@auto-backup'] }, () => {
  test.use({ muulPlan: null, moBrowser: { folders: [FOLDER] } })

  test('REG-472 switching it on walks through where, which folder and how often; choosing the folder backs up at once and the card reports it', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Scheduled Project'])
    await openSchedule(app)
    await expect(dc.dialog.getByText('Runs in the background on a schedule while the app is open.')).toBeVisible()
    await expect(dc.autoSwitch).toHaveAttribute('aria-checked', 'false')
    await expect(dc.dialog.getByText('Where to save', { exact: true })).toHaveCount(0)
    await dc.autoSwitch.click()
    await expect(dc.autoSwitch).toHaveAttribute('aria-checked', 'true')
    await expect(dc.target('Local folder')).toHaveAccessibleName('Local folder a folder on this device')
    // GitHub is an Economy feature; a signed-out browser is on Free.
    await expect(dc.target('GitHub')).toHaveAccessibleName('GitHub needs the Economy plan')
    await expect(dc.target('GitHub')).toBeDisabled()
    await expect(dc.dialog.getByText('Pick a folder to finish setting up.')).toBeVisible()
    await expect(dc.dialog.getByText('How often', { exact: true })).toHaveCount(0)

    await dc.chooser('folder').click()
    await dc.menuOption(FOLDER.name).click()
    // A new destination is backed up straight away.
    await app.toasts.expectShown('Backed up to "School backups"', 30_000)
    await expect(dc.dialog.getByText('Backed up', { exact: true })).toBeVisible()
    await expect(dc.dialog.getByText(/^Saved → School backups · /)).toBeVisible()
    expect(bridge.filesIn(SUB)).toHaveLength(1)
    await expect(dc.autoFact('Destination')).toHaveText('School backups')
    await expect(dc.autoFact('Every')).toHaveText('30 min')
    await expect(dc.autoFact('Last backup')).not.toHaveText('never')
    await expect(dc.dialog.getByText('How often', { exact: true })).toBeVisible()
    for (const label of ['10 sec', '15 min', '30 min', '1 hour', '6 hours'] as const) await expect(dc.interval(label)).toBeVisible()
    await dc.interval('10 sec').click()
    await expect(dc.autoFact('Every')).toHaveText('10 sec')
    expect(await prefs(page)).toMatchObject({ autoEnabled: true, autoTargetLocal: true, autoTargetGithub: false, defaultLocalDestId: FOLDER.id, autoIntervalMin: 10 / 60 })
    expect((await prefs(page)).lastAutoBackupAt).toBeGreaterThan(0)

    await app.reload()
    await openSchedule(app)
    await expect(dc.autoSwitch).toHaveAttribute('aria-checked', 'true')
    await expect(dc.autoFact('Destination')).toHaveText('School backups')
    await expect(dc.autoFact('Every')).toHaveText('10 sec')
    await expect(dc.autoFact('Last backup')).not.toHaveText('never')
  })

  test('REG-499 reopening the app with nothing changed does not write another backup; the card says the schedule is on', { tag: '@P2' }, async ({ app, page, bridge }) => {
    knownDefect('DEF-404')
    await page.clock.install()
    await bootToHome(app)
    await createProjects(app, ['Quiet Project'])
    const dc = app.dataCenter
    await openSchedule(app)
    await dc.autoSwitch.click()
    await dc.chooser('folder').click()
    await dc.menuOption(FOLDER.name).click()
    await app.toasts.expectShown('Backed up to "School backups"', 30_000)
    await dc.interval('10 sec').click()
    await expect(dc.autoFact('Every')).toHaveText('10 sec')
    expect(bridge.filesIn(SUB)).toHaveLength(1)

    await app.reload()
    await app.home.reach()
    // The first check runs 8 s after load, then every 5 s: half a minute of nothing new.
    await page.clock.fastForward(30_000)
    await openSchedule(app)
    await expect(dc.dialog.getByText('Automatic backup is on')).toBeVisible()
    await expect(dc.dialog.getByText('Runs every 10 sec when you have new changes.')).toBeVisible()
    await dc.close.click()
    // Control: a real change is backed up, so the count below is a count of runs.
    await createProjects(app, ['Real Change'])
    const saved = app.toasts.expectShown('Auto-backup saved → School backups', 30_000)
    await page.clock.fastForward(20_000)
    await saved
    await expect.poll(() => bridge.sent('backup', 'endWrite').length).toBeGreaterThanOrEqual(2)
    expect(bridge.filesIn(SUB)).toHaveLength(2)
  })

  test('REG-473 the scheduler backs up again only after something changed, and says so', { tag: '@P1' }, async ({ app, page, bridge }) => {
    // Fake timers from the first page load: the scheduler's 8 s / 5 s / 10 s waits are jumped over, not waited for.
    await page.clock.install()
    await bootToHome(app)
    await createProjects(app, ['Tick Project'])
    const dc = app.dataCenter
    await openSchedule(app)
    await dc.autoSwitch.click()
    await dc.chooser('folder').click()
    await dc.menuOption(FOLDER.name).click()
    await app.toasts.expectShown('Backed up to "School backups"', 30_000)
    await dc.interval('10 sec').click()
    await expect(dc.autoFact('Every')).toHaveText('10 sec')
    expect(bridge.filesIn(SUB)).toHaveLength(1)

    // A minute with no changes: every tick finds nothing new.
    await page.clock.fastForward(30_000)
    await page.clock.fastForward(30_000)
    await dc.close.click()
    await createProjects(app, ['Second Project'])
    const toast = app.toasts.expectShown('Auto-backup saved → School backups', 30_000)
    await page.clock.fastForward(20_000)
    await toast
    await expect.poll(() => bridge.filesIn(SUB).length).toBe(2)
    const latest = bridge.filesIn(SUB).sort().at(-1)!
    expect(new BackupZip(bridge.disk.get(`${SUB}/${latest}`)!).manifest.projectIds).toHaveLength(2)
  })

  test('REG-474 a failing destination turns the card red with the reason; Back up now on the card retries', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Failing Schedule'])
    await openSchedule(app)
    await dc.autoSwitch.click()
    bridge.override('backup', { ok: false, error: 'Disk full' }, { action: 'endWrite' })
    await dc.chooser('folder').click()
    await dc.menuOption(FOLDER.name).click()
    await app.toasts.expectShown('Backup failed: Disk full', 30_000)
    await expect(dc.dialog.getByText('Last attempt failed — retrying on its own')).toBeVisible()
    await expect(dc.dialog.getByText('Disk full', { exact: true })).toBeVisible()
    await dc.dialog.getByRole('button', { name: 'Back up now' }).click()
    await app.toasts.expectShown('Backed up to "School backups"', 30_000)
    await expect(dc.dialog.getByText('Backed up', { exact: true })).toBeVisible()
    expect(bridge.filesIn(SUB)).toHaveLength(1)
  })

  test('REG-475 with no projects the schedule waits quietly and says why', { tag: '@P3' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    await openSchedule(app)
    await dc.autoSwitch.click()
    await dc.chooser('folder').click()
    await dc.menuOption(FOLDER.name).click()
    await app.toasts.expectShown('Nothing to back up yet — create or import a project first', 30_000)
    await expect(dc.dialog.getByText('Nothing to back up yet', { exact: true })).toBeVisible()
    await expect(dc.dialog.getByText('Nothing to back up yet — it starts with your first project.')).toBeVisible()
    expect(bridge.sent('backup', 'beginWrite')).toHaveLength(0)
  })
})

test.describe('Automatic backup to GitHub', { tag: ['@regression', '@backup', '@auto-backup', '@api'] }, () => {
  test.use({ muulPlan: 'dev', moBrowser: { folders: [FOLDER], repos: [REPO] } })

  test('REG-476 on Economy, choosing GitHub uses the one connected repository and pushes to it at once', { tag: '@P2' }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Git Schedule'])
    await openSchedule(app)
    await dc.autoSwitch.click()
    await expect(dc.target('GitHub')).toHaveAccessibleName('GitHub a connected repository')
    await dc.target('GitHub').click()
    await app.toasts.expectShown('Backed up to GitHub', 30_000)
    await expect(dc.dialog.getByText('Choose a repository', { exact: true })).toBeVisible()
    await expect(dc.chooser('repository')).toHaveText('Test backupse2e-owner/cc-test-backups · main')
    await expect(dc.autoFact('Destination')).toHaveText('Test backups')
    expect(bridge.pushes.map((p) => p.repo)).toEqual([REPO.id])
    expect(await prefs(page)).toMatchObject({ autoEnabled: true, autoTargetGithub: true, autoTargetLocal: false })
    expect(bridge.sent('backup', 'beginWrite')).toHaveLength(0)
  })
})

test.describe('Automatic backup beside cloud sync', { tag: ['@regression', '@backup', '@auto-backup', '@api'] }, () => {
  test.use({ muulPlan: 'pro', muulCloudSync: true, moBrowser: { folders: [FOLDER] } })

  test('REG-477 with cloud sync on, the schedule page points to it, and Manage opens Auto Backup > Cloud', { tag: '@P3' }, async ({ signedIn: app, ui }) => {
    await openSchedule(app)
    await expect(app.dataCenter.dialog.getByText(/^Automatic cloud backup is on · last backed up /)).toBeVisible()
    await app.dataCenter.dialog.getByRole('button', { name: 'Manage', exact: true }).click()
    await expect(ui.cloudSync.heading).toBeVisible()
    await expect(ui.cloudSync.switch).toHaveAttribute('aria-checked', 'true')
  })
})
