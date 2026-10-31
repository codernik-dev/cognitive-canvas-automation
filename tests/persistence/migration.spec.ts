/**
 * Data migration and version safety (src/services/db/connection.ts upgrade(),
 * binaryIndex.ts, recordTombstones.ts, importPdf.ts backfillTextIndex,
 * authService.ts legacy PIN upgrade, PdfViewer.tsx re-read for word boxes).
 *
 * The subject is what an OLDER (or newer) build left on disk, so each test
 * lays the database out exactly as that build did: the rows come from a real
 * session of this build (so every field is one the app really writes), then
 * the database is rebuilt at the older version with that version's stores
 * and indexes (helpers/platformDb.ts SCHEMA), and fields older builds did not
 * write are taken out. Then the app opens it, and the test proves through the
 * UI and the raw stores that nothing was lost, changed or downgraded.
 *
 * REG-615..617 (auth.spec.ts) already cover the boot screen's words for a
 * newer database and a blocking tab; PST-004 here is the data-safety side.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore } from '../../helpers/idb.js'
import {
  SCHEMA, BUILD_DB_VERSION, blankOnAppOrigin, dumpDb, seedDb, snapshotAll, flattenRows, expectRowsKept,
  legacyPinHash, listedDbVersion, keyed, type Rows, type Schema,
} from '../../helpers/platformDb.js'
import { buildLegacyContent, type LegacyContent } from '../../helpers/platformContent.js'
import { exportAllLocal } from '../../workflows/backup.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { BootScreen, CanvasInk } from '../../pages/PlatformScreens.js'
import { FIND_PDF } from '../../data/files.js'
import { ENV } from '../../config/env.js'
import { oneWordScan } from '../../data/documents-files.js'
import { searchRows, currentMatchBox, documentByName } from '../../helpers/documents.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page } from '@playwright/test'

const PROJECT = 'Legacy Project'
test.use({ projectName: PROJECT })

/**
 * Records the stamping layer (connection.ts withUpdatedAt) only began to
 * timestamp later: older builds wrote them without `updatedAt`.
 */
const UNSTAMPED_BEFORE = ['highlights', 'itemLinks', 'areaLinks', 'canvasStrokes', 'highlightStrokeLinks', 'mediaBlobs', 'textHighlights', 'textAreaLinks', 'calendarEvents', 'searchText']

/**
 * Fields the app itself rewrites when it signs in and opens a project, so a
 * migration is not expected to keep them: the sign-in stamps the user's
 * lastLoginAt (and upgrades a legacy PIN hash, asserted on its own); opening
 * the project and its document stamps the project's and document's open/read
 * position and their updatedAt.
 */
const REWRITTEN_ON_OPEN: Record<string, string[]> = {
  users: ['lastLoginAt', 'pinHash'],
  projects: ['lastOpenedAt', 'updatedAt'],
  documents: ['lastReadPage', 'lastReadScrollY', 'lastOpenedAt', 'updatedAt'],
}

/** The dump of this build, reshaped the way a build at `version` left it. */
function asWrittenBy(dump: Rows, schema: Schema, { legacyPin }: { legacyPin: boolean }): Rows {
  const out: Rows = {}
  for (const store of Object.keys(schema)) {
    out[store] = (dump[store] ?? []).map((row) => {
      const r = { ...row }
      if (UNSTAMPED_BEFORE.includes(store)) delete r.updatedAt
      if (store === 'users' && legacyPin) r.pinHash = legacyPinHash(ENV.testPin)
      return r
    })
  }
  return out
}

/** Make the legacy content with this build, dump it, and lay it out again at `version`. */
async function seedOlderLibrary(app: CognitiveCanvas, page: Page, version: number, schema: Schema, extra: Rows = {}) {
  const built = await buildLegacyContent(app, page, PROJECT)
  const dump = await dumpDb(page)
  expect(dump.version).toBe(BUILD_DB_VERSION)
  const rows = asWrittenBy(dump.rows, schema, { legacyPin: false })
  for (const [store, more] of Object.entries(extra)) rows[store] = [...(rows[store] ?? []), ...more]
  await blankOnAppOrigin(page)
  await seedDb(page, version, schema, rows)
  // A new browser session: the unlock lives in sessionStorage.
  await page.evaluate(() => sessionStorage.clear())
  expect(await listedDbVersion(page)).toBe(version)
  return { built, rows }
}

/** Unlock, open the project and its PDF, and check every kind of legacy record on screen. */
async function expectLegacyOnScreen(app: CognitiveCanvas, page: Page, built: LegacyContent) {
  await app.open()
  await app.login.unlockWith()
  await app.home.reach()
  await expect(app.home.card(PROJECT)).toBeVisible()
  await app.home.openProject(PROJECT)
  await app.documents.openDocument(FIND_PDF.displayName)
  await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
  for (const [id, words] of Object.entries(built.notes)) await expect(app.canvas.item(id)).toContainText(words)
  await expect(app.canvas.itemLinks).toHaveCount(1)
  await expect(app.viewer.highlights).toHaveCount(1)
  await expect(app.viewer.areaLinks.first()).toBeAttached()
  await expect(new CanvasInk(page).paths).toHaveCount(1)
  const image = (await readStore<{ id: string; type: string }>(page, 'workspaceItems')).find((i) => i.type === 'image')!
  await expect(app.canvas.item(image.id).locator('img')).toBeVisible()
}

test.describe('Data migration', { tag: ['@regression', '@persistence'] }, () => {

  test('PST-005 a database left by the v12 build opens in this build with every project, document, note, link, highlight, stroke and image intact', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    // A long journey: build content, rebuild the database, reopen. The budget is for its length.
    test.setTimeout(180_000)
    const { built, rows } = await seedOlderLibrary(app, page, 12, SCHEMA.v12)
    expect(rows.recordTombstones, 'the v12 store carries the deleted note\'s tombstone').toHaveLength(1)

    await expectLegacyOnScreen(app, page, built)

    const after = await snapshotAll(page)
    expect(after.version).toBe(BUILD_DB_VERSION)
    // Stores and indexes are exactly this build's: the v12 ones kept, binaryIndex added.
    expect(Object.keys(after.schema).sort()).toEqual(Object.keys(SCHEMA.v13).sort())
    for (const [name, spec] of Object.entries(SCHEMA.v13)) {
      expect(after.schema[name].keyPath, `${name} key path`).toBe(spec.keyPath)
      expect(after.schema[name].indexes.map((i) => `${i.name}:${String(i.keyPath)}`).sort(), `${name} indexes`).toEqual(spec.indexes.map((i) => `${i.name}:${String(i.keyPath)}`).sort())
    }
    // Every seeded row, field for field (binary fields by length and SHA-256).
    expectRowsKept(after, flattenRows(rows), SCHEMA.v12, REWRITTEN_ON_OPEN)
  })

  test('PST-006 a database left by the v11 build (before record tombstones) gains the empty tombstone store, keeps every record, and a delete afterwards is recorded there', { tag: '@P1' }, async ({ pdfOpen: app, page }) => {
    // A long journey: build content, rebuild the database, reopen. The budget is for its length.
    test.setTimeout(180_000)
    const { built, rows } = await seedOlderLibrary(app, page, 11, SCHEMA.v11)
    expect(rows.recordTombstones).toBeUndefined()

    await expectLegacyOnScreen(app, page, built)
    const after = await snapshotAll(page)
    expect(after.version).toBe(BUILD_DB_VERSION)
    expect(after.rows.recordTombstones).toEqual([])
    expect(after.schema.recordTombstones.indexes.map((i) => i.name)).toEqual(['by-project'])
    expectRowsKept(after, flattenRows(rows), SCHEMA.v11, REWRITTEN_ON_OPEN)

    // The new store works: deleting the second note records the note, and the link that went with it.
    // (Whether the link's record names its project is PST-021's subject.)
    const [, second] = Object.keys(built.notes)
    const [link] = rows.itemLinks
    await app.canvas.select(second)
    await page.keyboard.press('Delete')
    await expect(app.canvas.item(second)).toHaveCount(0)
    await expect.poll(async () => (await readStore<{ id: string; store: string; recordId: string }>(page, 'recordTombstones')).map(({ id, store, recordId }) => ({ id, store, recordId })).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([
        { id: `itemLinks:${String(link.id)}`, store: 'itemLinks', recordId: link.id },
        { id: `workspaceItems:${second}`, store: 'workspaceItems', recordId: second },
      ])
    const noteStone = (await readStore<{ id: string; projectId: string; deletedAt: number }>(page, 'recordTombstones')).find((t) => t.id === `workspaceItems:${second}`)!
    expect(noteStone.projectId).toBe(built.projectId)
    expect(noteStone.deletedAt).toBeGreaterThan(0)
  })

  test('PST-007 after the upgrade every existing PDF and image is indexed in the background, and a backup made then carries the same bytes', { tag: '@P1' }, async ({ pdfOpen: app, page }, testInfo) => {
    // A long journey: build content, rebuild the database, reopen. The budget is for its length.
    test.setTimeout(180_000)
    const { built, rows } = await seedOlderLibrary(app, page, 12, SCHEMA.v12)
    expect(rows.binaryIndex).toBeUndefined()
    await expectLegacyOnScreen(app, page, built)

    // binaryIndex.ts starts the backfill 15 s after boot and indexes one file every 40 ms.
    const files = [
      ...rows.documents.map((d) => ({ key: `doc:${String(d.id)}`, kind: 'doc', record: d })),
      ...rows.mediaBlobs.map((b) => ({ key: `blob:${String(b.id)}`, kind: 'blob', record: b })),
    ]
    expect(files.length).toBe(2)
    await expect.poll(async () => (await readStore<{ key: string }>(page, 'binaryIndex')).map((r) => r.key).sort(), { timeout: 60_000, message: 'binaryIndex backfill' })
      .toEqual(files.map((f) => f.key).sort())
    const index = keyed((await snapshotAll(page)).rows.binaryIndex, 'key')
    const seededFlat = flattenRows(rows)
    for (const f of files) {
      const row = index[f.key]
      const flatRecord = (f.kind === 'doc' ? seededFlat.documents : seededFlat.mediaBlobs).find((r) => r.id === f.record.id)!
      const { data, ...rest } = flatRecord as Record<string, unknown> & { data: { __bytes: number } }
      expect(row.kind).toBe(f.kind)
      expect(row.id).toBe(f.record.id)
      expect(row.projectId).toBe(built.projectId)
      expect(row.size, `${f.key} size is the stored file's length`).toBe(data.__bytes)
      // Indexed from the record as it is on disk now (a document's reading position may have moved since).
      const described = { ...(row.row as Record<string, unknown>) }
      for (const k of REWRITTEN_ON_OPEN.documents) { delete described[k]; delete rest[k] }
      expect(described, `${f.key} describes the record minus its bytes`).toEqual(rest)
    }

    // A backup taken now reads the files through the new index: same bytes as seeded.
    await app.header.home.click()
    const { file } = await exportAllLocal(app, testInfo)
    const zip = BackupZip.fromFile(file)
    const docBytes = zip.files[`documents/${built.documentId}/file.pdf`]
    expect(docBytes, 'the PDF is in the backup').toBeTruthy()
    expect(Buffer.from(docBytes).equals(Buffer.from(String((rows.documents[0].data as { __b64: string }).__b64), 'base64'))).toBe(true)
    const blob = rows.mediaBlobs[0]
    const media = Object.entries(zip.files).find(([n]) => n.startsWith(`media/${String(blob.id)}/file.`))
    expect(media, 'the image is in the backup').toBeTruthy()
    expect(Buffer.from(media![1]).equals(Buffer.from((blob.data as { __b64: string }).__b64, 'base64'))).toBe(true)
  })

  test('PST-008 a database from before law mode, still holding the retired bookmark stores, opens with every record kept; only the retired stores are dropped', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    // A long journey: build content, rebuild the database, reopen. The budget is for its length.
    test.setTimeout(180_000)
    const retired = {
      bookmarks: [{ id: 'bm-legacy-1', projectId: 'retired-feature', documentId: 'retired-doc', pageNumber: 2, label: 'Old bookmark', createdAt: 1_700_000_000_000 }],
      textBookmarks: [{ id: 'tbm-legacy-1', projectId: 'retired-feature', documentId: 'retired-doc', offset: 10, createdAt: 1_700_000_000_000 }],
    }
    const { built, rows } = await seedOlderLibrary(app, page, 6, SCHEMA.v6, retired)
    await expectLegacyOnScreen(app, page, built)

    const after = await snapshotAll(page)
    expect(after.version).toBe(BUILD_DB_VERSION)
    expect(Object.keys(after.schema).sort()).toEqual(Object.keys(SCHEMA.v13).sort())
    for (const created of ['lawEvents', 'recordTombstones']) expect(after.rows[created], `${created} created empty`).toEqual([])
    const kept = Object.fromEntries(Object.entries(flattenRows(rows)).filter(([s]) => !(s in retired)))
    expectRowsKept(after, kept, SCHEMA.v6, REWRITTEN_ON_OPEN)
  })
})

test.describe('Older data formats', { tag: ['@regression', '@persistence'] }, () => {
  test('PST-009 a PIN saved by an older build (plain SHA-256) still unlocks, wrong PINs are still refused, and the stored hash is upgraded to the salted form on that sign-in', { tag: '@P1' }, async ({ signedIn: app, page }) => {
    await app.home.createProject(PROJECT)
    await app.documents.expectOpen(PROJECT)
    const dump = await dumpDb(page)
    const [user] = dump.rows.users
    const rows = asWrittenBy(dump.rows, SCHEMA.v12, { legacyPin: true })
    await blankOnAppOrigin(page)
    await seedDb(page, 12, SCHEMA.v12, rows)
    await page.evaluate(() => sessionStorage.clear())

    await app.open()
    await app.login.expectVisible()
    await app.login.failWith('000000')
    await expect(app.login.message).toContainText('Incorrect PIN')
    await expect(app.login.prompt).toBeVisible()
    // Still the legacy hash: a refused PIN changes nothing.
    expect((await readStore<{ pinHash: string }>(page, 'users'))[0].pinHash).toBe(legacyPinHash(ENV.testPin))
    await app.login.unlockWith()
    await app.home.reach()
    await expect(app.home.card(PROJECT)).toBeVisible()
    const [after] = await readStore<{ id: string; pinHash: string }>(page, 'users')
    expect(after.id).toBe(user.id)
    expect(after.pinHash).toMatch(/^pbkdf2\$sha256\$200000\$[^$]+\$[^$]+$/)
    // The upgraded hash unlocks the next session too.
    await page.evaluate(() => sessionStorage.clear())
    await app.reload()
    await app.login.unlockWith()
    await expect(app.home.card(PROJECT)).toBeVisible()
  })

  test('PST-010 a document stored without its text index (an import cut short, or an older build) is indexed when its project is next opened', { tag: '@P2' }, async ({ pdfOpen: app, page, project }) => {
    await expect.poll(async () => (await readStore(page, 'searchText')).length, { timeout: 30_000 }).toBe(FIND_PDF.pageCount)
    const expected = (await readStore<{ pageNumber: number; text: string }>(page, 'searchText')).map((r) => `${r.pageNumber}:${r.text}`).sort()
    const dump = await dumpDb(page)
    const rows: Rows = { ...dump.rows, searchText: [], binaryIndex: [] }
    rows.documents = rows.documents.map(({ textIndexedAt: _t, ...d }) => d)
    await blankOnAppOrigin(page)
    await seedDb(page, BUILD_DB_VERSION, SCHEMA.v13, rows)

    await app.open()
    await app.home.reach()
    await app.home.openProject(project.name)
    // DocumentListView starts the backfill 3 s after the project opens.
    await expect.poll(async () => (await readStore<{ pageNumber: number; text: string }>(page, 'searchText')).map((r) => `${r.pageNumber}:${r.text}`).sort(), { timeout: 30_000 })
      .toEqual(expected)
    const doc = await documentByName(page, FIND_PDF.displayName)
    expect(doc.textIndexedAt, 'the document is stamped as indexed').toBeGreaterThan(0)
    // And only once: reopening the project adds no second set.
    await app.documents.backToProjects.click()
    await app.home.openProject(project.name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    expect(await readStore(page, 'searchText')).toHaveLength(FIND_PDF.pageCount)
  })

  test('PST-011 OCR text saved before word boxes existed is found at once, then the page is re-read so the match sits on the word', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    // One real OCR pass (about 12 s a page on an idle machine), under load allowed several times that.
    test.setTimeout(240_000)
    const scan = await oneWordScan(page, 'OCRLEGACY', 'automation-legacy-scan')
    await app.home.upload(scan.payload)
    await app.documents.openDocument(scan.displayName)
    await app.viewer.expectDocumentOpen(scan.displayName, 1)
    const doc = await documentByName(page, scan.displayName)
    expect(await searchRows(page, doc.id)).toEqual([])

    // What OCR wrote before 2026-10-25: the page's words, no boxes.
    const dump = await dumpDb(page)
    const legacyRow = { id: 'legacy-ocr-row', documentId: doc.id, projectId: doc.projectId, pageNumber: 1, text: 'OCRLEGACY' }
    await blankOnAppOrigin(page)
    await seedDb(page, BUILD_DB_VERSION, SCHEMA.v13, { ...dump.rows, searchText: [legacyRow] })
    await app.open()
    await app.home.reach()
    await app.home.openProject('New Project 1')
    await app.documents.openDocument(scan.displayName)
    await app.viewer.expectDocumentOpen(scan.displayName, 1)

    await app.viewer.tool('find').click()
    await app.find.search('ocrlegacy')
    await app.find.expectCount(1, 1)
    // Then the boxes arrive: the row gains the word with its box, and the match moves onto it.
    await expect.poll(async () => (await searchRows(page, doc.id))[0]?.words?.map((w) => w[0].toUpperCase()) ?? [], { timeout: 180_000, intervals: [1000] }).toContain('OCRLEGACY')
    const rows = await searchRows(page, doc.id)
    expect(rows).toHaveLength(1)
    const drawn = scan.boxes[0][0]
    await expect.poll(async () => Math.abs((await currentMatchBox(page)).x - drawn.x), { timeout: 20_000 }).toBeLessThanOrEqual(0.02)
    const match = await currentMatchBox(page)
    expect(Math.abs(match.width - drawn.width)).toBeLessThanOrEqual(0.02)
  })
})

test.describe('Newer data', { tag: ['@regression', '@persistence'] }, () => {
  // The loading screen handles the refusal; other boot-time readers reject with the
  // same DbOpenError unhandled (the storage meter among them), as REG-615 records.
  test.use({ allowedPageErrors: [/^DbOpenError: Your data on this device was saved by a newer version/] })

  test('PST-004 data saved by a newer build is never deleted, overwritten or downgraded by this older build, whatever the user presses', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, context }) => {
    test.setTimeout(180_000)
    // A newer build's library: everything this build writes, plus a store this build has never heard of.
    const future = {
      futureNotes: [{ id: 'future-1', projectId: 'p-future', body: 'Written by build 14', createdAt: 1_800_000_000_000 }],
    }
    const futureSchema: Schema = { ...SCHEMA.v13, futureNotes: { keyPath: 'id', indexes: [{ name: 'by-project', keyPath: 'projectId' }] } }
    await buildLegacyContent(app, page, PROJECT)
    const dump = await dumpDb(page)
    await blankOnAppOrigin(page)
    await seedDb(page, BUILD_DB_VERSION + 1, futureSchema, { ...dump.rows, ...future })
    await page.evaluate(() => sessionStorage.clear())
    const before = await snapshotAll(page)
    expect(before.version).toBe(BUILD_DB_VERSION + 1)

    const boot = new BootScreen(page)
    await app.open()
    await expect(boot.failed).toBeVisible({ timeout: 30_000 })
    await expect(boot.newerData).toBeVisible()
    await expect(app.pinSetup.heading).toBeHidden()
    await boot.tryAgain.click()
    await expect(boot.failed).toBeVisible({ timeout: 30_000 })
    await Promise.all([page.waitForEvent('load'), boot.reload.click()])
    await expect(boot.failed).toBeVisible({ timeout: 30_000 })
    // A second tab of the same build does no better, and no worse.
    const second = await context.newPage()
    await second.goto('/')
    await expect(new BootScreen(second).failed).toBeVisible({ timeout: 30_000 })
    await expect(second.getByRole('heading', { name: 'Welcome', level: 1 })).toBeHidden()
    await second.close()

    await blankOnAppOrigin(page)
    const after = await snapshotAll(page)
    expect(after.version, 'not downgraded').toBe(BUILD_DB_VERSION + 1)
    expect(after.schema, 'no store dropped or added').toEqual(before.schema)
    expect(after.rows, 'no row deleted, added or changed').toEqual(before.rows)
  })
})
