/**
 * Regression: the Data Center shell (DataCenterModal, DataCenterWelcome,
 * DataCenterSidebar, DataCenterVideoButton, sessionChoice) and the Local
 * .zip export/restore views of an ordinary, signed-out browser
 * (BackupView / RestoreView with source 'local').
 *
 * Runs on fixtures/test.ts: no account, every external request refused, so
 * this is exactly what a first-time visitor sees.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { BackupZip, zipWithout } from '../../helpers/backupZip.js'
import { exportAllLocal, createProjects, answerNextDialog, RESTORE_CONFIRM } from '../../workflows/backup.js'
import { VideoPlayer, BackupUi } from '../../pages/BackupScreens.js'
import { knownDefect } from '../../helpers/defects.js'

const BACKUP_CARDS = [
  'Pro Cloud Sync across all your devices',
  'Economy GitHub Commit to your repository',
  'Local Save on this device',
  'Auto Backup Schedule automatic backups',
]
// The Cloud card's badge in Restore is REG-436 (DEF-403); here only the destinations and their words.
const RESTORE_CARDS = [
  /Cloud Restore from your cloud backups$/,
  'Economy GitHub Restore from a repository',
  'Local Restore from this device',
]

test.describe('Data Center: opening and the destination chooser', { tag: ['@regression', '@backup'] }, () => {
  test('REG-400 the header Backup & Restore button opens the chooser with four Backup destinations and their plan badges', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await app.header.backupRestore.click()
    await expect(dc.chooserHeading).toHaveText('Select backup destination')
    await expect(dc.dialog.getByText('Choose where you want to save your projects')).toBeVisible()
    await expect(dc.cards).toHaveCount(4)
    for (const [i, name] of BACKUP_CARDS.entries()) await expect(dc.cards.nth(i)).toHaveAccessibleName(name)
    await expect(dc.remember).toHaveAttribute('aria-checked', 'false')
    await expect(dc.remember).toHaveAccessibleName('Remember my choice and skip this screen · until you reload the page')
    // The sidebar only appears once a destination is open.
    await expect(dc.allDestinations).toHaveCount(0)
  })

  test('REG-401 switching to Restore shows the three restore sources without Auto Backup, and back again', { tag: '@P2' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await dc.openFromHeader()
    await dc.modeToggle('Restore').click()
    await expect(dc.chooserHeading).toHaveText('Select restore source')
    await expect(dc.dialog.getByText('Choose where you want to restore your projects from')).toBeVisible()
    await expect(dc.cards).toHaveCount(3)
    for (const [i, name] of RESTORE_CARDS.entries()) await expect(dc.cards.nth(i)).toHaveAccessibleName(name)
    await dc.modeToggle('Backup').click()
    await expect(dc.cards).toHaveCount(4)
  })

  test('REG-402 the profile menu Data Center item opens the chooser in Backup mode even after Restore was last used', { tag: '@P2' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await dc.openFromHeader()
    await dc.modeToggle('Restore').click()
    await expect(dc.chooserHeading).toHaveText('Select restore source')
    await dc.close.click()
    await expect(dc.dialog).toBeHidden()
    await app.profileMenu.choose('Data Center')
    await expect(dc.chooserHeading).toHaveText('Select backup destination')
    await expect(dc.cards).toHaveCount(4)
  })

  test('REG-403 the Backup & Restore header button is on the project list only, not inside a project', { tag: '@P3' }, async ({ project, app }) => {
    await app.documents.expectOpen(project.name)
    await expect(app.header.backupRestore).toHaveCount(0)
    await app.documents.backToProjects.click()
    await expect(app.header.backupRestore).toBeVisible()
  })

  test('REG-404 the Data Center stays open on an outside click and on Escape; the close button and Cancel close it', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const dc = app.dataCenter
    await dc.openFromHeader()
    await page.mouse.click(5, 5)
    await page.keyboard.press('Escape')
    await expect(dc.chooserHeading).toBeVisible()
    await dc.close.click()
    await expect(dc.dialog).toBeHidden()

    await dc.openFromHeader()
    await dc.source('Local').click()
    await expect(dc.exportHeading).toBeVisible()
    await dc.cancel.click()
    await expect(dc.dialog).toBeHidden()
  })
})

test.describe('Data Center: sidebar navigation', { tag: ['@regression', '@backup'] }, () => {
  test('REG-405 an opened destination shows the sidebar with every source; All destinations returns to the chooser', { tag: '@P2' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await dc.openFromHeader()
    await dc.source('Local').click()
    await expect(dc.exportHeading).toBeVisible()
    await expect(dc.sidebarSource('Cloud')).toHaveAccessibleName('Cloud Sync across devices Pro')
    await expect(dc.sidebarSource('GitHub')).toHaveAccessibleName('GitHub Commit to repository Economy')
    await expect(dc.sidebarSource('Local')).toHaveAccessibleName('Local On this device')
    await expect(dc.sidebarSource('Auto Backup')).toHaveAccessibleName('Auto Backup Runs on its own')
    // Auto Backup's two destinations show only while one of them is open.
    await expect(dc.autoChild('Cloud')).toHaveCount(0)

    await dc.sidebarSource('Cloud').click()
    await expect(dc.gateHeading).toHaveText('Cloud backup needs the Pro plan')
    await dc.sidebarSource('Auto Backup').click()
    await expect(dc.autoChild('Cloud')).toBeVisible()
    await expect(dc.autoChild('Folder & GitHub')).toBeVisible()
    await dc.autoChild('Folder & GitHub').click()
    await expect(dc.panelHeading).toHaveText('Automatic backup')
    await dc.allDestinations.click()
    await expect(dc.chooserHeading).toHaveText('Select backup destination')
  })

  test('REG-406 Restore mode hides Auto Backup, and switching to Restore on the Auto Backup card goes back to the chooser', { tag: '@P3' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await dc.openFromHeader()
    await dc.source('Local').click()
    await dc.modeToggle('Restore').click()
    await expect(dc.restoreHeading).toBeVisible()
    await expect(dc.sidebarSource('Auto Backup')).toHaveCount(0)
    await dc.modeToggle('Backup').click()
    await dc.allDestinations.click()
    await dc.source('Auto Backup').click()
    await expect(dc.autoChild('Cloud')).toBeVisible()
    await dc.modeToggle('Restore').click()
    await expect(dc.chooserHeading).toHaveText('Select restore source')
    await expect(dc.cards).toHaveCount(3)
  })

  test('REG-420 switching to Restore on an Auto Backup page reached from the sidebar also goes back to the chooser', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-401')
    const dc = app.dataCenter
    const ui = new BackupUi(page)
    await dc.openFromHeader()
    await dc.source('Local').click()
    await dc.sidebarSource('Auto Backup').click()
    await expect(ui.cloudSync.heading).toBeVisible()
    await dc.modeToggle('Restore').click()
    await expect(dc.chooserHeading).toHaveText('Select restore source')
  })

  test('REG-407 "Remember my choice" reopens the last destination per mode until the page is reloaded', { tag: '@P2' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    // A library with a project: an empty one reopens the Catalog after a reload (OBS-009).
    await createProjects(app, ['Remember Project'])
    await dc.openFromHeader()
    await dc.remember.click()
    await expect(dc.remember).toHaveAttribute('aria-checked', 'true')
    await dc.source('Local').click()
    await expect(dc.exportHeading).toBeVisible()
    await dc.close.click()

    await dc.openFromHeader()
    await expect(dc.exportHeading).toBeVisible()
    await expect(dc.chooserHeading).toHaveCount(0)

    // Restore remembers on its own: nothing chosen there yet, so its chooser shows.
    await dc.allDestinations.click()
    await dc.choose('Restore', 'Local')
    await expect(dc.restoreHeading).toBeVisible()
    await dc.close.click()
    await app.header.backupRestore.click()
    // The header always opens in Backup mode, which still remembers Local export.
    await expect(dc.exportHeading).toBeVisible()

    await app.reload()
    await app.home.reach()
    await dc.openFromHeader()
    await expect(dc.chooserHeading).toHaveText('Select backup destination')
    await expect(dc.remember).toHaveAttribute('aria-checked', 'false')
  })

  test('REG-408 unticking "Remember my choice" forgets the stored destination', { tag: '@P3' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await dc.openFromHeader()
    await dc.remember.click()
    await dc.source('Local').click()
    await dc.allDestinations.click()
    await dc.remember.click()
    await expect(dc.remember).toHaveAttribute('aria-checked', 'false')
    await dc.close.click()
    await dc.openFromHeader()
    await expect(dc.chooserHeading).toHaveText('Select backup destination')
  })
})

test.describe('Data Center on a phone-sized window', { tag: ['@regression', '@backup'] }, () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('REG-478 the phone menu opens the phone Data Center, whose tiles carry the plan badges and open each destination', { tag: '@P3' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await dc.phoneMenu.click()
    await dc.phoneMenuEntry.click()
    await expect(dc.dialog.getByText('Data Center', { exact: true })).toBeVisible()
    await expect(dc.dialog.getByText('Where do you want to save?')).toBeVisible()
    for (const name of ['Pro Cloud Sync across devices', 'Economy GitHub Commit to repository', 'Local On this device', 'Auto Backup Off']) {
      await expect(dc.phoneTile(name)).toBeVisible()
    }
    await dc.phoneTile('Local On this device').click()
    await expect(dc.backToDataCenter).toBeVisible()
    await expect(dc.dialog.getByText('No projects found.')).toBeVisible()
    await expect(dc.downloadZip).toBeDisabled()
    await dc.backToDataCenter.click()
    await dc.modeToggle('Restore').click()
    await expect(dc.dialog.getByText('Where do you want to restore from?')).toBeVisible()
    await expect(dc.phoneTile('Auto Backup Off')).toHaveCount(0)
    await dc.close.click()
    await expect(dc.dialog).toBeHidden()
  })
})

test.describe('Data Center: tutorial videos', { tag: ['@regression', '@backup'] }, () => {
  test('REG-409 the video button lists every backup video on the chooser and plays one in a player; Escape closes only the player', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const dc = app.dataCenter
    const player = new VideoPlayer(page)
    await dc.openFromHeader()
    await expect(dc.videoButton).toHaveAccessibleName('Tutorial videos')
    await dc.videoButton.click()
    await expect(dc.videoMenu.getByRole('menuitem')).toHaveText([
      'Export a backup to this device and restore it',
      'Save and recover project versions on GitHub',
      'Keep your projects backed up in the cloud',
      'Back up to this device on a schedule',
      'Schedule automatic GitHub backups',
    ])
    await dc.videoMenu.getByRole('menuitem', { name: 'Keep your projects backed up in the cloud' }).click()
    await expect(player.frame('Keep your projects backed up in the cloud')).toHaveAttribute('src', 'https://www.youtube.com/embed/_o8cywMRF-M?autoplay=1&rel=0&modestbranding=1&playsinline=1')
    await page.keyboard.press('Escape')
    await expect(player.dialog('Keep your projects backed up in the cloud')).toBeHidden()
    await expect(dc.chooserHeading).toBeVisible()

    await dc.modeToggle('Restore').click()
    await dc.videoButton.click()
    await expect(dc.videoMenu.getByRole('menuitem')).toHaveText([
      'Export a backup to this device and restore it',
      'Complete cloud restore guide',
      'Recover projects from your GitHub repository',
      'Save and recover project versions on GitHub',
    ])
  })

  test('REG-410 a page with one video plays it straight from the button', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const dc = app.dataCenter
    const player = new VideoPlayer(page)
    await dc.openFromHeader()
    await dc.source('Local').click()
    await expect(dc.videoButton).toHaveAccessibleName('Watch tutorial: Export a backup to this device and restore it')
    await dc.videoButton.click()
    await expect(player.frame('Export a backup to this device and restore it')).toHaveAttribute('src', /^https:\/\/www\.youtube\.com\/embed\/qPQuxGv28ZU\?/)
  })
})

test.describe('Local export (ordinary browser)', { tag: ['@regression', '@backup'] }, () => {
  test('REG-411 the export view lists every project with its document count and size; Select All / Deselect All drive the count', { tag: '@P2' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Bravo Project', 'Alpha Project'])
    await dc.openFromHeader()
    await dc.source('Local').click()
    await expect(dc.dialog.getByText('Download a .zip file containing your selected projects. You can restore this file on any device.')).toBeVisible()
    await expect(dc.dialog.getByText('Describe this backup(optional)')).toBeVisible()
    await expect(dc.dialog.getByText('Optional: Add a note to identify this backup later')).toBeVisible()
    await expect(dc.selectionCount).toHaveText('Select Projects (2/2)')
    // Sorted by name, each "just now • 0 docs" with its size.
    await expect(dc.projectRows).toHaveText(['Alpha Projectjust now•0 docs0.0 MB', 'Bravo Projectjust now•0 docs0.0 MB'])
    await expect(dc.downloadZip).toHaveText('Download .zip (2)')
    await expect(dc.selectAll).toHaveText('Deselect All')

    await dc.selectAll.click()
    await expect(dc.selectionCount).toHaveText('Select Projects (0/2)')
    await expect(dc.downloadZip).toBeDisabled()
    await expect(dc.selectAll).toHaveText('Select All')
    await dc.projectRow('Bravo Project').click()
    await expect(dc.selectionCount).toHaveText('Select Projects (1/2)')
    await expect(dc.downloadZip).toHaveText('Download .zip (1)')
    await dc.selectAll.click()
    await expect(dc.selectionCount).toHaveText('Select Projects (2/2)')
  })

  test('REG-412 exporting a selection downloads only the chosen projects and names the backup after its note', { tag: '@P1' }, async ({ signedIn: app, page }, testInfo) => {
    const dc = app.dataCenter
    await createProjects(app, ['Keep Project', 'Skip Project'])
    const ids = Object.fromEntries((await readStore<{ id: string; name: string }>(page, 'projects')).map((p) => [p.name, p.id]))
    await dc.openFromHeader()
    await dc.source('Local').click()
    await dc.projectRow('Skip Project').click()
    await dc.description.fill('Before the exam')
    const download = page.waitForEvent('download')
    await dc.downloadZip.click()
    const file = testInfo.outputPath('selection.zip')
    await Promise.all([app.toasts.expectShown('Backup saved: Before the exam', 30_000), (await download).saveAs(file)])
    expect((await download).suggestedFilename()).toMatch(/^CognitiveCanvas_backup_\d{4}-\d{2}-\d{2}_\d{1,2}-\d{2}-(am|pm)\.zip$/)
    const zip = BackupZip.fromFile(file)
    expect(zip.manifest).toMatchObject({ version: 1, appName: 'cognitive-canvas', type: 'single', projectIds: [ids['Keep Project']] })
    expect(zip.json<{ name: string }>('project.json').name).toBe('Keep Project')
    expect(Object.keys(zip.files).some((n) => n.includes(ids['Skip Project']))).toBe(false)
    await expect(dc.dialog).toBeHidden()
    // A successful export snoozes the backup reminder for a week.
    const stamps = await page.evaluate(() => [localStorage.getItem('cc2_last_backup_at'), localStorage.getItem('cc2_backup_reminder_snooze_until')].map(Number))
    expect(stamps[1] - stamps[0]).toBe(7 * 24 * 60 * 60 * 1000)
  })

  test('REG-413 with no projects the export view says so and offers nothing to download', { tag: '@P3' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await dc.openFromHeader()
    await dc.source('Local').click()
    await expect(dc.dialog.getByText('No projects found.')).toBeVisible()
    await expect(dc.selectionCount).toHaveText('Select Projects (0/0)')
    await expect(dc.downloadZip).toBeDisabled()
  })

  test('REG-414 a multi-project export carries every project under projects/<id>/ with its manifest names', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    await createProjects(app, ['First Multi', 'Second Multi'])
    const rows = await readStore<{ id: string; name: string }>(page, 'projects')
    const { file } = await exportAllLocal(app, testInfo)
    const zip = BackupZip.fromFile(file)
    expect(zip.manifest.type).toBe('multi')
    expect([...zip.manifest.projectIds].sort()).toEqual(rows.map((r) => r.id).sort())
    for (const r of rows) {
      expect(zip.json<{ id: string; name: string }>(`projects/${r.id}/project.json`)).toMatchObject({ id: r.id, name: r.name })
      for (const store of ['workspaceItems', 'highlights', 'itemLinks', 'areaLinks', 'calendarEvents', 'canvasStrokes', 'highlightStrokeLinks', 'textHighlights', 'textAreaLinks']) {
        expect(zip.json<unknown[]>(`projects/${r.id}/data/${store}.json`), `${store} of ${r.name}`).toEqual([])
      }
    }
  })
})

test.describe('Local restore view (ordinary browser)', { tag: ['@regression', '@backup'] }, () => {
  test.beforeEach(async ({ project: _p, app }) => {
    await app.documents.backToProjects.click()
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Restore', 'Local')
  })

  test('REG-415 the restore view explains itself, shows the picked file with its size, and Remove file clears it', { tag: '@P2' }, async ({ app }) => {
    const dc = app.dataCenter
    await expect(dc.dialog.getByText('Select a .zip file from your computer to restore projects. Existing projects with the same ID will be overwritten.')).toBeVisible()
    await expect(dc.dialog.getByText('Drag & drop backup file')).toBeVisible()
    await expect(dc.dialog.getByText('or click to browse (.zip)')).toBeVisible()
    await expect(dc.restoreNow).toBeDisabled()
    await dc.pickRestoreFile({ name: 'picked.zip', mimeType: 'application/zip', buffer: Buffer.alloc(3 * 1024 * 1024, 1) })
    await expect(dc.dialog.getByText('picked.zip', { exact: true })).toBeVisible()
    await expect(dc.dialog.getByText('3.00 MB', { exact: true })).toBeVisible()
    await expect(dc.restoreNow).toBeEnabled()
    await dc.removeFile.click()
    await expect(dc.selectFile).toBeVisible()
    await expect(dc.restoreNow).toBeDisabled()
  })

  test('REG-416 dropping a file that is not a .zip or .ccbak is refused by name', { tag: '@P3' }, async ({ app, page }) => {
    const dc = app.dataCenter
    const zone = dc.dialog.getByText('Drag & drop backup file').locator('xpath=ancestor::div[contains(@class,"border-dashed")]')
    // A real OS file drag cannot be produced by the browser driver: build the DataTransfer in the page and dispatch the drop.
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
      return d
    })
    await zone.dispatchEvent('drop', { dataTransfer: dt })
    await expect(dc.dialog.getByText('Please select a .zip or .ccbak file')).toBeVisible()
    await expect(dc.restoreNow).toBeDisabled()
  })

  test('REG-417 a dropped .zip is accepted like a picked one', { tag: '@P3' }, async ({ app, page }) => {
    const dc = app.dataCenter
    const zone = dc.dialog.getByText('Drag & drop backup file').locator('xpath=ancestor::div[contains(@class,"border-dashed")]')
    // See REG-416: a file drop is emulated with a page-built DataTransfer.
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File([new Uint8Array(2048)], 'dropped-backup.zip', { type: 'application/zip' }))
      return d
    })
    await zone.dispatchEvent('drop', { dataTransfer: dt })
    await expect(dc.dialog.getByText('dropped-backup.zip', { exact: true })).toBeVisible()
    await expect(dc.restoreNow).toBeEnabled()
  })

  test('REG-418 a failed restore keeps the Data Center open, leaves the library as it was, and says why', { tag: '@P2' }, async ({ app, page }) => {
    knownDefect('DEF-002')
    const dc = app.dataCenter
    const before = await readStore(page, 'projects')
    await dc.pickRestoreFile({ name: 'other-app.zip', mimeType: 'application/zip', buffer: zipWithout(true) })
    const dialog = answerNextDialog(page, true)
    const toast = app.toasts.withText(/^Restore failed: /).first().textContent({ timeout: 20_000 })
    await dc.restoreNow.click()
    expect(await dialog).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await expect(dc.errorBox).toBeVisible({ timeout: 20_000 })
    await expect(dc.restoreNow).toBeEnabled()
    expect(await readStore(page, 'projects')).toEqual(before)
    // The reason restoreService gives, not the bare fallback (DEF-002).
    expect(await toast).toBe('Restore failed: Invalid backup: not a Cognitive Canvas backup file')
    await expect(dc.errorBox).toHaveText('Invalid backup: not a Cognitive Canvas backup file')
  })
})

test.describe('Restore progress', { tag: ['@regression', '@backup'] }, () => {
  test('REG-419 a restore shows the blocking "Restoring your data…" loader and its toast, then reloads into the restored library', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    await createProjects(app, ['Loader Project'])
    const { file } = await exportAllLocal(app, testInfo)
    await app.home.deleteProject('Loader Project')
    await expectStoreCount(page, 'projects', 0)
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Restore', 'Local')
    await app.dataCenter.pickRestoreFile(file)
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await app.dataCenter.restoreNow.click()
    await confirmed
    await Promise.all([
      expect(page.getByText('Restoring your data…')).toBeVisible(),
      expect(page.getByText('This can take a moment for large backups — please keep the app open.')).toBeVisible(),
      app.toasts.expectShown('Restored from backup file — refreshing…', 20_000),
    ])
    await loaded
    await app.home.reach()
    await expect(app.home.card('Loader Project')).toBeVisible()
    await expectStoreCount(page, 'projects', 1)
  })
})
