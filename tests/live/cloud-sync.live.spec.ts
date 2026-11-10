/**
 * LIVE: cloud auto-sync across two devices on the real Muul Cloud, with the QA
 * account (fixtures/live.ts). Device A makes a project and syncs it up; device
 * B, a second fresh browser with its own session, receives it by itself; then
 * A deletes the project and the next sync removes its cloud copy through the
 * app's own deletion path (so the account's sync manifest records it).
 *
 * Joining the account as a new device also downloads the account's other
 * synced projects into these throwaway browsers; nothing of them is changed.
 */
import { test, expect, LIVE_ORIGIN, installLiveRoutes, newLiveSession, listCloud } from '../../fixtures/live.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { readStore } from '../../helpers/idb.js'
import { projectWithPdf } from '../../workflows/backup.js'
import { CloudSyncPanel } from '../../pages/BackupScreens.js'
import type { Page } from '@playwright/test'

test.use({ liveCloudSync: true })

async function boot(app: CognitiveCanvas, page: Page) {
  await app.open()
  await app.pinSetup.createPin()
  await expect(page.getByRole('heading', { name: 'Explore Content' })).toBeVisible({ timeout: 60_000 })
  await app.home.reach()
}

async function syncNow(app: CognitiveCanvas, page: Page) {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.source('Auto Backup').click()
  await app.dataCenter.autoChild('Cloud').click()
  const panel = new CloudSyncPanel(page)
  await expect(panel.switch).toHaveAttribute('aria-checked', 'true', { timeout: 60_000 })
  await panel.backUpNow.click()
  return panel
}

type Doc = { id: string; projectId: string; name: string; pageCount: number; data: { __bytes: number } }
const pick = (d: Doc) => ({ id: d.id, name: d.name, pageCount: d.pageCount, bytes: d.data.__bytes })

test.describe('Live: cloud auto-sync across devices', { tag: ['@live', '@backup', '@cloud-sync'] }, () => {
  // DEF-512: on an account that already syncs projects, one of them being written onto this fresh device
  // throws an unhandled IndexedDB AbortError. It depends on that account's data, not on what this test does,
  // so it is recorded on the test (with the app's log before it, by the page fixture) instead of failing it.
  test.use({ allowedPageErrors: [/^AbortError: AbortError$/] })
  test.beforeEach(({ page }, testInfo) => {
    page.on('pageerror', (e) => { if (e.message === 'AbortError') testInfo.annotations.push({ type: 'DEF-512 seen', description: (e.stack ?? e.message).slice(0, 200) }) })
  })

  test('REG-907 a project made on one device syncs to the real cloud, appears on a second device by itself, and leaves the cloud when deleted', { tag: '@P1' }, async ({ app, page, run, browser }) => {
    test.setTimeout(900_000)
    const name = `Sync ${run.tag.replace(/[^A-Za-z0-9]/g, '')}`
    const copyOf = (projectId: string) => async () => (await listCloud(page)).filter((i) => i.tags === `cc-project:${projectId}`)

    // Device A: the project, then Back up now. Its own copy appears in the real cloud, named and tagged.
    await boot(app, page)
    // The account's other backups (sync manifests aside, which the app rewrites by design) must not change.
    const others = async (exceptProject?: string) => (await listCloud(page))
      .filter((i) => !(i.tags ?? '').split(',').map((t) => t.trim()).includes('cc-manifest') && !(exceptProject && i.tags === `cc-project:${exceptProject}`))
      .map((i) => i.id).sort()
    const othersBefore = await others()
    const { projectId, documentId } = await projectWithPdf(app, page, name)
    await syncNow(app, page)
    await expect.poll(async () => (await copyOf(projectId)()).map((i) => i.description), { timeout: 300_000, message: 'device A uploaded the project' }).toEqual([name])
    const docA = (await readStore<Doc>(page, 'documents')).find((d) => d.id === documentId)!
    await app.dataCenter.close.click()

    // Device B: a fresh browser, signed in separately, with nothing local: the project arrives by itself.
    const session = await newLiveSession()
    const ctxB = await browser.newContext({ baseURL: LIVE_ORIGIN, storageState: session.file, viewport: { width: 1366, height: 800 }, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
    try {
      await installLiveRoutes(ctxB, true)
      const pageB = await ctxB.newPage()
      const appB = new CognitiveCanvas(pageB)
      await boot(appB, pageB)
      await expect.poll(async () => (await readStore<{ id: string }>(pageB, 'projects')).map((p) => p.id), { timeout: 300_000, message: 'device B received the project' }).toContain(projectId)
      const docB = (await readStore<Doc>(pageB, 'documents')).find((d) => d.id === documentId)
      expect(docB && pick(docB)).toEqual(pick(docA))
      await appB.reload()
      await appB.home.reach()
      await expect(appB.home.card(name)).toBeVisible({ timeout: 60_000 })
    } finally {
      await ctxB.close()
      session.dispose()
    }

    // Device A deletes it; the next sync removes the cloud copy (the app's own deletion path).
    await app.home.deleteProject(name)
    await syncNow(app, page)
    await expect.poll(async () => (await copyOf(projectId)()).length, { timeout: 300_000, message: 'the cloud copy was removed after the delete' }).toBe(0)
    expect(await others(projectId), 'the account\'s other backups are exactly as before').toEqual(othersBefore)
  })
})
