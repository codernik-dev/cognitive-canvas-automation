/**
 * Backup fidelity of the text index (searchText).
 *
 * storageScan.ts keeps `searchText` out of every backup "because it is
 * regenerable (text is re-extracted from PDFs on restore)". These tests
 * check that promise end to end, through Local export, project deletion and
 * restore (the same journey as REG-488):
 *
 *   - a PDF with a text layer: does Find still work, and is the index rebuilt?
 *   - a scanned page read by the real OCR tool: is the text OCR read still
 *     there, so Find finds it at once, as it did before the backup?
 *
 * Text OCR read from a scanned page cannot be "re-extracted from the PDF": the
 * PDF holds only a picture. So the second case is the one that matters.
 */
import { test, expect } from '../../fixtures/documents.js'
import { readStore } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { exportAllLocal, restoreAndReload } from '../../workflows/backup.js'
import { searchKey, type Row } from '../../helpers/backupState.js'
import { oneWordScan, type ScannedFixture } from '../../data/documents-files.js'
import { OCR_PAGE_TIMEOUT, type OcrDialog, type OcrToast } from '../../components/DocumentsOcr.js'
import { documentByName, recordOcrDecisions, searchRows, wordsOf, type DocRow } from '../../helpers/documents.js'
import { FIND_PDF } from '../../data/files.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page, TestInfo } from '@playwright/test'

const OCR_WORD = 'OCRKEEPSAKE'

/** Back up everything, delete the project, restore the backup; ends on Home after the restore's reload. */
async function roundTrip(app: CognitiveCanvas, page: Page, testInfo: TestInfo, projectName: string) {
  await app.header.home.click()
  const { file } = await exportAllLocal(app, testInfo)
  await app.home.deleteProject(projectName)
  await expect(app.home.card(projectName)).toHaveCount(0)
  expect(await readStore(page, 'searchText')).toEqual([])
  await restoreAndReload(app, page, file)
  await app.home.reach()
  await expect(app.home.card(projectName)).toBeVisible()
  return BackupZip.fromFile(file)
}

/** Upload a one-page scan from Home (no background OCR there), read it with the OCR tool, and prove Find finds the word. */
async function scanReadByOcr(app: CognitiveCanvas, page: Page, ocrDialog: OcrDialog, ocrToast: OcrToast): Promise<{ scan: ScannedFixture; doc: DocRow }> {
  const scan = await oneWordScan(page, OCR_WORD, 'automation-keepsake-scan')
  await app.home.upload(scan.payload)
  await app.documents.openDocument(scan.displayName)
  await app.viewer.expectDocumentOpen(scan.displayName, 1)
  const doc = await documentByName(page, scan.displayName)
  await app.viewer.tool('ocr').click()
  await ocrDialog.expectOpen()
  await ocrDialog.start.click()
  await ocrToast.expectComplete(1)
  const rows = await searchRows(page, doc.id)
  expect(rows.map((r) => r.pageNumber)).toEqual([1])
  expect(wordsOf(rows[0].text)).toContain(OCR_WORD)
  await app.viewer.tool('find').click()
  await app.find.search(OCR_WORD.toLowerCase())
  await app.find.expectCount(1, 1)
  await app.find.close.click()
  return { scan, doc }
}

/** Open the restored scan and search for the OCR'd word. */
async function findInRestoredScan(app: CognitiveCanvas, scan: ScannedFixture) {
  await app.home.openProject('New Project 1')
  await app.documents.openDocument(scan.displayName)
  await app.viewer.expectDocumentOpen(scan.displayName, 1)
  await app.viewer.tool('find').click()
  await app.find.search(OCR_WORD.toLowerCase())
}

test.describe('Backup and the text index', { tag: ['@regression', '@persistence'] }, () => {
  test('PST-012 after a backup, delete and restore, Find still finds the words of a PDF with a text layer', { tag: '@P1' }, async ({ pdfOpen: app, page, project }, testInfo) => {
    test.setTimeout(150_000)
    await expect.poll(async () => (await readStore(page, 'searchText')).length, { timeout: 30_000 }).toBe(FIND_PDF.pageCount)
    await roundTrip(app, page, testInfo, project.name)
    await app.home.openProject(project.name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.viewer.tool('find').click()
    await app.find.search('ZULUFOUR')
    await app.find.expectCount(1, 1)
    await app.find.search('canvas')
    await app.find.expectCount(1, FIND_PDF.canvasMatches)
  })

  test('PST-013 the text index of a restored PDF is rebuilt, as the backup design promises', { tag: '@P3' }, async ({ pdfOpen: app, page, project }, testInfo) => {
    knownDefect('DEF-901')
    test.setTimeout(150_000)
    await expect.poll(async () => (await readStore(page, 'searchText')).length, { timeout: 30_000 }).toBe(FIND_PDF.pageCount)
    const before = searchKey(await readStore<Row>(page, 'searchText'))
    await roundTrip(app, page, testInfo, project.name)
    await app.home.openProject(project.name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    // backfillTextIndex runs 3 s after a project opens; give it ample time to land.
    await expect.poll(async () => searchKey(await readStore<Row>(page, 'searchText')), { timeout: 30_000, message: 'restored PDF text index' }).toEqual(before)
  })
})

test.describe('Backup and OCR text', { tag: ['@regression', '@persistence', '@ocr'] }, () => {
  // One OCR pass (about 12 s a page idle, several times that under load) plus a backup round trip.
  test.beforeEach(() => test.setTimeout(300_000))

  test('PST-014 words OCR read from a scanned page survive a backup and restore: they are still stored and Find finds them at once, without reading the page again', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, ocrDialog, ocrToast }, testInfo) => {
    knownDefect('DEF-902')
    const { scan, doc } = await scanReadByOcr(app, page, ocrDialog, ocrToast)
    const ocrText = (await searchRows(page, doc.id))[0].text
    await roundTrip(app, page, testInfo, 'New Project 1')

    const decisions = recordOcrDecisions(page)
    // The restored document keeps its id, so its OCR row should be back under it.
    const restored = await searchRows(page, doc.id)
    expect(restored.map((r) => [r.pageNumber, r.text]), 'the OCR text came back with the document').toEqual([[1, ocrText]])
    await findInRestoredScan(app, scan)
    await app.find.expectCount(1, 1)
    expect(decisions, 'no OCR job was needed to find the word').toEqual([])
  })

  // The user-level guarantee that holds with or without DEF-902: the OCR'd word is
  // never lost for good. Today Find re-reads the page with OCR first (slow, see
  // PST-014); once the backup keeps the text, it is found at once. Either way the
  // word must be found and stored for the page again.
  test('PST-015 after a restore, Find still finds a word OCR read from a scanned page, re-reading the page if it has to', { tag: '@P2' }, async ({ signedIn: app, page, ocrDialog, ocrToast }, testInfo) => {
    const { scan, doc } = await scanReadByOcr(app, page, ocrDialog, ocrToast)
    await roundTrip(app, page, testInfo, 'New Project 1')
    await findInRestoredScan(app, scan)
    await expect(app.find.counter).toBeVisible({ timeout: OCR_PAGE_TIMEOUT })
    await app.find.expectCount(1, 1)
    const rows = await searchRows(page, doc.id)
    expect(rows.map((r) => r.pageNumber)).toEqual([1])
    expect(wordsOf(rows[0].text)).toContain(OCR_WORD)
  })
})
