/**
 * LIVE: the build under test against the REAL MuulOrigin sign-in, plan service
 * and Muul Cloud, with the dedicated QA account (fixtures/live.ts explains how
 * and what keeps it safe). Opt-in: `npm run test:live` with CC_LIVE_EMAIL and
 * CC_LIVE_PASSWORD set; never part of the regression run.
 *
 * Each test cleans up the cloud records it created, by its unique run tag,
 * whether it passed or not. It never touches the account's other backups.
 */
import { test, expect, LIVE_API } from '../../fixtures/live.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { snapshotDb, ofProject, expectSameLibrary, RESTORED_STORES } from '../../helpers/backupState.js'
import { projectWithPdf, answerNextDialog, RESTORE_CONFIRM } from '../../workflows/backup.js'
import { PlanScreen, SignOutDialog } from '../../pages/BackupScreens.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page } from '@playwright/test'
import type { DataCenter } from '../../pages/DataCenter.js'
import { knownDefect } from '../../helpers/defects.js'

interface Me { user: { userId: string; email: string; firstName?: string; lastName?: string } }

/** Boot a fresh profile on the real app address, signed in by the session cookie; returns the account as /me reports it. */
async function bootSignedIn(app: CognitiveCanvas, page: Page): Promise<Me> {
  const me = page.waitForResponse((r) => r.url().startsWith(`${LIVE_API}/api/iam/auth/me`) && r.ok(), { timeout: 60_000 })
  await app.open()
  await app.pinSetup.createPin()
  // A fresh profile opens the real content catalog first (offline runs see its error instead).
  await expect(page.getByRole('heading', { name: 'Explore Content' })).toBeVisible({ timeout: 60_000 })
  await app.home.reach()
  return (await (await me).json()) as Me
}

/** A project name the app accepts (letters, numbers and spaces) that still carries the run tag. */
const projectNameFor = (prefix: string, tag: string) => `${prefix} ${tag.replace(/[^A-Za-z0-9]/g, '')}`

/**
 * The cloud list's row texts once the real list is in: it says "No backups found" for a moment
 * before the server answers (DEF-511). So wait for the server's answer, then for the rows to stop
 * changing for a second.
 */
async function settledCloudRows(page: Page, dc: DataCenter, open: () => Promise<void>): Promise<string[]> {
  const listed = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().startsWith(`${LIVE_API}/api/backups?`), { timeout: 60_000 })
  await open()
  const { items = [] } = (await (await listed).json()) as { items?: unknown[] }
  if (items.length) await expect(dc.cloudRows.first()).toBeVisible({ timeout: 30_000 })
  let last = ''
  let since = Date.now()
  await expect.poll(async () => {
    const now = JSON.stringify(await dc.cloudRows.allInnerTexts())
    if (now !== last) { last = now; since = Date.now() }
    return Date.now() - since
  }, { timeout: 30_000, intervals: [250] }).toBeGreaterThanOrEqual(1_000)
  return JSON.parse(last) as string[]
}

async function openCloud(app: CognitiveCanvas, mode: 'Backup' | 'Restore') {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.choose(mode, 'Cloud')
  await expect(app.dataCenter.dialog.getByRole('heading', { name: mode === 'Backup' ? 'Backup to Cloud' : 'Restore from Cloud' })).toBeVisible({ timeout: 30_000 })
}

test.describe('Live: MuulOrigin account and Muul Cloud', { tag: ['@live', '@backup', '@cloud'] }, () => {
  test.describe.configure({ mode: 'serial' })

  test('REG-900 a real MuulOrigin sign-in reaches the app: the account is shown, the plan reads Pro and Cloud backup opens unlocked', { tag: '@P1' }, async ({ app, page, run }) => {
    const me = await bootSignedIn(app, page)
    expect(me.user.email).toBe(process.env.CC_LIVE_EMAIL)
    // The real plan service answered, and the app shows that plan.
    expect(run.apiCalls).toEqual(expect.arrayContaining(['GET /api/entitlements', 'GET /api/iam/auth/me']))
    const fullName = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ') || me.user.email
    await expect(new SignOutDialog(page).accountButton(fullName)).toBeVisible()
    await app.header.settings.click()
    await app.settings.tab('Plan').click()
    await expect(new PlanScreen(page).name).toHaveText('Pro', { timeout: 30_000 })
    await app.settings.back.click()

    // Cloud is unlocked (no plan gate) and shows the account's real storage figure.
    await openCloud(app, 'Backup')
    await expect(app.dataCenter.unlock).toHaveCount(0)
    await expect(app.dataCenter.storageFigure).toHaveText(/^[\d.,]+ (B|KB|MB|GB) \/ [\d.,]+ GB$/, { timeout: 30_000 })
  })

  test('REG-901 a project backed up to the real Muul Cloud is listed, restores identical after deletion, and its backup is then deleted', { tag: '@P1' }, async ({ app, page, run }) => {
    const dc = app.dataCenter
    await bootSignedIn(app, page)
    const { projectId } = await projectWithPdf(app, page, projectNameFor('Live', run.tag))
    const before = ofProject(await snapshotDb(page, RESTORED_STORES), projectId)

    // The account's other backups are listed first, and must be exactly the same at the end.
    const othersBefore = (await settledCloudRows(page, dc, () => openCloud(app, 'Restore'))).filter((t) => !t.includes(run.tag)).sort()
    await dc.close.click()

    await openCloud(app, 'Backup')
    await dc.description.fill(`Live round trip ${run.tag}`)
    const uploaded = page.waitForResponse((r) => r.url().startsWith(`${LIVE_API}/api/backups`) && r.request().method() === 'POST' && !r.url().includes('/usage'), { timeout: 120_000 })
    await dc.createBackup.click()
    expect((await uploaded).status()).toBeLessThan(300)
    await app.toasts.expectShown('Backed up to Cloud', 120_000)
    await expect(dc.dialog).toBeHidden()

    await app.home.deleteProject(projectNameFor('Live', run.tag))
    await expect.poll(async () => (await readStore<{ id: string }>(page, 'projects')).map((p) => p.id)).not.toContain(projectId)

    await openCloud(app, 'Restore')
    const row = dc.cloudRow(run.tag)
    await expect(row).toHaveCount(1, { timeout: 60_000 })
    await expect(row).toContainText('1 proj')
    await row.click()
    await expect(row.locator('input[name="cloudBackup"]')).toBeChecked()
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 120_000 })
    const downloaded = page.waitForResponse((r) => /\/api\/backups\/[^/]+\/download/.test(r.url()), { timeout: 120_000 })
    await dc.restoreNow.click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    expect((await downloaded).status()).toBe(200)
    await loaded
    await app.home.reach()
    await expect(app.home.card(projectNameFor('Live', run.tag))).toBeVisible({ timeout: 60_000 })
    // Every restored row equals what was backed up, PDF bytes included (by length and SHA-256).
    expectSameLibrary(ofProject(await snapshotDb(page, RESTORED_STORES), projectId), before, 'restored from the real cloud')
    await expectStoreCount(page, 'documents', 1)

    // Delete the backup through the app; the account's other backups are untouched.
    await openCloud(app, 'Restore')
    await expect(dc.cloudRow(run.tag)).toHaveCount(1, { timeout: 60_000 })
    const deleted = answerNextDialog(page, true)
    const del = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().startsWith(`${LIVE_API}/api/backups/`), { timeout: 60_000 })
    await dc.deleteBackup(dc.cloudRow(run.tag)).click()
    expect(await deleted).toEqual({ type: 'confirm', message: 'Are you sure you want to delete this backup from the cloud?' })
    expect((await del).status()).toBeLessThan(300)
    await expect(dc.cloudRow(run.tag)).toHaveCount(0, { timeout: 60_000 })
    await dc.close.click()
    expect((await settledCloudRows(page, dc, () => openCloud(app, 'Restore'))).filter((t) => !t.includes(run.tag)).sort()).toEqual(othersBefore)
  })

  test('REG-940 Restore from Cloud never says "No backups found" while it is still loading an account that has backups', { tag: '@P3' }, async ({ app, page, run }) => {
    knownDefect('DEF-511')
    const dc = app.dataCenter
    await bootSignedIn(app, page)
    // The account surely has a backup: this test's own (removed at teardown by its run tag).
    await projectWithPdf(app, page, projectNameFor('Flash', run.tag))
    await openCloud(app, 'Backup')
    await dc.description.fill(`Loading check ${run.tag}`)
    await dc.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 120_000)
    await expect(dc.dialog).toBeHidden()

    // Watch every change to the page from before the click, so a message shown for an instant is seen too.
    await page.evaluate(() => {
      const w = window as unknown as { __saidNoBackups: boolean }
      w.__saidNoBackups = false
      new MutationObserver(() => { if (document.body.innerText.includes('No backups found in Muul Cloud.')) w.__saidNoBackups = true })
        .observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    const listed = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().startsWith(`${LIVE_API}/api/backups?`), { timeout: 60_000 })
    await openCloud(app, 'Restore')
    const { items = [] } = (await (await listed).json()) as { items?: unknown[] }
    expect(items.length, 'the server lists the backup').toBeGreaterThan(0)
    await expect(dc.cloudRow(run.tag)).toHaveCount(1, { timeout: 30_000 })
    expect(await page.evaluate(() => (window as unknown as { __saidNoBackups: boolean }).__saidNoBackups), 'said "No backups found" while loading').toBe(false)
  })

  test('REG-902 signing out ends the real MuulOrigin session for this browser and keeps the local projects', { tag: '@P2' }, async ({ app, page, run }) => {
    const me = await bootSignedIn(app, page)
    await app.home.createProject(projectNameFor('Kept', run.tag))
    await app.documents.expectOpen(projectNameFor('Kept', run.tag))
    await app.documents.backToProjects.click()
    const fullName = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ') || me.user.email
    const out = new SignOutDialog(page)
    await out.accountButton(fullName).click()
    await out.menuItem.click()
    const logout = page.waitForResponse((r) => r.url() === `${LIVE_API}/api/iam/auth/logout`, { timeout: 30_000 })
    await out.confirm.click()
    expect((await logout).status()).toBeLessThan(300)
    await expect(app.header.profile).toBeVisible() // the "Sign in" button is back
    // The server revoked this browser's session: its refresh cookie no longer gets a token.
    const refresh = await page.evaluate(async (api) => (await fetch(`${api}/api/iam/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"refreshToken":""}', credentials: 'include' })).status, LIVE_API)
    expect(refresh).toBe(401)
    await expect(app.home.card(projectNameFor('Kept', run.tag))).toBeVisible()
  })
})
