/**
 * Regression: automatic cloud sync (Data Center > Auto Backup > Cloud,
 * settings/CloudSyncSection.tsx, hooks/useCloudSync.ts,
 * services/backup/cloudProjectBackup.ts, cloudSyncPrefs.ts, CloudSyncNotice.tsx)
 * against the stateful fake cloud store.
 *
 * Sync keeps one cloud copy per project (cc-project-<id>.zip, tagged
 * cc-project:<id>) plus a manifest (cc-manifest.json); a device that is
 * missing a project the cloud has downloads it. REG-104 runs two browser
 * contexts ("devices") against one shared store, on Playwright's clock so the
 * scheduler's 15 s / 30 s waits are jumped over.
 */
import { test, expect } from '../../fixtures/backup.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { CloudBackupStore } from '../../helpers/mocks/cloudBackups.js'
import { MuulApiMock } from '../../helpers/mocks/muulAccount.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { createProjects, projectIds, projectWithPdf, bootToHome } from '../../workflows/backup.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { baseURL } from '../../config/env.js'
import { MUUL_WWW } from '../../helpers/mocks/muulAccount.js'
import type { Page } from '@playwright/test'

const TEN_GB = 10 * 1024 ** 3
const UNAVAILABLE = 'Muul Cloud is temporarily unavailable. Nothing was lost — try again shortly.'

async function openCloudSync(app: CognitiveCanvas) {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.source('Auto Backup').click()
  await expect(app.dataCenter.autoChild('Cloud')).toBeVisible()
}

const syncPrefs = async (page: Page) => JSON.parse((await page.evaluate(() => localStorage.getItem('cc2_cloud_sync_v1'))) ?? '{}') as {
  enabled: boolean; noticeShownFor: string[]; uploads: Record<string, { at: number; backupId?: string }>; lastSyncAt: number; lastStatus: string
}

test.describe('Cloud sync without a cloud plan', { tag: ['@regression', '@backup', '@cloud-sync', '@api'] }, () => {
  test.use({ muulPlan: 'free' })
  test('REG-479 a plan without cloud storage explains what sync needs, keeps the switch away and links to the plans', { tag: '@P2' }, async ({ signedIn: app, ui, page }) => {
    await openCloudSync(app)
    await expect(ui.cloudSync.heading).toBeVisible()
    await expect(app.dataCenter.dialog.getByText('Keep every project backed up automatically, and pick up where you left off on another device.')).toBeVisible()
    await expect(app.dataCenter.dialog.getByText('Not included on your current plan')).toBeVisible()
    await expect(app.dataCenter.dialog.getByText('Cloud sync needs a plan with cloud storage (Pro). Your projects stay on this device in the meantime — you can still back up to a file or a local folder from the Data Center, and restore any cloud backups you already have.')).toBeVisible()
    await expect(ui.cloudSync.switch).toHaveCount(0)
    await page.route(`${MUUL_WWW}/products/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }))
    await ui.cloudSync.seePlans.click()
    await page.waitForURL(`${MUUL_WWW}/products/**`)
    expect(page.url()).toBe(`${MUUL_WWW}/products/cognitive-canvas#pricing`)
  })
})

test.describe('Cloud sync switched off', { tag: ['@regression', '@backup', '@cloud-sync', '@api'] }, () => {
  test.use({ muulPlan: 'pro', muulCloudSync: false })
  test('REG-480 off, sync says the projects are only here; switching it on shows storage, last sync and each project waiting', { tag: '@P1' }, async ({ signedIn: app, ui, page, cloud }) => {
    await createProjects(app, ['Sync Alpha', 'Sync Beta'])
    await openCloudSync(app)
    const cs = ui.cloudSync
    await expect(cs.switch).toHaveAttribute('aria-checked', 'false')
    await expect(cs.status).toHaveText('Off — your projects are only on this device.')
    await expect(cs.backUpNow).toHaveCount(0)
    await cs.switch.click()
    await expect(cs.switch).toHaveAttribute('aria-checked', 'true')
    await expect(cs.status).toHaveText('2 projects waiting to back up.')
    // The figure and its allowance are two spans with a margin between them, no space character.
    await expect(cs.storageUsed).toHaveText('0 Bof 10.00 GB')
    await expect(cs.lastSync).toHaveText('never')
    await expect(app.dataCenter.dialog.getByText("Backs up on its own after you finish working — there's nothing to schedule.")).toBeVisible()
    for (const name of ['Sync Alpha', 'Sync Beta']) await expect(cs.row(name)).toHaveText(`${name}Not yet backed upRemove`)
    expect((await syncPrefs(page)).enabled).toBe(true)
    // Turning it on uploads nothing by itself.
    expect(cloud.state.uploads).toHaveLength(0)
  })
})

test.describe('Cloud sync', { tag: ['@regression', '@backup', '@cloud-sync', '@api'] }, () => {
  test.use({ muulPlan: 'pro', muulCloudSync: true })

  test('REG-481 Back up now uploads each project as its own tagged copy plus a manifest, then has nothing more to do', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, ui, page, cloud }) => {
    await createProjects(app, ['Sync Alpha', 'Sync Beta'])
    const ids = await projectIds(page)
    await openCloudSync(app)
    const cs = ui.cloudSync
    await cs.backUpNow.click()
    await app.toasts.expectShown('Backed up 2 projects', 30_000)
    await expect(cs.status).toHaveText('Everything is backed up.')
    await expect(cs.lastSync).toHaveText('just now')
    for (const name of ['Sync Alpha', 'Sync Beta']) await expect(cs.row(name)).toHaveText(`${name}just nowBacked upRemove`)

    const projectUploads = cloud.state.uploads.filter((u) => u.fields.tags?.startsWith('cc-project:'))
    expect(projectUploads.map((u) => [u.file!.filename, u.fields.description, u.fields.tags, u.fields.storageType, u.fields.product]).sort()).toEqual([
      [`cc-project-${ids['Sync Alpha']}.zip`, 'Sync Alpha', `cc-project:${ids['Sync Alpha']}`, 'cloud', 'CognitiveCanvas'],
      [`cc-project-${ids['Sync Beta']}.zip`, 'Sync Beta', `cc-project:${ids['Sync Beta']}`, 'cloud', 'CognitiveCanvas'],
    ].sort())
    for (const u of projectUploads) {
      const zip = new BackupZip(u.file!.bytes)
      const id = u.fields.tags!.slice('cc-project:'.length)
      expect(zip.manifest).toMatchObject({ type: 'single', projectIds: [id] })
      // The copy holds that project, not just a label for it.
      expect(zip.json<{ id: string; name: string }>('project.json')).toMatchObject({ id, name: u.fields.description })
    }
    const [manifest] = cloud.state.manifests()
    expect(manifest.item).toMatchObject({ fileName: 'cc-manifest.json', description: 'Cognitive Canvas manifest', tags: 'cc-manifest' })
    const body = JSON.parse(manifest.bytes.toString('utf8'))
    expect(body).toMatchObject({ version: 1, tombstones: [] })
    expect(body.projects.map((p: { id: string; name: string }) => [p.name, p.id])).toEqual([['Sync Alpha', ids['Sync Alpha']], ['Sync Beta', ids['Sync Beta']]])
    const prefs = await syncPrefs(page)
    expect(Object.keys(prefs.uploads).sort()).toEqual([ids['Sync Alpha'], ids['Sync Beta']].sort())
    expect(prefs.lastStatus).toBe('ok')

    const uploads = cloud.state.uploads.length
    await cs.backUpNow.click()
    await app.toasts.expectShown('Everything is already backed up', 30_000)
    expect(cloud.state.uploads).toHaveLength(uploads)
  })

  test('REG-482 a changed project uploads again, its older sync copy and the old manifest are deleted, and manual backups stay', { tag: '@P1' }, async ({ signedIn: app, ui, page, cloud }) => {
    const manual = cloud.seed({ bytes: Buffer.alloc(32), description: 'My manual backup', tags: '{"projectCount":1}' })
    await createProjects(app, ['Keeps One', 'Untouched'])
    const ids = await projectIds(page)
    await openCloudSync(app)
    await ui.cloudSync.backUpNow.click()
    await app.toasts.expectShown('Backed up 2 projects', 30_000)
    const firstCopy = cloud.state.syncCopies(ids['Keeps One'])[0].item.id
    const firstManifest = cloud.state.manifests()[0].item.id
    await app.dataCenter.close.click()

    await app.home.renameProject('Keeps One', 'Keeps One Renamed')
    await openCloudSync(app)
    await expect(ui.cloudSync.status).toHaveText('1 project waiting to back up.')
    await expect(ui.cloudSync.row('Keeps One Renamed')).toHaveText('Keeps One RenamedWaitingRemove')
    await ui.cloudSync.backUpNow.click()
    await app.toasts.expectShown('Backed up 1 project', 30_000)
    const copies = cloud.state.syncCopies(ids['Keeps One'])
    expect(copies).toHaveLength(1)
    expect(copies[0].item.id).not.toBe(firstCopy)
    expect(copies[0].item.description).toBe('Keeps One Renamed')
    // The new copy carries the renamed project, not a stale ZIP under a fresh label.
    expect(new BackupZip(copies[0].bytes).json<{ name: string }>('project.json').name).toBe('Keeps One Renamed')
    expect(cloud.state.deletes).toEqual(expect.arrayContaining([firstCopy, firstManifest]))
    expect(cloud.state.manifests()).toHaveLength(1)
    expect(cloud.state.syncCopies(ids['Untouched'])).toHaveLength(1)
    expect(cloud.state.find(manual.id)).toBeTruthy()
    expect(cloud.state.deletes).not.toContain(manual.id)
  })

  test('REG-483 Remove asks once more, deletes the cloud copy and keeps the project off the cloud until Sync again', { tag: '@P2' }, async ({ signedIn: app, ui, page, cloud }) => {
    await createProjects(app, ['Leaving Cloud', 'Staying'])
    const ids = await projectIds(page)
    await openCloudSync(app)
    const cs = ui.cloudSync
    await cs.backUpNow.click()
    await app.toasts.expectShown('Backed up 2 projects', 30_000)
    const copy = cloud.state.syncCopies(ids['Leaving Cloud'])[0].item.id

    await cs.removeButton('Leaving Cloud').click()
    await expect(cs.removeButton('Leaving Cloud')).toHaveText('Remove from cloud?')
    expect(cloud.state.deletes).not.toContain(copy)
    await cs.removeButton('Leaving Cloud').click()
    await app.toasts.expectShown('Removed "Leaving Cloud" from the cloud - it will not sync again', 30_000)
    expect(cloud.state.deletes).toContain(copy)
    expect(cloud.state.syncCopies(ids['Leaving Cloud'])).toHaveLength(0)
    await expect(cs.row('Leaving Cloud')).toHaveText('Leaving CloudKept off the cloudSync again')
    await expect(app.dataCenter.dialog.getByText('1 kept off the cloud')).toBeVisible()
    // The project itself stays on this device.
    await expectStoreCount(page, 'projects', 2)

    const before = cloud.state.uploads.length
    await cs.backUpNow.click()
    await app.toasts.expectShown('Everything is already backed up', 30_000)
    expect(cloud.state.uploads.slice(before).some((u) => u.fields.tags === `cc-project:${ids['Leaving Cloud']}`)).toBe(false)

    await cs.syncAgain('Leaving Cloud').click()
    await app.toasts.expectShown('"Leaving Cloud" will sync again on the next backup')
    await expect(cs.row('Leaving Cloud')).toContainText('Remove')
    await expect(app.dataCenter.dialog.getByText('1 kept off the cloud')).toHaveCount(0)
  })

  test('REG-951 with no projects the Cloud section says anything new backs up on its own; a project that never reached the cloud is taken off sync with its own message and nothing deleted; the buttons say what they do', { tag: '@P3' }, async ({ signedIn: app, ui, page, cloud }) => {
    await openCloudSync(app)
    const cs = ui.cloudSync
    const dialog = app.dataCenter.dialog
    await expect(dialog.getByText('Your projects back up automatically in the background, so you can pick them up on another device.', { exact: true })).toBeVisible()
    await expect(dialog.getByText('No projects yet. Anything you create will back up automatically.', { exact: true })).toBeVisible()
    // The scheduler (hooks/useCloudSync.ts) first looks 15 s after the app starts and, never having synced, syncs
    // at once; after that it waits for 2 quiet minutes after an edit. Let that first run happen with nothing to
    // upload, so the project made below stays out of the cloud for the rest of the test.
    await expect.poll(async () => (await syncPrefs(page)).lastSyncAt ?? 0, { timeout: 45_000, message: 'the first automatic sync ran' }).toBeGreaterThan(0)
    await app.dataCenter.close.click()
    await expect(dialog).toBeHidden()

    await createProjects(app, ['Never Uploaded'])
    const ids = await projectIds(page)
    await openCloudSync(app)
    await expect(cs.row('Never Uploaded')).toHaveText('Never UploadedNot yet backed upRemove')
    await expect(cs.removeButton('Never Uploaded')).toHaveAttribute('title', "Deletes this project's cloud copy and stops it syncing. The project stays on this device.")
    await expect(dialog.getByText('deletes only the cloud copy and stops that project syncing - it stays on this device, and your other devices drop their copy on their next sync.', { exact: false })).toBeVisible()

    const deletesBefore = [...cloud.state.deletes]
    await cs.removeButton('Never Uploaded').click()
    await expect(cs.removeButton('Never Uploaded')).toHaveText('Remove from cloud?')
    await cs.removeButton('Never Uploaded').click()
    // Nothing of it was in the cloud, so the message says it stops syncing rather than that it was removed.
    await app.toasts.expectShown('"Never Uploaded" is no longer syncing to the cloud', 30_000)
    expect(cloud.state.deletes).toEqual(deletesBefore)
    expect(cloud.state.syncCopies(ids['Never Uploaded'])).toHaveLength(0)
    await expect(cs.row('Never Uploaded')).toHaveText('Never UploadedKept off the cloudSync again')
    await expect(cs.syncAgain('Never Uploaded')).toHaveAttribute('title', 'Let this project sync to the cloud again')
    await expectStoreCount(page, 'projects', 1)

    await cs.syncAgain('Never Uploaded').click()
    await app.toasts.expectShown('"Never Uploaded" will sync again on the next backup')
    await expect(cs.row('Never Uploaded')).toHaveText('Never UploadedNot yet backed upRemove')
  })

  test('REG-484 a failed upload and a full cloud are each reported on the toast and the status line', { tag: '@P2' }, async ({ signedIn: app, ui, cloud }) => {
    await createProjects(app, ['Sync Trouble'])
    await openCloudSync(app)
    const cs = ui.cloudSync
    cloud.failNext('POST', '/api/backups/upload', { status: 500, json: {} })
    await cs.backUpNow.click()
    await app.toasts.expectShown(UNAVAILABLE, 30_000)
    await expect(cs.status).toHaveText(UNAVAILABLE)
    expect(cloud.state.syncCopies()).toHaveLength(0)

    cloud.state.usageOverride = TEN_GB
    const full = 'Cloud storage is full — sync paused. Delete an old backup from Restore to free some space.'
    await cs.backUpNow.click()
    await app.toasts.expectShown(full, 30_000)
    await expect(cs.status).toHaveText(full)
    expect(cloud.state.syncCopies()).toHaveLength(0)

    // Flipping the switch clears the stale outcome.
    await cs.switch.click()
    await cs.switch.click()
    await expect(cs.status).toHaveText('1 project waiting to back up.')
  })

  test('REG-485 Sync details lists plan, switch, the backups in the cloud and the last attempt', { tag: '@P3' }, async ({ signedIn: app, ui, cloud }) => {
    cloud.seed({ bytes: Buffer.alloc(16), description: 'Manual one' })
    await createProjects(app, ['Detail One', 'Detail Two'])
    await openCloudSync(app)
    const cs = ui.cloudSync
    await cs.backUpNow.click()
    await app.toasts.expectShown('Backed up 2 projects', 30_000)
    await cs.details.locator('summary').click()
    await expect(cs.detail('Plan')).toHaveText('Pro · active')
    await expect(cs.detail('Cloud sync allowed')).toHaveText('Yes')
    await expect(cs.detail('Switched on')).toHaveText('Yes')
    await expect(cs.detail('Synced project backups')).toHaveText('2')
    await expect(cs.detail('Other backups in cloud')).toHaveText('1')
    await expect(cs.detail('Sync index found')).toHaveText('Yes')
    await expect(cs.detail('Last attempt')).toHaveText('just now · ok')
  })
})

test.describe('First-run cloud notice', { tag: ['@regression', '@backup', '@cloud-sync', '@api'] }, () => {
  test.use({ muulPlan: 'pro', muulCloudSync: true })
  test('REG-486 the "Cloud backup is on" notice appears once per account; Turn it off switches sync off, Manage opens Auto Backup > Cloud', { tag: '@P2' }, async ({ app, ui, page, muul }) => {
    // The shared mock marks the notice as seen; this account has never been told.
    await page.addInitScript((sub) => {
      if (sessionStorage.getItem('__e2e_notice_reset')) return
      sessionStorage.setItem('__e2e_notice_reset', '1')
      const prefs = JSON.parse(localStorage.getItem('cc2_cloud_sync_v1') ?? '{}')
      localStorage.setItem('cc2_cloud_sync_v1', JSON.stringify({ ...prefs, noticeShownFor: prefs.noticeShownFor?.filter((s: string) => s !== sub) ?? [] }))
    }, muul.identity.sub)
    await app.open()
    await app.pinSetup.createPin()
    // The notice dismisses itself after 10 s unless the pointer rests on it.
    await ui.notice.toast.hover()
    await expect(ui.notice.toast).toContainText('Your plan includes it, so each project saves to your account as you work. Sign in on another device and your work is already there.')
    await ui.notice.turnOff.click()
    await expect(ui.notice.toast).toBeHidden()
    let prefs = await syncPrefs(page)
    expect(prefs.enabled).toBe(false)
    expect(prefs.noticeShownFor).toContain(muul.identity.sub)

    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('cc2_cloud_sync_v1')!)
      localStorage.setItem('cc2_cloud_sync_v1', JSON.stringify({ ...p, enabled: true, noticeShownFor: [] }))
    })
    await app.reload()
    await ui.notice.toast.hover()
    await ui.notice.manage.click()
    await expect(ui.cloudSync.heading).toBeVisible()
    await expect(ui.cloudSync.switch).toHaveAttribute('aria-checked', 'true')
    await expect(ui.notice.toast).toBeHidden()
    prefs = await syncPrefs(page)
    expect(prefs.noticeShownFor).toContain(muul.identity.sub)
  })
})

test.describe('Cross-device sync', { tag: ['@regression', '@backup', '@cloud-sync', '@api'] }, () => {
  test.use({ muulPlan: 'pro', muulCloudSync: true })
  test('REG-104 a project made on one device syncs up on its own and appears on a second signed-in device', { tag: ['@P1'] }, async ({ app, page, cloud, browser }) => {
    // Device A, on fake timers so the scheduler's waits can be jumped.
    await page.clock.install()
    await bootToHome(app)
    const { projectId } = await projectWithPdf(app, page, 'Travels Between')
    // Sync waits for edits to settle for 2 minutes (the first, empty check already ran during set-up).
    await page.clock.fastForward(150_000)
    await expect.poll(() => cloud.state.syncCopies(projectId).length, { timeout: 30_000, message: 'device A uploaded its project' }).toBe(1)
    // The manifest is uploaded after the project copy, as a separate request.
    await expect.poll(() => cloud.state.manifests().length, { timeout: 30_000, message: 'device A uploaded its sync manifest' }).toBe(1)

    // Device B: a fresh profile signed in to the same account and the same cloud.
    const origin = new URL(baseURL).origin
    const ctxB = await browser.newContext({ baseURL, viewport: { width: 1366, height: 800 }, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block', reducedMotion: 'reduce' })
    try {
      await ctxB.route((url) => url.origin !== origin && url.protocol !== 'data:' && url.protocol !== 'blob:', (r) => r.abort('blockedbyclient'))
      const pageB = await ctxB.newPage()
      const muulB = await MuulApiMock.install(pageB, { plan: 'pro', cloudSync: true })
      await CloudBackupStore.install(muulB, pageB, cloud.state)
      const appB = new CognitiveCanvas(pageB)
      await pageB.clock.install()
      await bootToHome(appB)
      await expectStoreCount(pageB, 'projects', 0)
      await pageB.clock.fastForward(31_000)
      await expect.poll(async () => (await readStore<{ id: string }>(pageB, 'projects')).map((p) => p.id), { timeout: 30_000, message: 'device B pulled the project' }).toEqual([projectId])
      const pick = (d: { id: string; name: string; pageCount: number; data: { __bytes: number } }) => ({ id: d.id, name: d.name, pageCount: d.pageCount, bytes: d.data.__bytes })
      const [docB] = await readStore<{ id: string; name: string; pageCount: number; data: { __bytes: number } }>(pageB, 'documents')
      const [docA] = await readStore<{ id: string; name: string; pageCount: number; data: { __bytes: number } }>(page, 'documents')
      expect(pick(docB)).toEqual(pick(docA))
      // B pulled, it did not push a second copy.
      expect(cloud.state.syncCopies(projectId)).toHaveLength(1)
      await appB.reload()
      await appB.home.reach()
      await expect(appB.home.card('Travels Between')).toBeVisible()
    } finally {
      await ctxB.close()
    }
  })
})
