/**
 * Regression: GitHub backup and restore through the MoBrowser host bridge
 * (BackupDestinations github-backup / github-restore panels,
 * services/backup/bridgeService.ts pushToGit / listGitBackups / pullFromGit,
 * runBackup.ts). The host is the stateful stub in
 * helpers/mocks/moBrowserBridge.ts: it assembles streamed pushes into a fake
 * repository and keeps the backup index, so a push can be listed and pulled
 * back exactly as the real host would.
 *
 * GitHub needs the Economy plan; the account is the shared mock on 'dev'.
 */
import { test, expect } from '../../fixtures/backup.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { readStore } from '../../helpers/idb.js'
import { snapshotDb, expectSameLibrary, RESTORED_STORES } from '../../helpers/backupState.js'
import { REPO_DESCRIPTIONS, REPO_INDEX, type GitRepo } from '../../helpers/mocks/moBrowserBridge.js'
import { createProjects, projectIds, projectWithPdf, answerNextDialog, BACKUP_FILE_NAME } from '../../workflows/backup.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

const REPO: GitRepo = { id: 'e2e-repo-1', name: 'Test backups', owner: 'e2e-owner', repository: 'cc-test-backups', branch: 'main' }
const REPO_2: GitRepo = { id: 'e2e-repo-2', name: 'Second repo', owner: 'e2e-owner', repository: 'cc-second', branch: 'develop' }
const TARGET = { git: { id: REPO.id, owner: REPO.owner, repo: REPO.repository, repository: REPO.repository, branch: REPO.branch }, owner: REPO.owner, repo: REPO.repository, repository: REPO.repository, branch: REPO.branch }

const OFFLINE_BACKUP = "GitHub backup isn't available while you're offline. Connect to the internet and try again."
const OFFLINE_RESTORE = "GitHub restore isn't available while you're offline. Connect to the internet and try again."

async function openGithub(app: CognitiveCanvas, mode: 'Backup' | 'Restore') {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.choose(mode, 'GitHub')
  await expect(app.dataCenter.panelHeading).toHaveText(mode === 'Backup' ? 'Back up to GitHub' : 'Restore from GitHub')
}

test.describe('GitHub backup in MoBrowser', { tag: ['@regression', '@backup', '@github', '@api'] }, () => {
  test.use({ muulPlan: 'dev', moBrowser: { repos: [REPO], gitChunkBytes: 1024 } })

  test('REG-102 a push streams the ZIP of every project in ordered chunks to the chosen repository and commits it once', { tag: ['@P1'] }, async ({ signedIn: app, page, bridge }) => {
    await createProjects(app, ['Git One', 'Git Two'])
    const ids = await projectIds(page)
    await openGithub(app, 'Backup')
    await app.dataCenter.backUpNow.click()
    await app.toasts.expectShown('Backed up to Test backups', 30_000)

    const types = bridge.messages.map((m) => m.type)
    expect(types.indexOf('GIT_CAPABILITIES')).toBeLessThan(types.indexOf('GIT_STREAM_BEGIN'))
    const [begin] = bridge.sent('GIT_STREAM_BEGIN')
    const chunks = bridge.sent('GIT_STREAM_CHUNK')
    const [end] = bridge.sent('GIT_STREAM_END')
    expect(begin).toMatchObject({ ...TARGET, fileName: expect.stringMatching(BACKUP_FILE_NAME), name: begin.fileName, commitMessage: `chore(cognitive-canvas): backup ${String(begin.fileName)}` })
    const total = Number(begin.totalBytes)
    expect(chunks.length).toBe(Math.ceil(total / 1024))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i))
    expect(end).toMatchObject({ totalBytes: total })
    expect(types).not.toContain('GIT_ZIP')
    expect(types).not.toContain('GIT')

    const [push] = bridge.pushes
    expect(push.repo).toBe(REPO.id)
    expect(push.bytes.length).toBe(total)
    const zip = new BackupZip(push.bytes)
    expect(zip.manifest.type).toBe('multi')
    expect([...zip.manifest.projectIds].sort()).toEqual([ids['Git One'], ids['Git Two']].sort())
    // Each project's own data is inside, under its id.
    for (const name of ['Git One', 'Git Two']) expect(zip.json<{ id: string; name: string }>(`projects/${ids[name]}/project.json`)).toMatchObject({ id: ids[name], name })
    // The host keeps the index; the new backup is in it.
    expect(bridge.indexOf(REPO.id).map((e) => e.name)).toEqual([push.fileName])
  })

  test('REG-457 a backup note becomes the commit message and is saved in the repository, then shows on the restore row', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Noted Project'])
    await openGithub(app, 'Backup')
    await expect(dc.dialog.getByText('Optional: Add a note to identify this backup later')).toBeVisible()
    await expect(dc.noteInput).toHaveAttribute('maxlength', '1000')
    await dc.noteInput.fill('Before term 2')
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backed up to Test backups', 30_000)
    await expect(dc.noteInput).toHaveValue('')
    const [push] = bridge.pushes
    expect(push.commitMessage).toBe('backup: Before term 2')
    const saved = bridge.repoJson<{ descriptionsKind: string; descriptions: Record<string, string> }>(REPO.id, REPO_DESCRIPTIONS)
    expect(saved).toMatchObject({ descriptionsKind: 'cognitive-canvas-backup-descriptions', descriptions: { [push.fileName]: 'Before term 2' } })
    const write = bridge.sent('GIT').find((m) => (m.payload as { git: { filePath: string } }).git.filePath === REPO_DESCRIPTIONS)!
    expect((write.payload as { git: Record<string, unknown> }).git).toMatchObject({ commitMessage: 'chore(cognitive-canvas): update backup descriptions', id: REPO.id })

    await dc.modeToggle('Restore').click()
    await dc.destinationRow('Test backups').click()
    await expect(dc.restoreRows).toHaveCount(1)
    await expect(dc.restoreRows.first()).toHaveAccessibleName(/^Restore backup from .+ — Before term 2$/)
    await expect(dc.restoreRows.first()).toContainText('Before term 2')
  })

  test('REG-458 push errors from GitHub read as what to fix, and nothing is committed', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    await createProjects(app, ['Refused Project'])
    await openGithub(app, 'Backup')
    const NOT_FOUND = 'GitHub backup failed: repository not found, or the saved token lacks push (write) access to it. Check the GitHub repository + token in the browser vault.'
    const NOT_AUTHORISED = 'GitHub backup failed: the saved token is not authorized to push to this repository. It needs write (repo) scope.'
    for (const [error, message] of [['404 Not Found', NOT_FOUND], ['401 Bad credentials', NOT_AUTHORISED], ['403 Forbidden', NOT_AUTHORISED]] as const) {
      bridge.override('GIT_STREAM_BEGIN', { ok: false, error })
      await app.dataCenter.backUpNow.click()
      await app.toasts.expectShown(`Backup failed: ${message}`, 30_000)
      await expect(app.dataCenter.backUpNow).toHaveText('Back up now')
    }
    expect(bridge.pushes).toHaveLength(0)
    expect(bridge.sent('GIT_STREAM_CHUNK')).toHaveLength(0)
  })

  test('REG-459 offline, GitHub backup and restore say so instead of trying, and send nothing to the host', { tag: '@P2' }, async ({ signedIn: app, bridge, context }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Offline Git'])
    await openGithub(app, 'Backup')
    await context.setOffline(true)
    await expect(dc.dialog.getByRole('status')).toHaveText("You're offline — GitHub backup needs an internet connection.")
    await expect(dc.backUpNow).toHaveAttribute('title', OFFLINE_BACKUP)
    await dc.backUpNow.click()
    await app.toasts.expectShown(OFFLINE_BACKUP)
    await dc.modeToggle('Restore').click()
    await dc.destinationRow('Test backups').click()
    await app.toasts.expectShown(OFFLINE_RESTORE)
    expect(bridge.sent('GIT_STREAM_BEGIN')).toHaveLength(0)
    expect(bridge.sent('GIT_PULL')).toHaveLength(0)
    await context.setOffline(false)
  })
})

test.describe('GitHub backup on an older host', { tag: ['@regression', '@backup', '@github', '@api'] }, () => {
  test.use({ muulPlan: 'dev', moBrowser: { repos: [REPO] } })

  test('REG-489 a host that cannot stream gets the chunked push instead, and that backup is listed and restores too', { tag: '@P3' }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    const { projectId } = await projectWithPdf(app, page, 'Old Host')
    // Both streamed attempts are refused (not an auth error, so the app falls back instead of giving up).
    bridge.override('GIT_STREAM_BEGIN', { ok: false, error: 'stream sessions are not supported' }, { times: 2 })
    await openGithub(app, 'Backup')
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backed up to Test backups', 60_000)
    expect(bridge.sent('GIT_STREAM_BEGIN')).toHaveLength(2)
    expect(bridge.sent('GIT_ZIP')).toHaveLength(1)
    const [begin] = bridge.sent('GIT_STREAM_BEGIN')
    const id = String(begin.fileName).replace(/.zip$/, '')
    const writes = bridge.sent('GIT').map((m) => (m.payload as { git: { filePath: string } }).git.filePath)
    expect(writes).toEqual([`cognitive-canvas/backups/data/${id}/chunk-000.b64`, `cognitive-canvas/backups/data/${id}/manifest.json`, REPO_INDEX])
    expect(bridge.indexOf(REPO.id)).toEqual([expect.objectContaining({ name: begin.fileName, path: `cognitive-canvas/backups/data/${id}/manifest.json`, format: 'chunked', totalChunks: 1, totalSize: begin.totalBytes })])
    await dc.close.click()

    const before = await snapshotDb(page, RESTORED_STORES)
    await app.home.deleteProject('Old Host')
    await openGithub(app, 'Restore')
    await dc.destinationRow('Test backups').click()
    await expect(dc.restoreRows).toHaveCount(1)
    const accepted = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreRows.first().click()
    await accepted
    await loaded
    expect((await readStore<{ id: string }>(page, 'projects')).map((p) => p.id)).toEqual([projectId])
    await expect.poll(async () => (await readStore(page, 'documents')).length).toBe(1)
    // Put back together from the chunked push, the library is exactly what was backed up (PDF by SHA-256).
    expectSameLibrary(await snapshotDb(page, RESTORED_STORES), before, 'restored from the chunked push')
  })
})

test.describe('GitHub repositories', { tag: ['@regression', '@backup', '@github', '@api'] }, () => {
  test.use({ muulPlan: 'dev', moBrowser: { repos: [REPO, REPO_2] } })

  test('REG-460 with several repositories none is guessed: Back up now asks for one, the list offers each, and Refresh picks up a new one', { tag: '@P2' }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Which Repo'])
    await openGithub(app, 'Backup')
    await expect(dc.chooser('repository')).toHaveText('Choose a repository…')
    await expect(dc.dialog.getByText('One-off push to the chosen repository. For scheduled backups, use Auto Backup.')).toBeVisible()
    await dc.backUpNow.click()
    await app.toasts.expectShown('Choose a repository first')
    expect(bridge.sent('GIT_STREAM_BEGIN')).toHaveLength(0)

    await dc.chooser('repository').click()
    await expect(dc.menuOption('Test backups')).toHaveAccessibleName('Test backups e2e-owner/cc-test-backups · main')
    await expect(dc.menuOption('Second repo')).toHaveAccessibleName('Second repo e2e-owner/cc-second · develop')
    bridge.repos = [...bridge.repos, { id: 'e2e-repo-3', name: 'Third repo', owner: 'e2e-owner', repository: 'cc-third', branch: 'main' }]
    await dc.refreshRepositories.click()
    await expect(dc.menuOption('Third repo')).toBeVisible()
    await dc.menuOption('Second repo').click()
    await expect(dc.chooser('repository')).toHaveText('Second repoe2e-owner/cc-second · develop')
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('cc2_backup_prefs_v1')))!)).toMatchObject({ defaultGitDestId: REPO_2.id })
    await dc.backUpNow.click()
    await app.toasts.expectShown('Backed up to Second repo', 30_000)
    expect(bridge.pushes.map((p) => p.repo)).toEqual([REPO_2.id])
    expect(bridge.sent('GIT_STREAM_BEGIN')[0]).toMatchObject({ git: { id: REPO_2.id, branch: 'develop' }, branch: 'develop' })
  })

  test('REG-461 with no repository in the browser the list says how to add one, and restore has none to offer', { tag: '@P3' }, async ({ signedIn: app, bridge }) => {
    bridge.repos = []
    await openGithub(app, 'Backup')
    await app.dataCenter.chooser('repository').click()
    await expect(app.dataCenter.dialog.getByText("No repositories yet. Add one in the browser's credential manager.")).toBeVisible()
    await app.dataCenter.modeToggle('Restore').click()
    await expect(app.dataCenter.dialog.getByText('No repositories to restore from.')).toBeVisible()
  })
})

test.describe('GitHub restore list', { tag: ['@regression', '@backup', '@github', '@api'] }, () => {
  test.use({ muulPlan: 'dev', moBrowser: { repos: [REPO] } })

  test('REG-462 the list reads newest first with dates, sizes and the Latest chip; Refresh re-reads it and ← Repositories goes back', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    bridge.seedRepoBackup(REPO.id, 'cc-backup-2026-10-01_09-30-00.zip', Buffer.alloc(2048), '2026-10-01T09:30:00Z')
    bridge.seedRepoBackup(REPO.id, 'cc-backup-2026-10-05_14-05-00.zip', Buffer.alloc(5000), '2026-10-05T14:05:00Z', 'Mid-term')
    await openGithub(app, 'Restore')
    await expect(dc.dialog.getByText('Choose a repository, then pick a backup by date to restore.')).toBeVisible()
    await expect(dc.destinationRow('Test backups')).toHaveAccessibleName('Test backups e2e-owner/cc-test-backups · main ›')
    await dc.destinationRow('Test backups').click()
    await expect(dc.dialog.getByText('Backups in Test backups · main — restoring overwrites projects with the same name.')).toBeVisible()
    await expect(dc.restoreRows).toHaveCount(2)
    await expect(dc.restoreRows.nth(0)).toHaveAccessibleName('Restore backup from Oct 5, 2:05 PM — Mid-term')
    await expect(dc.restoreRows.nth(0)).toContainText(/^Oct 5, 2:05 PMLatestMid-term\d+ days? ago · 5 KB$/)
    await expect(dc.restoreRows.nth(1)).toHaveAccessibleName('Restore backup from Oct 1, 9:30 AM')
    await expect(dc.restoreRows.nth(1)).toContainText(/^Oct 1, 9:30 AM\d+ days? ago · 2 KB$/)

    bridge.seedRepoBackup(REPO.id, 'cc-backup-2026-10-20_08-00-00.zip', Buffer.alloc(1024), '2026-10-20T08:00:00Z')
    const pulls = bridge.sent('GIT_PULL').length
    await dc.refreshList.click()
    await expect(dc.restoreRows).toHaveCount(3)
    await expect(dc.restoreRows.nth(0)).toHaveAccessibleName('Restore backup from Oct 20, 8:00 AM')
    expect(bridge.sent('GIT_PULL').length).toBeGreaterThan(pulls)
    expect(bridge.sent('GIT_PULL').some((m) => (m.payload as { filePath: string; git: { id: string } }).filePath === REPO_INDEX && (m.payload as { git: { id: string } }).git.id === REPO.id)).toBe(true)
    await dc.backToRepositories.click()
    await expect(dc.destinationRow('Test backups')).toBeVisible()
  })

  test('REG-463 an empty repository says so, and a list the host cannot read is reported as a failure, not as empty', { tag: '@P2' }, async ({ signedIn: app, bridge }) => {
    const dc = app.dataCenter
    await openGithub(app, 'Restore')
    await dc.destinationRow('Test backups').click()
    await expect(dc.dialog.getByText('No backups found in this repository yet.')).toBeVisible()

    bridge.override('GIT_PULL', { ok: false, error: '500 Internal Server Error' }, { when: (m) => (m.payload as { filePath: string }).filePath === REPO_INDEX })
    await dc.refreshList.click()
    const alert = dc.dialog.getByRole('alert')
    await expect(alert).toContainText("Couldn't read the backup list")
    await expect(alert).toContainText('GitHub did not return the backup list (500 Internal Server Error).')
    await expect(alert).toContainText("The repository may still hold backups. Press Refresh; if it keeps failing, check this device's GitHub credential and branch in the browser.")
    await expect(dc.dialog.getByText('No backups found in this repository yet.')).toHaveCount(0)
  })

  test('REG-464 dismissing the restore confirmation reads nothing; a backup the host cannot read fails with the reason and changes nothing', { tag: '@P2' }, async ({ signedIn: app, page, bridge }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Keep Git'])
    const before = await readStore(page, 'projects')
    bridge.seedRepoBackup(REPO.id, 'cc-backup-2026-10-05_14-05-00.zip', Buffer.alloc(4096), '2026-10-05T14:05:00Z')
    await openGithub(app, 'Restore')
    await dc.destinationRow('Test backups').click()
    const dismissed = answerNextDialog(page, false)
    await dc.restoreRows.first().click()
    await dismissed
    expect(bridge.sent('GIT_STAT')).toHaveLength(0)

    bridge.override('GIT_STAT', { ok: false, error: '502 Bad Gateway' })
    const accepted = answerNextDialog(page, true)
    await dc.restoreRows.first().click()
    await accepted
    await app.toasts.expectShown('Restore failed: git_stat failed: 502 Bad Gateway', 30_000)
    await expect(dc.restoreRows.first()).toBeEnabled()
    expect(await readStore(page, 'projects')).toEqual(before)
  })
})

test.describe('GitHub in an ordinary browser', { tag: ['@regression', '@backup', '@github', '@api'] }, () => {
  test.use({ muulPlan: 'dev' })
  test('REG-465 without MoBrowser, GitHub backup and restore explain that the app is needed and Download MoBrowser opens its page', { tag: '@P2' }, async ({ signedIn: app, context, blockedRequests }) => {
    const dc = app.dataCenter
    await openGithub(app, 'Backup')
    await expect(dc.dialog.getByText('Choose a repository from the browser, then push a backup right now.')).toBeVisible()
    await expect(dc.openInMoBrowser).toBeVisible()
    await expect(dc.dialog.getByText('Backing up to a local folder or GitHub needs the MoBrowser custom app, which securely holds your folder paths and git credentials.')).toBeVisible()
    await expect(dc.chooser('repository')).toHaveCount(0)
    const opened = context.waitForEvent('request', (r) => r.url() === 'https://muulorigin.com/products/mobrowser')
    await dc.downloadMoBrowser.click()
    await opened
    expect(blockedRequests).toContain('GET https://muulorigin.com/products/mobrowser')
    await dc.modeToggle('Restore').click()
    await expect(dc.panelHeading).toHaveText('Restore from GitHub')
    await expect(dc.openInMoBrowser).toBeVisible()
  })
})
