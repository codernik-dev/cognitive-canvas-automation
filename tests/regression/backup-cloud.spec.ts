/**
 * Regression: manual Cloud backup and restore against the stateful fake
 * cloud store (BackupView / RestoreView with source 'cloud',
 * services/backup/cloudBackupApi.ts, backupLimits.ts, chunkedUpload.ts).
 *
 * Every request goes to the mock (helpers/mocks/cloudBackups.ts on top of
 * helpers/mocks/muulAccount.ts); the specs assert what the app SENT (method,
 * path, multipart fields, the ZIP itself) and what it DID with each answer.
 */
import { test, expect } from '../../fixtures/backup.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { snapshotDb, expectSameLibrary, RESTORED_STORES } from '../../helpers/backupState.js'
import type { MockReply } from '../../helpers/mocks/muulAccount.js'
import { knownDefect } from '../../helpers/defects.js'
import { createProjects, projectIds, projectWithPdf, answerNextDialog, RESTORE_CONFIRM, BACKUP_FILE_NAME } from '../../workflows/backup.js'
import { BINARY, FIND_PDF } from '../../data/files.js'
import { cc2BackupZip } from '../../data/content-files.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

const TEN_GB = 10 * 1024 ** 3
const SESSION_EXPIRED = 'Your session has expired. Sign in again, then retry the backup.'
const UNAVAILABLE = 'Muul Cloud is temporarily unavailable. Nothing was lost — try again shortly.'

/** Data Center > Backup > Cloud, with an optional note typed. */
async function openCloudBackup(app: CognitiveCanvas, note?: string) {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.choose('Backup', 'Cloud')
  await expect(app.dataCenter.dialog.getByRole('heading', { name: 'Backup to Cloud' })).toBeVisible()
  if (note !== undefined) await app.dataCenter.description.fill(note)
}

async function openCloudRestore(app: CognitiveCanvas) {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.choose('Restore', 'Cloud')
  await expect(app.dataCenter.dialog.getByRole('heading', { name: 'Restore from Cloud' })).toBeVisible()
}

test.describe('Cloud backup', { tag: ['@regression', '@backup', '@cloud', '@api'] }, () => {
  test('REG-101 a project backed up to the cloud is listed, restores after being deleted, and the backup can then be deleted', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, cloud, muul }) => {
    const dc = app.dataCenter
    const { projectId } = await projectWithPdf(app, page, 'Cloud Trip')
    await openCloudBackup(app, 'Round trip')
    await dc.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    await expect(dc.dialog).toBeHidden()
    expect(cloud.state.backups).toHaveLength(1)
    const [stored] = cloud.state.backups
    // What reached the cloud is a ZIP of this project holding the PDF itself, byte for byte.
    const zip = new BackupZip(stored.bytes)
    expect(zip.manifest.projectIds).toEqual([projectId])
    expect(zip.documentFiles(projectId)).toHaveLength(1)
    expect(Buffer.from(zip.files[zip.documentFiles(projectId)[0]]).equals(FIND_PDF.payload().buffer)).toBe(true)

    const before = await snapshotDb(page, RESTORED_STORES)
    await app.home.deleteProject('Cloud Trip')
    await expectStoreCount(page, 'projects', 0)
    await openCloudRestore(app)
    const row = dc.cloudRow('Round trip')
    await expect(row).toContainText(`v${stored.item.version}Round trip`)
    await expect(row).toContainText('1 proj')
    await expect(row.locator('input[name="cloudBackup"]')).toBeChecked()
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreNow.click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await app.toasts.expectShown('Restored from Cloud — refreshing…', 30_000)
    await loaded
    expect(cloud.state.downloads).toEqual([stored.item.id])
    expect(muul.callsTo('GET', `/api/backups/${stored.item.id}/download`)[0].url.searchParams.get('product')).toBe('CognitiveCanvas')
    await app.home.reach()
    await expect(app.home.card('Cloud Trip')).toBeVisible()
    expect((await readStore<{ id: string }>(page, 'projects')).map((p) => p.id)).toEqual([projectId])
    expectSameLibrary(await snapshotDb(page, RESTORED_STORES), before, 'restored from the cloud')

    await openCloudRestore(app)
    const deleted = answerNextDialog(page, true)
    await dc.deleteBackup(dc.cloudRow('Round trip')).click()
    expect(await deleted).toEqual({ type: 'confirm', message: 'Are you sure you want to delete this backup from the cloud?' })
    await expect(dc.dialog.getByText('No backups found in Muul Cloud.')).toBeVisible()
    expect(cloud.state.deletes).toEqual([stored.item.id])
    expect(muul.callsTo('DELETE', `/api/backups/${stored.item.id}`)[0].url.searchParams.get('product')).toBe('CognitiveCanvas')
  })

  test('REG-437 the upload carries the product, storage type, required note, project count and a timestamped ZIP of exactly the selected projects', { tag: '@P1' }, async ({ signedIn: app, page, cloud, muul }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Cloud A', 'Cloud B', 'Cloud C'])
    const ids = await projectIds(page)
    await openCloudBackup(app)
    await expect(dc.dialog.getByText('Securely upload your projects to Muul Cloud. They will be available across all your connected devices.')).toBeVisible()
    await expect(dc.dialog.getByText('Describe this backup*')).toBeVisible()
    await expect(dc.dialog.getByText('A short note to identify this backup later')).toBeVisible()
    await expect(dc.selectionCount).toHaveText('Select Projects (3/3)')
    // The note is required: blank or spaces keep the button disabled. It is capped at 1000 characters.
    await expect(dc.description).toHaveAttribute('maxlength', '1000')
    await expect(dc.createBackup).toBeDisabled()
    await dc.description.fill('   ')
    await expect(dc.createBackup).toBeDisabled()
    await dc.description.fill('Sprint 12 end')
    await dc.projectRow('Cloud B').click()
    await expect(dc.createBackup).toHaveText('Create Backup (2)')
    await dc.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)

    expect(cloud.state.uploads).toHaveLength(1)
    const [up] = cloud.state.uploads
    expect(up.fields).toEqual({ product: 'CognitiveCanvas', storageType: 'cloud', description: 'Sprint 12 end', tags: '{"projectCount":2}' })
    expect(up.file!.filename).toMatch(BACKUP_FILE_NAME)
    expect(up.file!.contentType).toBe('application/octet-stream')
    expect(up.authorization).toBe(`Bearer ${muul.token}`)
    const zip = new BackupZip(up.file!.bytes)
    expect(zip.manifest.type).toBe('multi')
    expect([...zip.manifest.projectIds].sort()).toEqual([ids['Cloud A'], ids['Cloud C']].sort())
    expect(zip.json<{ name: string }>(`projects/${ids['Cloud C']}/project.json`).name).toBe('Cloud C')
    // The storage check runs before the upload, never after.
    const usage = muul.callsTo('GET', '/api/backups/usage')
    expect(usage.length).toBeGreaterThan(0)
    expect(muul.calls.indexOf(usage[usage.length - 1])).toBeLessThan(muul.calls.indexOf(muul.callsTo('POST', '/api/backups/upload')[0]))
    await expect(dc.dialog).toBeHidden()
  })

  test('REG-438 while uploading the view shows "Uploading..." with a percentage and locks its controls', { tag: '@P2' }, async ({ signedIn: app, cloud }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Progress Project'])
    const held = cloud.hold('POST', '/api/backups/upload')
    await openCloudBackup(app, 'Slow link')
    await dc.createBackup.click()
    await expect(dc.dialog.getByText('Uploading...')).toBeVisible()
    await expect(dc.dialog.getByText(/^(5\d|[6-9]\d|100)%$/)).toBeVisible()
    await expect(dc.createBackup).toBeDisabled()
    await expect(dc.cancel).toBeDisabled()
    await expect(dc.description).toBeDisabled()
    held.release()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
  })

  const FAILURES: Array<{ what: string; reply: MockReply | 'abort'; message: string }> = [
    { what: 'a 413 without a reason', reply: { status: 413, json: {} }, message: 'This backup is too large to upload. Deselect a project or two and try again.' },
    { what: 'a 413 with the server reason', reply: { status: 413, json: { message: 'Uploads are limited to 50 MB.' } }, message: 'Uploads are limited to 50 MB.' },
    { what: 'a 429', reply: { status: 429, json: {} }, message: 'Too many requests right now. Wait a moment and try again.' },
    { what: 'a 507', reply: { status: 507, json: {} }, message: 'Not enough cloud storage left. Delete an old backup and try again.' },
    // A 503 whose body carries another subsystem's words must not show them.
    { what: 'a 503', reply: { status: 503, json: { message: 'Invalid email or password' } }, message: UNAVAILABLE },
    { what: 'a 500', reply: { status: 500, json: {} }, message: UNAVAILABLE },
    { what: 'a plain 403', reply: { status: 403, json: {} }, message: SESSION_EXPIRED },
    { what: 'a 403 plan_required', reply: { status: 403, json: { code: 'plan_required', message: 'Cloud backup needs the Pro plan.' } }, message: 'Cloud backup needs the Pro plan.' },
    { what: 'a 403 quota_exceeded', reply: { status: 403, json: { code: 'quota_exceeded', message: 'Your 10 GB of cloud storage is full.' } }, message: 'Your 10 GB of cloud storage is full.' },
    { what: 'a 400 with a reason', reply: { status: 400, json: { message: 'Description is too long.' } }, message: 'Description is too long.' },
    { what: 'no answer at all', reply: 'abort', message: 'The upload could not reach the server. Check your connection and try again.' },
  ]

  test('REG-439 every upload failure reads in plain words, stays on the page to retry, and stores nothing', { tag: '@P1' }, async ({ signedIn: app, cloud, muul }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Failing Project'])
    await openCloudBackup(app, 'Will fail')
    for (const f of FAILURES) {
      if (f.reply === 'abort') await cloud.abortNext('POST', '/api/backups/upload')
      else cloud.failNext('POST', '/api/backups/upload', f.reply)
      await dc.createBackup.click()
      await app.toasts.expectShown(`Backup failed: ${f.message}`, 30_000)
      await expect(dc.errorBox, f.what).toHaveText(f.message)
      await expect(dc.createBackup).toBeEnabled()
    }
    expect(cloud.state.backups).toHaveLength(0)
    expect(muul.callsTo('POST', '/api/backups/upload')).toHaveLength(FAILURES.length)
  })

  test('REG-440 a 401 on upload refreshes the session once; when it is still refused the user is asked to sign in again', { tag: '@P2' }, async ({ signedIn: app, cloud, muul }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Expired Project'])
    cloud.failNext('POST', '/api/backups/upload', { status: 401, json: {} }, 2)
    await openCloudBackup(app, 'Expired')
    await dc.createBackup.click()
    await app.toasts.expectShown(`Backup failed: ${SESSION_EXPIRED}`, 30_000)
    expect(muul.callsTo('POST', '/api/backups/upload')).toHaveLength(2)
    expect(muul.callsTo('POST', '/api/iam/auth/refresh').length).toBeGreaterThanOrEqual(1)
    expect(cloud.state.backups).toHaveLength(0)
  })

  test('REG-441 a 401 that the refresh cures is retried and the backup lands', { tag: '@P2' }, async ({ signedIn: app, cloud, muul }) => {
    await createProjects(app, ['Refreshed Project'])
    cloud.failNext('POST', '/api/backups/upload', { status: 401, json: {} })
    await openCloudBackup(app, 'Refreshed')
    await app.dataCenter.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    expect(muul.callsTo('POST', '/api/backups/upload')).toHaveLength(2)
    expect(muul.callsTo('POST', '/api/iam/auth/refresh').length).toBeGreaterThanOrEqual(1)
    expect(cloud.state.backups).toHaveLength(1)
  })

  test('REG-442 changing the selection clears the last failure', { tag: '@P3' }, async ({ signedIn: app, cloud }) => {
    const dc = app.dataCenter
    await createProjects(app, ['One', 'Two'])
    cloud.failNext('POST', '/api/backups/upload', { status: 429, json: {} })
    await openCloudBackup(app, 'Retry me')
    await dc.createBackup.click()
    await expect(dc.errorBox).toBeVisible({ timeout: 30_000 })
    await dc.projectRow('Two').click()
    await expect(dc.errorBox).toHaveCount(0)
  })

  test('REG-443 a full cloud refuses before uploading, names the figures, and the sidebar meter turns red', { tag: '@P1' }, async ({ signedIn: app, cloud, muul }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Full Project'])
    cloud.state.usageOverride = TEN_GB
    await openCloudBackup(app, 'No room')
    await expect(dc.storageFigure).toHaveText('10.00 GB / 10.00 GB')
    await expect(dc.overQuota).toHaveText('Over your storage limit. Delete an old backup from Restore to free some space.')
    await dc.createBackup.click()
    await app.toasts.expectShown('Cloud storage is full — nothing was uploaded', 30_000)
    await expect(dc.errorBox).toHaveText('Cloud storage is full — 10240.0 MB used of 10240 MB. Delete an old backup from Restore to free some space.')
    // A Pro account has no bigger public plan to buy: no See plans.
    await expect(dc.dialog.getByRole('button', { name: 'See plans' })).toHaveCount(0)
    expect(muul.callsTo('POST', '/api/backups/upload')).toHaveLength(0)
  })

  test('REG-444 a backup bigger than the space left is refused before uploading', { tag: '@P2' }, async ({ signedIn: app, cloud, muul }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Almost Full'])
    cloud.state.usageOverride = TEN_GB - 100
    await openCloudBackup(app, 'Too big for the rest')
    await dc.createBackup.click()
    await app.toasts.expectShown('Not enough cloud storage — nothing was uploaded', 30_000)
    await expect(dc.errorBox).toHaveText(/^This backup is \d+\.\d MB and 0\.0 MB of cloud storage is left\. Delete an old backup from Restore to free some space\.$/)
    expect(muul.callsTo('POST', '/api/backups/upload')).toHaveLength(0)
  })

  test('REG-445 a usage figure that cannot be read does not block the backup', { tag: '@P3' }, async ({ signedIn: app, cloud }) => {
    await createProjects(app, ['Usage Down'])
    cloud.failNext('GET', '/api/backups/usage', { status: 500, json: {} }, 5)
    await openCloudBackup(app, 'Despite usage')
    await app.dataCenter.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    expect(cloud.state.backups).toHaveLength(1)
  })

  test('REG-446 a backup over the per-request limit of a server without chunking is refused before sending', { tag: '@P2' }, async ({ signedIn: app, cloud, muul }) => {
    await createProjects(app, ['Over Limit'])
    cloud.state.capabilities = { maxUploadBytes: 1024, chunkedUpload: false, maxChunkBytes: 0, applicationMaxBytes: 0 }
    await openCloudBackup(app, 'Too big for one request')
    await app.dataCenter.createBackup.click()
    const message = /^This backup is \d+\.\d MB — the limit is 0 MB per upload\. Back up fewer projects at a time\.$/
    await app.toasts.expectShown(/^Backup failed: This backup is \d+\.\d MB — the limit is 0 MB per upload\./, 30_000)
    await expect(app.dataCenter.errorBox).toHaveText(message)
    expect(muul.callsTo('POST', '/api/backups/upload')).toHaveLength(0)
  })

  test('REG-447 above the per-request limit a chunking server gets a hashed chunk session and the backup reassembles intact', { tag: '@P2' }, async ({ signedIn: app, page, cloud, muul }) => {
    await projectWithPdf(app, page, 'Chunked Project')
    cloud.state.capabilities = { maxUploadBytes: 1024, chunkedUpload: true, maxChunkBytes: 1024, applicationMaxBytes: 0 }
    await openCloudBackup(app, 'In pieces')
    await app.dataCenter.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 60_000)
    const [session] = [...cloud.state.sessions.values()]
    const begin = muul.callsTo('POST', '/api/backups/uploads')[0]
    expect(JSON.parse(begin.body!)).toEqual({ totalBytes: session.totalBytes, totalChunks: Math.ceil(session.totalBytes / 1024), chunkBytes: 1024 })
    expect(session.chunks.size).toBe(session.totalChunks)
    expect(session.totalChunks).toBeGreaterThan(1)
    const [up] = cloud.state.uploads
    expect(up.file).toBeUndefined()
    expect(up.fields).toEqual({
      product: 'CognitiveCanvas', storageType: 'cloud', description: 'In pieces', tags: '{"projectCount":1}',
      uploadId: session.id, fileName: expect.stringMatching(BACKUP_FILE_NAME), contentType: 'application/octet-stream',
    })
    const zip = new BackupZip(cloud.state.backups[0].bytes)
    expect(zip.documentFiles(zip.manifest.projectIds[0])).toHaveLength(1)
    expect(Buffer.from(zip.files[zip.documentFiles(zip.manifest.projectIds[0])[0]]).equals(FIND_PDF.payload().buffer)).toBe(true)
  })
})

test.describe('Cloud backup size warning', { tag: ['@regression', '@backup', '@cloud', '@api'] }, () => {
  test('REG-487 a selection over the per-request limit of a server without chunking is warned about while choosing, and the warning goes once it fits', { tag: '@P3' }, async ({ pdfOpen: app, page, project, cloud }) => {
    const dc = app.dataCenter
    cloud.state.capabilities = { maxUploadBytes: 100 * 1024, chunkedUpload: false, maxChunkBytes: 0, applicationMaxBytes: 0 }
    // A 312 KB MP3 makes the project bigger than the 100 KB limit.
    await app.canvas.place('audio', 0.65, 0.4)
    const dialog = page.getByRole('dialog', { name: 'New Audio Note' })
    await dialog.getByRole('tab', { name: 'Upload' }).click()
    await dialog.locator('input[type=file]').setInputFiles(BINARY.toneMp3)
    await dialog.getByPlaceholder('Audio name...').fill('Big tone')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })
    await expectStoreCount(page, 'mediaBlobs', 1)
    await app.header.home.click()
    await createProjects(app, ['Small One'])
    await openCloudBackup(app, 'Too much at once')
    const warning = dc.dialog.getByText(/^This selection is about 0\.3 MB — over the 0 MB limit per upload\. Deselect a project, or back up in two goes\.$/)
    await expect(warning).toBeVisible()
    await dc.projectRow(project.name).click()
    await expect(warning).toHaveCount(0)
    await expect(dc.createBackup).toHaveText('Create Backup (1)')
  })
})

test.describe('Cloud backup integrity', { tag: ['@regression', '@backup', '@cloud', '@api'] }, () => {
  test('REG-448 a backup the server stored short is refused with the "did not arrive intact" message', { tag: '@P2' }, async ({ signedIn: app, cloud }) => {
    knownDefect('DEF-402')
    const dc = app.dataCenter
    await createProjects(app, ['Truncated Project'])
    cloud.state.storedSizeOverride = 10
    await openCloudBackup(app, 'Cut short')
    const toast = app.toasts.withText(/^Backup failed: /).first().textContent({ timeout: 30_000 })
    await dc.createBackup.click()
    await expect(dc.errorBox).toBeVisible({ timeout: 30_000 })
    const sent = cloud.state.uploads[0].file!.bytes.length
    const expected = `The backup did not arrive intact: the server stored 0.0 MB of ${(sent / (1024 * 1024)).toFixed(1)} MB. Nothing was recorded — please try again.`
    expect(await toast).toBe(`Backup failed: ${expected}`)
    await expect(dc.errorBox).toHaveText(expected)
  })
})

test.describe('Cloud restore list', { tag: ['@regression', '@backup', '@cloud', '@api'] }, () => {
  test('REG-449 the list shows version, note, date, size and project count, hides GitHub, manifest and roster records, and preselects the first', { tag: '@P2' }, async ({ signedIn: app, cloud }) => {
    const dc = app.dataCenter
    const bytes = Buffer.alloc(16)
    cloud.seed({ bytes, description: 'Term 1', tags: '{"projectCount":"3"}', version: 4, fileSize: 2.5 * 1024 * 1024, createdAtUtc: '2026-10-01T09:30:00Z' })
    cloud.seed({ bytes, description: null, version: 5, fileSize: 1024 * 1024, createdAtUtc: '2026-10-02T14:05:00Z' })
    cloud.seed({ bytes, description: 'From GitHub', storageType: 'github' })
    cloud.seed({ bytes, description: 'Cognitive Canvas manifest', tags: 'cc-manifest', fileName: 'cc-manifest.json', contentType: 'application/json' })
    cloud.seed({ bytes, description: 'Cognitive Canvas team roster', tags: 'cc-roster', fileName: 'cc-roster.json', contentType: 'application/json' })
    await openCloudRestore(app)
    await expect(dc.dialog.getByText('Select a recent backup from your account to restore. Existing projects will be overwritten.')).toBeVisible()
    await expect(dc.cloudRows).toHaveCount(2)
    await expect(dc.cloudRows.nth(0)).toHaveText('v4Term 1Oct 1 09:30 AM•2.5 MB•3 proj')
    await expect(dc.cloudRows.nth(1)).toHaveText('v5Manual BackupOct 2 02:05 PM•1.0 MB')
    await expect(dc.cloudRows.nth(0).locator('input')).toBeChecked()
    await dc.cloudRows.nth(1).click()
    await expect(dc.cloudRows.nth(1).locator('input')).toBeChecked()
    await expect(dc.restoreNow).toBeEnabled()
  })

  test('REG-450 an empty account says so; a list the server cannot give is reported in words (unavailable for a 5xx, the fallback for a bare 404)', { tag: '@P2' }, async ({ signedIn: app, cloud }) => {
    const dc = app.dataCenter
    await openCloudRestore(app)
    await expect(dc.dialog.getByText('No backups found in Muul Cloud.')).toBeVisible()
    await expect(dc.restoreNow).toBeDisabled()
    await expect(dc.errorBox).toHaveCount(0)

    cloud.failNext('GET', '/api/backups', { status: 500, json: {} })
    await dc.sidebarSource('Local').click()
    await dc.sidebarSource('Cloud').click()
    await expect(dc.errorBox).toHaveText(UNAVAILABLE)
    cloud.failNext('GET', '/api/backups', { status: 404, json: {} })
    await dc.sidebarSource('Local').click()
    await dc.sidebarSource('Cloud').click()
    await expect(dc.errorBox).toHaveText('Failed to load backups')
  })

  test('REG-451 a long history is read page by page with the cursor, so older backups are listed too', { tag: '@P3' }, async ({ signedIn: app, cloud, muul }) => {
    cloud.state.pageSize = 2
    for (const d of ['Page one A', 'Page one B', 'Page two A']) cloud.seed({ bytes: Buffer.alloc(8), description: d })
    await openCloudRestore(app)
    await expect(app.dataCenter.cloudRows).toHaveCount(3)
    await expect(app.dataCenter.cloudRow('Page two A')).toBeVisible()
    const lists = muul.callsTo('GET', '/api/backups').map((c) => c.url.searchParams)
    expect(lists.some((q) => q.get('cursor') === '2' && q.get('product') === 'CognitiveCanvas' && q.get('limit') === '100')).toBe(true)
  })

  test('REG-452 cancelling the restore confirmation downloads nothing; confirming replaces the project and keeps the others', { tag: '@P1' }, async ({ signedIn: app, page, cloud }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Restored One', 'Untouched Two'])
    const ids = await projectIds(page)
    await openCloudBackup(app, 'Only one')
    await dc.projectRow('Untouched Two').click()
    await dc.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    // Change the backed-up project after the backup: the restore must bring its old name back.
    await app.home.renameProject('Restored One', 'Renamed Since')
    await openCloudRestore(app)
    const dismissed = answerNextDialog(page, false)
    await dc.restoreNow.click()
    await dismissed
    expect(cloud.state.downloads).toEqual([])
    await expect(dc.restoreNow).toBeEnabled()

    const held = cloud.hold('GET', /\/download$/)
    const accepted = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreNow.click()
    await accepted
    await expect(page.getByText('Downloading from the cloud…')).toBeVisible()
    held.release()
    await loaded
    await app.home.reach()
    const after = await readStore<{ id: string; name: string }>(page, 'projects')
    expect(after.map((p) => [p.id, p.name]).sort()).toEqual([[ids['Restored One'], 'Restored One'], [ids['Untouched Two'], 'Untouched Two']].sort())
  })

  test('REG-453 a download that fails reports why and leaves the library and the loader as they were', { tag: '@P2' }, async ({ signedIn: app, page, cloud, ui }) => {
    const dc = app.dataCenter
    await createProjects(app, ['Kept As Is'])
    cloud.seed({ bytes: Buffer.alloc(64), description: 'Broken download' })
    const before = await readStore(page, 'projects')
    cloud.failNext('GET', /\/download$/, { status: 503, json: {} })
    await openCloudRestore(app)
    const accepted = answerNextDialog(page, true)
    await dc.restoreNow.click()
    await accepted
    await app.toasts.expectShown(`Restore failed: ${UNAVAILABLE}`, 30_000)
    await expect(dc.errorBox).toHaveText(UNAVAILABLE)
    await expect(ui.overlay.title).toHaveCount(0)
    expect(await readStore(page, 'projects')).toEqual(before)
  })

  test('REG-454 cancelling a delete keeps the backup; a failed delete says so and keeps the row', { tag: '@P2' }, async ({ signedIn: app, page, cloud, muul }) => {
    const dc = app.dataCenter
    const item = cloud.seed({ bytes: Buffer.alloc(64), description: 'Keep me' })
    await openCloudRestore(app)
    const dismissed = answerNextDialog(page, false)
    await dc.deleteBackup(dc.cloudRow('Keep me')).click()
    await dismissed
    expect(muul.callsTo('DELETE', `/api/backups/${item.id}`)).toHaveLength(0)
    await expect(dc.cloudRow('Keep me')).toBeVisible()

    cloud.failNext('DELETE', `/api/backups/${item.id}`, { status: 404, json: {} })
    const accepted = answerNextDialog(page, true)
    await dc.deleteBackup(dc.cloudRow('Keep me')).click()
    await accepted
    await expect(dc.errorBox).toHaveText('Failed to delete backup')
    await expect(dc.cloudRow('Keep me')).toBeVisible()
    expect(cloud.state.backups).toHaveLength(1)
  })

  test('REG-455 a backup made on another device that holds a project missing here adds it beside the local ones', { tag: '@P2' }, async ({ signedIn: app, page, cloud }) => {
    // The "other device": a backup ZIP made by this app for a project that is then removed here.
    await createProjects(app, ['From Elsewhere'])
    await openCloudBackup(app, 'Other device')
    await app.dataCenter.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    const elsewhereId = (await projectIds(page))['From Elsewhere']
    await app.home.deleteProject('From Elsewhere')
    await createProjects(app, ['Local Only'])
    const localId = (await projectIds(page))['Local Only']
    await openCloudRestore(app)
    const accepted = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await app.dataCenter.restoreNow.click()
    await accepted
    await loaded
    expect(cloud.state.downloads).toHaveLength(1)
    await app.home.reach()
    const after = await readStore<{ id: string; name: string }>(page, 'projects')
    expect(after.map((p) => [p.id, p.name]).sort()).toEqual([[elsewhereId, 'From Elsewhere'], [localId, 'Local Only']].sort())
  })
})

test.describe('Cloud restore for a lapsed plan', { tag: ['@regression', '@backup', '@cloud', '@api'] }, () => {
  test.use({ muulPlan: 'free' })
  test('REG-456 a Free account can still restore and delete the backups it already has', { tag: '@P2' }, async ({ signedIn: app, page, cloud }) => {
    const dc = app.dataCenter
    // A real backup made while the account was on Pro.
    const seeded = cloud.seed({ bytes: cc2BackupZip({ projectName: 'Pro Days Project', description: 'made on Pro', docName: 'Pro Days Notes', marker: 'PRODAYS' }), description: 'From my Pro days' })
    await openCloudRestore(app)
    await expect(dc.cloudRow('From my Pro days')).toBeVisible()
    await expect(dc.restoreNow).toBeEnabled()
    // Restoring it works on Free: the project and its document come back.
    const confirmed = answerNextDialog(page, true)
    const loaded = page.waitForEvent('load', { timeout: 30_000 })
    await dc.restoreNow.click()
    expect(await confirmed).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await loaded
    expect(cloud.state.downloads).toEqual([seeded.id])
    await app.home.reach()
    await expect(app.home.card('Pro Days Project')).toBeVisible()
    expect((await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual(['Pro Days Project'])
    expect((await readStore<{ name: string; pageCount: number }>(page, 'documents')).map((d) => [d.name, d.pageCount])).toEqual([['Pro Days Notes', 1]])

    // And deleting it works too.
    await openCloudRestore(app)
    const accepted = answerNextDialog(page, true)
    await dc.deleteBackup(dc.cloudRow('From my Pro days')).click()
    await accepted
    await expect(dc.dialog.getByText('No backups found in Muul Cloud.')).toBeVisible()
    expect(cloud.state.backups).toHaveLength(0)
  })
})
