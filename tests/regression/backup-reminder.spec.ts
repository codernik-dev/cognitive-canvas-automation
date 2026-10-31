/**
 * Regression: the bottom-right backup reminder (BackupReminder.tsx,
 * backupReminderState.ts) and, for a Pro account, the hosted MuulBackup
 * widget it opens (services/backup/cloudBackup.ts openCloudBackup).
 *
 * The reminder shows 2 s after content exists, for 10 s at a time, unless it
 * is snoozed (48 h after "Remind me later", 7 days after any backup).
 */
import { test as plain, expect } from '../../fixtures/test.js'
import { test as account } from '../../fixtures/backup.js'
import { BackupReminderChip } from '../../pages/BackupScreens.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { createProjects, exportAllLocal, answerNextDialog, projectIds, bootToHome } from '../../workflows/backup.js'
import { MUUL_API } from '../../helpers/mocks/muulAccount.js'

const DAY = 24 * 60 * 60 * 1000

plain.describe('Backup reminder (local)', { tag: ['@regression', '@backup', '@reminder'] }, () => {
  plain('REG-494 a library with content is nudged to back up, and the nudge opens the Data Center on Backup', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const reminder = new BackupReminderChip(page)
    await expect(reminder.open).toHaveCount(0)
    await createProjects(app, ['Nudged Project'])
    await expect(reminder.open).toHaveAccessibleName('Your data is on this device only. Back up to keep it safe. Click to open backup.')
    await reminder.open.click()
    await expect(app.dataCenter.chooserHeading).toHaveText('Select backup destination')
    await expect(reminder.open).toHaveCount(0)
  })

  plain('REG-495 Remind me later hides the nudge for 48 hours, across a reload', { tag: '@P3' }, async ({ app, page }) => {
    // Fake timers from the first load, so the reminder's 2 s delay can be jumped over rather than waited for.
    await page.clock.install()
    await bootToHome(app)
    const reminder = new BackupReminderChip(page)
    await createProjects(app, ['Snoozed Project'])
    await page.clock.fastForward(3000)
    await expect(reminder.later).toBeVisible()
    await reminder.later.click()
    await expect(reminder.open).toHaveCount(0)
    const [now, until] = await page.evaluate(() => [Date.now(), Number(localStorage.getItem('cc2_backup_reminder_snooze_until'))])
    expect(until - now).toBeGreaterThan(2 * DAY - 60_000)
    expect(until - now).toBeLessThanOrEqual(2 * DAY)

    await app.reload()
    await app.home.reach()
    await expect(app.home.card('Snoozed Project')).toBeVisible()
    await page.clock.fastForward(5000)
    await expect(reminder.open).toHaveCount(0)
    // Control: with the snooze over, the same 2 s later it is back.
    await page.evaluate(() => {
      localStorage.removeItem('cc2_backup_reminder_snooze_until')
      window.dispatchEvent(new StorageEvent('storage', { key: 'cc2_backup_reminder_snooze_until' }))
    })
    await page.clock.fastForward(3000)
    await expect(reminder.open).toBeVisible()
  })

  plain('REG-496 an old backup changes the words to "Push a fresh backup" with its age; a fresh export silences it for a week', { tag: '@P3' }, async ({ signedIn: app, page }, testInfo) => {
    const reminder = new BackupReminderChip(page)
    await page.evaluate((at) => localStorage.setItem('cc2_last_backup_at', String(at)), Date.now() - 3 * DAY)
    await createProjects(app, ['Aging Backup'])
    await expect(reminder.open).toHaveAccessibleName('Push a fresh backup. Last backup 3d ago. Click to open backup.')
    await exportAllLocal(app, testInfo)
    const until = Number(await page.evaluate(() => localStorage.getItem('cc2_backup_reminder_snooze_until')))
    expect(until - Date.now()).toBeGreaterThan(7 * DAY - 120_000)
    await expect(reminder.open).toHaveCount(0)
  })
})

account.describe('Backup reminder (Pro)', { tag: ['@regression', '@backup', '@reminder', '@api'] }, () => {
  account.use({ muulPlan: 'pro' })

  account('REG-497 for Pro the nudge asks to verify the cloud backup; without the widget script it says the widget is not available', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const reminder = new BackupReminderChip(page)
    await createProjects(app, ['Pro Nudge'])
    await expect(reminder.open).toHaveAccessibleName('Verify cloud backup. No recent sync detected. Click to open backup.')
    const alerted = answerNextDialog(page, true)
    await reminder.open.click()
    expect(await alerted).toEqual({ type: 'alert', message: 'Cloud backup widget not available. Make sure you are connected to the internet.' })
    await expect(app.dataCenter.dialog).toHaveCount(0)
  })

  account('REG-498 the MuulBackup widget gets this account, plan and a ZIP of every project, and what it restores comes back', { tag: '@P2' }, async ({ app, page, muul }) => {
    // Stand-in for the hosted widget (backup.js): it records what the app hands it and keeps the restore callback.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      w.MuulBackup = {
        open: async (cfg: Record<string, unknown> & { data: Blob; onRestore: (b: Blob) => Promise<void> }) => {
          const bytes = new Uint8Array(await cfg.data.arrayBuffer())
          let bin = ''
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          w.__e2eWidget = { product: cfg.product, token: cfg.token, apiBase: cfg.apiBase, fileName: cfg.fileName, tier: cfg.tier, zip: btoa(bin) }
          w.__e2eWidgetRestore = cfg.onRestore
        },
      }
    })
    await app.open()
    await app.pinSetup.createPin()
    await app.firstRunCatalogShown()
    await app.home.reach()
    await createProjects(app, ['Widget One', 'Widget Two'])
    const ids = await projectIds(page)
    const reminder = new BackupReminderChip(page)
    const me = muul.waitForCall('GET', '/api/iam/auth/me')
    await reminder.open.click()
    await me
    const handed = await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__e2eWidget).then((h) => h.jsonValue()) as {
      product: string; token: string; apiBase: string; fileName: string; tier: string; zip: string
    }
    expect(handed).toMatchObject({ product: 'CognitiveCanvas', token: muul.token, apiBase: MUUL_API, tier: 'pro' })
    expect(handed.fileName).toMatch(/^CognitiveCanvas-backup-\d{4}-\d{2}-\d{2}\.zip$/)
    const zip = new BackupZip(Buffer.from(handed.zip, 'base64'))
    expect([...zip.manifest.projectIds].sort()).toEqual(Object.values(ids).sort())

    // The widget hands a backup back: the app restores it, says so and reloads.
    await app.home.deleteProject('Widget Two')
    await expectStoreCount(page, 'projects', 1)
    const alerted = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await page.evaluate((b64) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const restore = (window as unknown as { __e2eWidgetRestore: (b: Blob) => Promise<void> }).__e2eWidgetRestore
      void restore(new Blob([bytes], { type: 'application/zip' }))
    }, handed.zip)
    expect(await alerted).toEqual({ type: 'alert', message: 'Restored successfully!' })
    await loaded
    expect((await readStore<{ id: string }>(page, 'projects')).map((p) => p.id).sort()).toEqual(Object.values(ids).sort())
  })
})
