/**
 * Inside the Muul-Android app (SAN-006's emulated counterpart): a phone page
 * hosted by a stubbed React Native WebView (helpers/mocks/mobileAndroid.ts)
 * whose message bridge is the MoBrowser host stub (helpers/mocks/moBrowserBridge.ts).
 *
 * What the app does differently there (services/backup/bridgeService.ts
 * detectEnvironment = 'muul-android', utils/environment.ts):
 *   - Backup & Restore › Local writes to and reads from the host's folders
 *     through window.externalMessage, never a browser download / file picker;
 *   - fixed UI (toasts, the view notice) sits below the host's top bar, by the
 *     --muul-chrome-top inset the host writes.
 * The app never posts on window.ReactNativeWebView itself: every exchange
 * goes through externalMessage, and the stub records any postMessage so the
 * specs can prove that.
 *
 * Not reproduced: the real Android build, its camera, its Downloads folder
 * and its own JavaScript shim. SAN-006 stays a manual device check.
 */
import { backupTest as test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { answerNextDialog, RESTORE_CONFIRM, BACKUP_FILE_NAME } from '../../workflows/backup.js'
import { ShellBanners } from '../../pages/ShellPages.js'
import type { LocalFolder } from '../../helpers/mocks/moBrowserBridge.js'

const FOLDER: LocalFolder = { id: 'e2e-android-folder', name: 'Phone storage', path: '/storage/emulated/0/Download/Muul' }
const SUB = `${FOLDER.path}/CognitiveCanvas`
const INSETS = { chromeTop: 48, chromeBottom: 56 }

test.describe('Muul-Android app (emulated host)', { tag: ['@regression', '@mobile', '@api'] }, () => {
  test.use({ muulPlan: null, moBrowser: { folders: [FOLDER], folderChunkBytes: 4096 }, muulAndroid: INSETS })

  test('REG-849 inside the Android app, Backup & Restore › Local saves into the host\'s folder through its bridge (no browser download) and restores from it; nothing goes over ReactNativeWebView.postMessage', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, mobile, page, bridge, android }) => {
    const dc = app.dataCenter
    const downloads: string[] = []
    page.on('download', (d) => downloads.push(d.suggestedFilename()))
    await mobile.home.createProject('Android Notes')
    await app.documents.expectOpen('Android Notes')
    await app.documents.backToProjects.click()
    const [project] = await readStore<{ id: string; name: string }>(page, 'projects')

    await mobile.menu.choose('Backup & Restore')
    await dc.phoneTile('Local On this device').click()
    await expect(dc.panelHeading).toHaveText('Back up to a local folder')
    await expect(dc.downloadZip).toHaveCount(0)
    await dc.chooser('folder').click()
    await dc.menuOption(FOLDER.name).click()
    expect(bridge.credentialLists).toContain('local')
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backed up to "Phone storage"', 30_000)
    // Toasts sit below the host's top bar: 7rem + --muul-chrome-top.
    expect(await app.toasts.container.evaluate((el) => getComputedStyle(el).top)).toBe(`${112 + INSETS.chromeTop}px`)

    const [begin] = bridge.sent('backup', 'beginWrite')
    expect(begin).toMatchObject({ folderPath: SUB, filename: expect.stringMatching(BACKUP_FILE_NAME) })
    expect(bridge.sent('backup', 'writeChunk').length).toBe(Math.ceil(Number(begin.totalBytes) / 4096))
    const zip = new BackupZip(bridge.disk.get(`${SUB}/${String(begin.filename)}`)!)
    expect(zip.manifest.projectIds).toEqual([project.id])
    expect(downloads).toEqual([])
    await dc.close.click()

    await mobile.home.rowAction('Android Notes', 'Delete')
    await page.getByRole('dialog', { name: 'Delete Project' }).getByRole('button', { name: 'Delete', exact: true }).click()
    await expectStoreCount(page, 'projects', 0)
    await mobile.menu.choose('Backup & Restore')
    await dc.modeToggle('Restore').click()
    await dc.phoneTile('Local On this device').click()
    await expect(dc.panelHeading).toHaveText('Restore from a folder')
    await expect(dc.selectFile).toHaveCount(0) // no file picker inside the app
    await dc.destinationRow(FOLDER.name).click()
    await expect(dc.restoreRows).toHaveCount(1)
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreRows.first().click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await loaded
    await expect(mobile.home.row('Android Notes')).toBeVisible({ timeout: 30_000 })
    expect((await readStore<{ id: string }>(page, 'projects')).map((p) => p.id)).toEqual([project.id])
    expect(bridge.sent('backup', 'readChunk').length + bridge.sent('backup', 'readFile').length).toBeGreaterThan(0)
    expect(android.posted).toEqual([])
  })

  test.describe('first visit', () => {
    test.use({ viewNoticeSeen: false })
    test('REG-850 the touch-device notice also sits below the host\'s top bar (0.75rem + --muul-chrome-top)', { tag: '@P3' }, async ({ app, page }) => {
      const banners = new ShellBanners(page)
      await app.open()
      await expect(banners.viewMode).toHaveText("You're viewing in mobile view.")
      expect(await banners.viewMode.evaluate((el) => getComputedStyle(el).top)).toBe(`${12 + INSETS.chromeTop}px`)
    })
  })
})
