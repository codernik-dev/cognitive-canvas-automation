/**
 * Regression: OCR (text recognition) of scanned pages.
 *
 * Every entry point is covered: the OCR tool's dialog, automatic background
 * OCR after an in-project upload, Find on a scanned document, Select Area
 * over an image-only region, and the camera scanner's save. Results are
 * checked where they live: the `searchText` rows OCR writes (text, and each
 * word's box on the page) and what Find then does with them.
 *
 * The scanned fixtures are rasterised in the test's browser and wrapped in a
 * PDF with no text layer (data/documents-files.ts), so the words, and where
 * they were drawn, are known.
 *
 * Timing: one scanned page renders at 3x and recognises in about 10-15 s on
 * an idle machine (run notes in the report); OCR tests set a test timeout
 * that allows several pages under load. Waits use the app's own progress:
 * the toast, the rows appearing, the find counter.
 */
import { test, expect } from '../../fixtures/documents.js'
import { FIND_PDF } from '../../data/files.js'
import {
  mixedPdf, oneWordScan, stampedScanPdf, galleryJpeg, scannedPdf,
  SCAN_REGIONS, MIXED_TEXT_WORD, MIXED_SCAN_WORD, STAMPED_SCAN_WORD,
} from '../../data/documents-files.js'
import { OCR_PAGE_TIMEOUT, OcrDialog, OcrToast } from '../../components/DocumentsOcr.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import {
  documentByName, searchRows, waitForPages, wordsOf, expectWordAt, expectBoxesNormalised,
  ocrCacheKeys, currentMatchBox, recordOcrDecisions,
} from '../../helpers/documents.js'

/** One OCR page alone takes 10-15 s; a test reading up to four pages under CPU load gets this. */
const OCR_TEST_TIMEOUT = 240_000

interface NoteRow { id: string; type: string; documentId: string; data: { content: string; sourceExcerpt: string; sourcePageNumber: number } }
interface AreaLinkRow { id: string; documentId: string; pageNumber: number; workspaceItemId: string; rect: { x: number; y: number; width: number; height: number } }

test.describe('OCR tool', { tag: ['@regression', '@ocr'] }, () => {
  test.beforeEach(() => test.setTimeout(OCR_TEST_TIMEOUT))

  test('REG-090 OCR of a scanned page stores its words where they were drawn, and Find then highlights them', { tag: ['@P1', '@sanity'] }, async ({ homeScan, app, page, ocrDialog, ocrToast, blockedRequests }) => {
    const { scan, doc } = homeScan
    // Cold start: a fresh profile has no cached language data, and the scan has no text yet.
    expect(await ocrCacheKeys(page) ?? []).not.toContain('./eng.traineddata')
    expect(await searchRows(page, doc.id)).toEqual([])
    const ocrAssets: string[] = []
    page.on('request', (r) => { if (/tesseract|traineddata|\/ocr\//i.test(r.url())) ocrAssets.push(r.url()) })

    await app.viewer.tool('ocr').click()
    await ocrDialog.expectOpen()
    await expect(ocrDialog.current).toHaveText('Current (p.1)')
    await ocrDialog.start.click()
    await expect(ocrDialog.root).toBeHidden()
    await expect(ocrToast.cancel).toBeVisible()
    await ocrToast.expectComplete(1)
    await expect(ocrToast.dismiss).toBeVisible()

    // Exactly one row: page 1, both words, each box where it was drawn.
    const rows = await searchRows(page, doc.id)
    expect(rows.map((r) => r.pageNumber)).toEqual([1])
    expect(wordsOf(rows[0].text)).toEqual(expect.arrayContaining(['OCRALPHA', 'OCRBRAVO']))
    expectBoxesNormalised(rows[0].words!)
    for (const drawn of scan.boxes[0]) expectWordAt(rows[0].words, drawn)

    // Find reads the OCR row and draws the match on the word.
    await app.viewer.tool('find').click()
    await app.find.search('ocrbravo')
    await app.find.expectCount(1, 1)
    const match = await currentMatchBox(page)
    const drawn = scan.boxes[0][1]
    expect(match.page).toBe(1)
    expect(Math.abs(match.x - drawn.x)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(match.y - drawn.y)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(match.width - drawn.width)).toBeLessThanOrEqual(0.02)

    // Offline by construction: every engine file came from this origin's /ocr/ folder, none was refused.
    const paths = ocrAssets.map((u) => new URL(u))
    expect(paths.every((u) => u.origin === new URL(page.url()).origin && u.pathname.startsWith('/ocr/')), ocrAssets.join('\n')).toBe(true)
    expect(paths.map((u) => u.pathname)).toEqual(expect.arrayContaining(['/ocr/worker.min.js', '/ocr/eng.traineddata.gz']))
    expect(paths.some((u) => /^\/ocr\/tesseract-core(-simd)?-lstm\.wasm\.js$/.test(u.pathname))).toBe(true)
    expect(blockedRequests.filter((r) => /tesseract|traineddata|tessdata|jsdelivr|unpkg|naptha/i.test(r))).toEqual([])
    expect(await ocrCacheKeys(page)).toContain('./eng.traineddata')
  })

  test('REG-200 the OCR dialog lists its page choices, clamps a typed range, offers the seven bundled languages, and closes without reading', { tag: '@P2' }, async ({ homeScan, app, page, ocrDialog, ocrToast }) => {
    const { doc } = homeScan
    await app.viewer.tool('ocr').click()
    await ocrDialog.expectOpen()
    await expect(ocrDialog.subtitle).toBeVisible()
    await expect(ocrDialog.current).toHaveText('Current (p.1)')
    await expect(ocrDialog.range).toBeVisible()
    await expect(ocrDialog.all).toHaveText('All (3)')
    await expect(ocrDialog.start).toHaveText('Start OCR')
    await expect(ocrDialog.language).toHaveValue('eng')
    const options = await ocrDialog.language.locator('option').evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent]))
    expect(options).toEqual([['eng', 'English'], ['hin', 'Hindi'], ['pan', 'Punjabi'], ['jpn', 'Japanese'], ['ara', 'Arabic'], ['fra', 'French'], ['deu', 'German']])

    // Page range: defaults 1..min(pages, 5), out-of-range values snap back on blur.
    await ocrDialog.range.click()
    await expect(ocrDialog.from).toHaveValue('1')
    await expect(ocrDialog.to).toHaveValue('3')
    await ocrDialog.from.fill('0')
    await ocrDialog.from.blur()
    await expect(ocrDialog.from).toHaveValue('1')
    await ocrDialog.to.fill('99')
    await ocrDialog.to.blur()
    await expect(ocrDialog.to).toHaveValue('3')
    await ocrDialog.from.fill('')
    await ocrDialog.from.blur()
    await expect(ocrDialog.from).toHaveValue('1')

    // A click on the dimmed backdrop keeps the dialog (work in it is worth keeping).
    await ocrDialog.root.click({ position: { x: 5, y: 5 } })
    await expect(ocrDialog.heading).toBeVisible()
    await ocrDialog.footerCancel.click()
    await expect(ocrDialog.root).toBeHidden()

    // The ✕ closes too, and "Current" follows the page being read.
    await app.viewer.jumpTo(2)
    await app.viewer.expectPage(2, 3)
    await app.viewer.tool('ocr').click()
    await expect(ocrDialog.current).toHaveText('Current (p.2)')
    await ocrDialog.closeX.click()
    await expect(ocrDialog.root).toBeHidden()

    // Nothing was read.
    await expect(ocrToast.root).toHaveCount(0)
    expect(await searchRows(page, doc.id)).toEqual([])
  })

  test('REG-201 a page range reads only those pages, and a page with nothing on it is stored as read-but-empty', { tag: '@P1' }, async ({ homeScan, app, page, ocrDialog, ocrToast }) => {
    const { scan, doc } = homeScan
    await app.viewer.tool('ocr').click()
    await ocrDialog.range.click()
    await ocrDialog.from.fill('2')
    await ocrDialog.from.blur()
    await ocrDialog.start.click()
    // A range of more than one page is checked for image-only pages first.
    await expect(ocrDialog.warningTitle).toHaveText('2 of 2 pages look image-only')
    await ocrDialog.warningContinue.click()
    await expect(ocrDialog.root).toBeHidden()
    await ocrToast.expectComplete(2, 2 * OCR_PAGE_TIMEOUT)

    const rows = await searchRows(page, doc.id)
    expect(rows.map((r) => r.pageNumber)).toEqual([2, 3])
    expect(wordsOf(rows[0].text)).toContain('OCRCHARLIE')
    expectWordAt(rows[0].words, scan.boxes[1][0])
    // Blank paper: a row that says "looked, found nothing", so Find stops waiting for it.
    expect(rows[1].text).toBe('')
    expect(rows[1].words).toEqual([])
  })

  test('REG-202 the image-only warning: Cancel starts nothing; Continue reads every page and the dialog then sums up the result', { tag: '@P1' }, async ({ homeScan, app, page, ocrDialog, ocrToast }) => {
    const { doc } = homeScan
    await app.viewer.tool('ocr').click()
    await ocrDialog.all.click()
    await ocrDialog.start.click()
    await expect(ocrDialog.warningTitle).toHaveText('3 of 3 pages look image-only')
    await expect(ocrDialog.warningBody).toBeVisible()
    await expect(ocrDialog.start).toHaveText('Awaiting confirmation')
    await expect(ocrDialog.start).toBeDisabled()

    await ocrDialog.warningCancel.click()
    await expect(ocrDialog.warningTitle).toBeHidden()
    await expect(ocrDialog.start).toHaveText('Start OCR')
    await expect(ocrDialog.start).toBeEnabled()
    await expect(ocrToast.root).toHaveCount(0)
    expect(await searchRows(page, doc.id)).toEqual([])

    await ocrDialog.start.click()
    await ocrDialog.warningContinue.click()
    await expect(ocrDialog.root).toBeHidden()
    await expect(ocrToast.counter).toHaveText(/^Page [1-3] of 3$/, { timeout: OCR_PAGE_TIMEOUT })
    // Reopened while it runs, the dialog turns into the job's summary when it ends
    // (the summary lasts until the finished job is cleared, 5 s later).
    await app.viewer.tool('ocr').click()
    await expect(ocrDialog.completeTitle).toBeVisible({ timeout: 3 * OCR_PAGE_TIMEOUT })
    const extracted = await ocrDialog.root.getByText(/characters extracted$/).innerText()
    await expect(ocrDialog.start).toHaveText('Run Again')
    await expect(ocrToast.root).toContainText('· 3 pages processed')
    await ocrDialog.footerClose.click()
    await expect(ocrDialog.root).toBeHidden()
    const rows = await searchRows(page, doc.id)
    expect(rows.map((r) => r.pageNumber)).toEqual([1, 2, 3])
    expect(extracted).toBe(`${rows.reduce((n, r) => n + r.text.length, 0)} characters extracted`)
  })

  test('REG-219 the OCR summary counts only pages that had text, and says "1 page processed" for one page', { tag: '@P3' }, async ({ homeScan, app, page, ocrDialog, ocrToast }) => {
    knownDefect('DEF-202')
    knownDefect('DEF-203')
    // Page 3 is blank paper: one page processed, none with text.
    await app.viewer.jumpTo(3)
    await app.viewer.expectPage(3, 3)
    await app.viewer.tool('ocr').click()
    await expect(ocrDialog.current).toHaveText('Current (p.3)')
    await ocrDialog.start.click()
    // The dialog is reopened while the job runs and the toast read the moment it completes:
    // both summaries last only 5 s after the job ends.
    await app.viewer.tool('ocr').click()
    await expect(ocrToast.root).toContainText('OCR Complete', { timeout: OCR_PAGE_TIMEOUT })
    const toastText = await ocrToast.root.innerText()
    const dialogLine = await ocrDialog.root.getByText(/pages? with text$/).innerText()
    expect((await searchRows(page, homeScan.doc.id)).map((r) => [r.pageNumber, r.text])).toEqual([[3, '']])
    expect(toastText).toMatch(/· 1 page processed$/)
    expect(dialogLine).toBe('0 pages with text')
  })

  test('REG-203 running OCR again on a page that already has text replaces its row instead of adding a second one', { tag: '@P2' }, async ({ signedIn: app, page, ocrDialog, ocrToast }) => {
    // A Home upload keeps the text layer's row for page 1 and starts no background OCR.
    const mixed = await mixedPdf(page)
    await app.home.upload(mixed.payload)
    await app.documents.openDocument(mixed.displayName)
    await app.viewer.expectDocumentOpen(mixed.displayName, mixed.pageCount)
    const doc = await documentByName(page, mixed.displayName)
    const before = await searchRows(page, doc.id)
    expect(before.map((r) => r.pageNumber)).toEqual([1])
    expect(before[0].words).toBeUndefined()

    await app.viewer.tool('ocr').click()
    await ocrDialog.start.click()
    await ocrToast.expectComplete(1)
    const first = await searchRows(page, doc.id)
    expect(first.map((r) => r.pageNumber)).toEqual([1])
    expect(first[0].id).not.toBe(before[0].id)
    expect(wordsOf(first[0].text)).toContain(MIXED_TEXT_WORD)
    expect(first[0].words!.some((w) => wordsOf(w[0]).includes(MIXED_TEXT_WORD))).toBe(true)

    await app.viewer.tool('ocr').click()
    await expect(ocrDialog.start).toHaveText('Run Again')
    await ocrDialog.start.click()
    // The finished job's toast may still be up: the replaced row is the proof the second run happened.
    await expect
      .poll(async () => (await searchRows(page, doc.id)).map((r) => [r.pageNumber, r.id !== first[0].id, wordsOf(r.text).includes(MIXED_TEXT_WORD)]), { timeout: OCR_PAGE_TIMEOUT })
      .toEqual([[1, true, true]])
    await ocrToast.expectComplete(1)
  })

  test('REG-207 when the language data cannot load, the OCR toast says so and Find reports the text could not be read', { tag: '@P2' }, async ({ homeScan, app, page, ocrDialog, ocrToast }) => {
    // Test double for a failed download of the 11 MB language file (iPad "Load failed").
    await page.route('**/ocr/eng.traineddata.gz', (route) => route.fulfill({ status: 404, body: 'not here' }))
    await app.viewer.tool('ocr').click()
    await ocrDialog.start.click()
    await expect(ocrToast.text(/^Text recognition could not start \(eng\): .+/)).toBeVisible({ timeout: OCR_PAGE_TIMEOUT })
    await expect(ocrToast.dismiss).toBeVisible()
    expect(await searchRows(page, homeScan.doc.id)).toEqual([])
    await ocrToast.dismiss.click()
    await expect(ocrToast.root).toHaveCount(0)

    await app.viewer.tool('find').click()
    await app.find.search('OCRALPHA')
    const verdict = page.getByText('Text could not be read', { exact: true })
    await expect(verdict).toBeVisible({ timeout: OCR_PAGE_TIMEOUT })
    await expect(verdict).toHaveAttribute('title', 'Text recognition did not finish for this document. Change the search to try again.')
    await expect(app.find.counter).toHaveCount(0)
  })

  test('REG-210 the chosen OCR language is the one the engine loads', { tag: '@P2' }, async ({ signedIn: app, page, ocrDialog, ocrToast }) => {
    const scan = await oneWordScan(page, 'OCRGOLF', 'automation-german')
    await app.home.upload(scan.payload)
    await app.documents.openDocument(scan.displayName)
    await app.viewer.expectDocumentOpen(scan.displayName, 1)
    const languageFiles: string[] = []
    page.on('request', (r) => { if (r.url().includes('.traineddata')) languageFiles.push(new URL(r.url()).pathname) })
    await app.viewer.tool('ocr').click()
    await ocrDialog.language.selectOption({ label: 'German' })
    await expect(ocrDialog.language).toHaveValue('deu')
    await ocrDialog.start.click()
    await ocrToast.expectComplete(1)
    expect(languageFiles).toEqual(['/ocr/deu.traineddata.gz'])
    const rows = await searchRows(page, (await documentByName(page, scan.displayName)).id)
    expect(wordsOf(rows[0].text)).toContain('OCRGOLF')
  })

  test('REG-211 while OCR reads one document the OCR tool on another is disabled and says why; the toast names the document', { tag: '@P2' }, async ({ homeScan, app, ocrDialog, ocrToast }) => {
    const { scan } = homeScan
    await app.viewer.tool('ocr').click()
    await ocrDialog.all.click()
    await ocrDialog.start.click()
    await ocrDialog.warningContinue.click()
    await expect(ocrToast.counter).toBeVisible({ timeout: OCR_PAGE_TIMEOUT })

    await app.viewer.backToDocuments.click()
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const tool = app.viewer.tool('ocr')
    await expect(tool).toBeDisabled()
    await expect(tool).toHaveAttribute('aria-label', new RegExp(`^OCR is reading "${scan.displayName}"( \\(page [1-3] of 3\\))?\\. It becomes available here when that finishes\\.$`))
    await expect(ocrToast.root).toContainText(`· ${scan.displayName}`)
    await expect(ocrToast.root).toContainText('OCR Complete', { timeout: 3 * OCR_PAGE_TIMEOUT })
    await expect(tool).toBeEnabled()
    await expect(tool).toHaveAttribute('aria-label', 'OCR')
  })
})

/** Longer than one page takes to read on a loaded machine: a job that kept going would add page 3 inside it. */
const CANCEL_WATCH_MS = 30_000

test.describe('Cancelling OCR', { tag: ['@regression', '@ocr'] }, () => {
  test.beforeEach(() => test.setTimeout(OCR_TEST_TIMEOUT))
  // DEF-211: a cancel that lands while the engine is between calls can throw this inside the
  // OCR engine (seen intermittently). Tolerated here, with a reason, so the cancel flow's own
  // checks still run; the error is reported as a defect.
  test.use({ allowedPageErrors: [/Cannot read properties of null \(reading 'postMessage'\)/] })

  test('REG-208 Cancel OCR in the toast stops after the page in hand, and a second OCR then runs to the end', { tag: '@P1' }, async ({ homeScan, app, page, ocrDialog, ocrToast }) => {
    const { doc } = homeScan
    await app.viewer.tool('ocr').click()
    await ocrDialog.all.click()
    await ocrDialog.start.click()
    await ocrDialog.warningContinue.click()
    await waitForPages(page, doc.id, [1], OCR_PAGE_TIMEOUT)
    await ocrToast.cancel.click()
    await expect(ocrToast.text('Cancelled.')).toBeVisible()
    await expect(ocrToast.dismiss).toBeVisible()
    await expect(ocrToast.cancel).toHaveCount(0)
    const afterCancel = (await searchRows(page, doc.id)).map((r) => r.pageNumber)
    expect(afterCancel).toContain(1)
    expect(afterCancel).not.toContain(3)
    await ocrToast.dismiss.click()
    await expect(ocrToast.root).toHaveCount(0)
    // "Cancelled." shows as soon as the job is marked; the proof that reading stopped is that
    // page 3 never arrives, over longer than a page takes to read.
    await expect(waitForPages(page, doc.id, [3], CANCEL_WATCH_MS)).rejects.toThrow()

    // The next job must not hang on "Starting OCR..." (fixed 2026-10-22).
    await app.viewer.tool('ocr').click()
    await expect(ocrDialog.start).toHaveText('Start OCR')
    await ocrDialog.all.click()
    await ocrDialog.start.click()
    await ocrDialog.warningContinue.click()
    await expect(ocrToast.root).toContainText('OCR Complete', { timeout: 3 * OCR_PAGE_TIMEOUT })
    expect((await searchRows(page, doc.id)).map((r) => r.pageNumber)).toEqual([1, 2, 3])
  })

  test('REG-209 reopening the dialog during a job shows its progress, locks the choices, and Cancel Background Job stops it', { tag: '@P2' }, async ({ homeScan, app, page, ocrDialog, ocrToast }) => {
    await app.viewer.tool('ocr').click()
    await ocrDialog.all.click()
    await ocrDialog.start.click()
    await ocrDialog.warningContinue.click()
    await expect(ocrToast.counter).toHaveText(/^Page 1 of 3$/, { timeout: OCR_PAGE_TIMEOUT })

    await app.viewer.tool('ocr').click()
    await expect(ocrDialog.cancelBackgroundJob).toBeVisible()
    await expect(ocrDialog.progress).toHaveText(/^Page [1-3] of 3$/)
    await expect(ocrDialog.current).toBeDisabled()
    await expect(ocrDialog.all).toBeDisabled()
    await expect(ocrDialog.language).toBeDisabled()
    await expect(ocrDialog.start).toHaveCount(0)
    await ocrDialog.cancelBackgroundJob.click()
    await expect(ocrToast.text('Cancelled.')).toBeVisible()
    await expect(ocrDialog.cancelBackgroundJob).toHaveCount(0)
    await expect(ocrDialog.start).toHaveText('Start OCR')
    expect((await searchRows(page, homeScan.doc.id)).map((r) => r.pageNumber)).not.toContain(3)
    await expect(waitForPages(page, homeScan.doc.id, [3], CANCEL_WATCH_MS)).rejects.toThrow()
  })
})

test.describe('OCR across tabs', { tag: ['@regression', '@ocr'] }, () => {
  test.beforeEach(() => test.setTimeout(OCR_TEST_TIMEOUT))

  test('REG-228 OCR asked for in a second tab waits while the first tab reads the same document, and every page ends with one row', { tag: '@P2' }, async ({ homeScan, app, page, context, ocrDialog, ocrToast }) => {
    const { scan, doc } = homeScan
    const second = new CognitiveCanvas(await context.newPage())
    await second.open()
    await second.home.reach()
    await second.home.openProject('New Project 1')
    await second.documents.openDocument(scan.displayName)
    await second.viewer.expectDocumentOpen(scan.displayName, scan.pageCount)

    await page.bringToFront()
    await app.viewer.tool('ocr').click()
    await ocrDialog.all.click()
    await ocrDialog.start.click()
    await ocrDialog.warningContinue.click()
    await expect(ocrToast.counter).toHaveText(/^Page [1-3] of 3$/, { timeout: OCR_PAGE_TIMEOUT })

    const secondDialog = new OcrDialog(second.page)
    const secondToast = new OcrToast(second.page)
    await second.page.bringToFront()
    await second.viewer.tool('ocr').click()
    await secondDialog.start.click()
    await expect(secondToast.text('Waiting for another tab…')).toBeVisible()
    await expect(ocrToast.root).toContainText('OCR Complete', { timeout: 3 * OCR_PAGE_TIMEOUT })
    await expect(secondToast.root).toContainText('OCR Complete', { timeout: OCR_PAGE_TIMEOUT })
    // No second row set: each page has exactly one row, page 1 the second tab's re-read.
    const rows = await searchRows(page, doc.id)
    expect(rows.map((r) => r.pageNumber)).toEqual([1, 2, 3])
    expect(wordsOf(rows[0].text)).toContain('OCRALPHA')
  })
})

test.describe('Automatic OCR', { tag: ['@regression', '@ocr'] }, () => {
  test.beforeEach(() => test.setTimeout(OCR_TEST_TIMEOUT))

  test('REG-204 a PDF uploaded into a project has its scanned page read in the background, its text page left alone, and no toast', { tag: ['@P1', '@sanity'] }, async ({ project: _p, app, page, ocrDialog, ocrToast }) => {
    const mixed = await mixedPdf(page)
    await app.documents.uploadFiles(mixed.payload)
    await app.viewer.expectDocumentOpen(mixed.displayName, mixed.pageCount)
    const doc = await documentByName(page, mixed.displayName)
    await waitForPages(page, doc.id, [1, 2], 2 * OCR_PAGE_TIMEOUT)
    await expect(ocrToast.root).toHaveCount(0)
    const [textRow, scanRow] = await searchRows(page, doc.id)
    // Page 1 keeps its text-layer row (more than 8 characters of real text: not OCR'd).
    expect(textRow.text).toContain(MIXED_TEXT_WORD)
    expect(textRow.words).toBeUndefined()
    // Page 2 was read by OCR, word and box.
    expect(wordsOf(scanRow.text)).toContain(MIXED_SCAN_WORD)
    expectWordAt(scanRow.words, mixed.boxes[1][0])

    // The OCR dialog's pre-flight sees one image-only page of two.
    await app.viewer.tool('ocr').click()
    await ocrDialog.all.click()
    await ocrDialog.start.click()
    await expect(ocrDialog.warningTitle).toHaveText('1 of 2 pages look image-only')
    await ocrDialog.warningCancel.click()
    await ocrDialog.footerCancel.click()
    await expect(ocrToast.root).toHaveCount(0)
    expect((await searchRows(page, doc.id)).map((r) => r.id)).toEqual([textRow.id, scanRow.id])
  })

  test('REG-205 a scanned PDF uploaded into a project is read page by page in the background, and Find then finds its words at once', { tag: '@P1' }, async ({ project: _p, app, page, ocrToast }) => {
    const scan = await scannedPdf(page)
    const firstOcrRequest = page.waitForRequest(/\/ocr\/worker\.min\.js$/, { timeout: OCR_PAGE_TIMEOUT })
    const uploadedAt = Date.now()
    await app.documents.uploadFiles(scan.payload)
    await firstOcrRequest
    test.info().annotations.push({ type: 'timing', description: `background OCR asked for its engine ${Date.now() - uploadedAt} ms after the upload` })
    await app.viewer.expectDocumentOpen(scan.displayName, scan.pageCount)
    const doc = await documentByName(page, scan.displayName)
    await waitForPages(page, doc.id, [1, 2, 3], 3 * OCR_PAGE_TIMEOUT)
    await expect(ocrToast.root).toHaveCount(0)

    const rows = await searchRows(page, doc.id)
    expect(rows).toHaveLength(3)
    expect(wordsOf(rows[0].text)).toEqual(expect.arrayContaining(['OCRALPHA', 'OCRBRAVO']))
    expect(wordsOf(rows[1].text)).toContain('OCRCHARLIE')
    expect([rows[2].text, rows[2].words]).toEqual(['', []])
    for (const r of rows) expectBoxesNormalised(r.words!)

    await app.viewer.tool('find').click()
    await app.find.search('OCRCHARLIE')
    await app.find.expectCount(1, 1)
    expect((await currentMatchBox(page)).page).toBe(2)
    expect(await searchRows(page, doc.id)).toHaveLength(3)
  })

  test('REG-214 a scanned PDF uploaded from Home is not read in the background', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const scan = await scannedPdf(page)
    await app.home.upload(scan.payload)
    await app.documents.openDocument(scan.displayName)
    await app.viewer.expectDocumentOpen(scan.displayName, scan.pageCount)
    const doc = await documentByName(page, scan.displayName)
    // The Home upload waits for the text pass before opening the project: that is where an in-project upload queues OCR.
    expect(doc.textIndexedAt).toBeGreaterThan(0)
    // An in-project upload asks for the engine within a few seconds (REG-205 records it); nothing may ask here.
    // Waiting on the request that must not come is the bounded negative check.
    await expect(page.waitForRequest(/\/ocr\//, { timeout: 10_000 })).rejects.toThrow(/Timeout/)
    expect(await searchRows(page, doc.id)).toEqual([])
  })

  test('REG-215 a scanned page whose text layer holds only a page number is still read by background OCR', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    knownDefect('DEF-201')
    const decisions = recordOcrDecisions(page)
    const stamped = await stampedScanPdf(page)
    await app.documents.uploadFiles(stamped.payload)
    await app.viewer.expectDocumentOpen(stamped.displayName, 1)
    // The upload classes the page as scanned (fewer than 8 characters) and queues OCR; the runner then decides what to read.
    await expect.poll(() => decisions.length, { timeout: OCR_PAGE_TIMEOUT, message: 'background OCR job considered the document' }).toBeGreaterThan(0)
    expect(decisions[0].willOcr, 'pages the background OCR will read').toEqual([1])
    const doc = await documentByName(page, stamped.displayName)
    await expect.poll(async () => wordsOf((await searchRows(page, doc.id))[0]?.text ?? ''), { timeout: OCR_PAGE_TIMEOUT }).toContain(STAMPED_SCAN_WORD)
  })
})

test.describe('Find on scanned documents', { tag: ['@regression', '@ocr', '@find'] }, () => {
  test.beforeEach(() => test.setTimeout(OCR_TEST_TIMEOUT))

  test('REG-206 Find on an unread scan asks for OCR, waits with a spinner, then counts and marks the word; a missing word says "No readable text" and why', { tag: ['@P1', '@sanity'] }, async ({ homeScan, app, page, ocrToast }) => {
    const { scan, doc } = homeScan
    await app.viewer.tool('find').click()
    await app.find.search('OCRCHARLIE')
    // While OCR runs the bar shows its spinner, never a verdict.
    await expect(app.find.input.locator('xpath=..').locator('.animate-spin')).toBeVisible()
    await expect(app.find.noResults).toHaveCount(0)
    await expect(app.find.counter).toHaveText('1 of 1', { timeout: 3 * OCR_PAGE_TIMEOUT })
    const match = await currentMatchBox(page)
    expect(match.page).toBe(2)
    expect(Math.abs(match.x - scan.boxes[1][0].x)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(match.y - scan.boxes[1][0].y)).toBeLessThanOrEqual(0.02)
    // Find queued the whole document, silently.
    await waitForPages(page, doc.id, [1, 2, 3], 3 * OCR_PAGE_TIMEOUT)
    await expect(ocrToast.root).toHaveCount(0)

    await app.find.search('OCRZULU')
    const verdict = page.getByText('No readable text', { exact: true })
    await expect(verdict).toBeVisible({ timeout: 20_000 })
    await expect(verdict).toHaveAttribute('title', '1 scanned page has no text that can be read - handwriting is not searchable.')
    await page.getByRole('button', { name: 'Why no results?' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'text layer on' })).toHaveText(/^3 pages · text layer on 0 · OCR text on 3 · 1 unreadable · build .+$/)
  })
})

test.describe('Find while OCR is slow', { tag: ['@regression', '@ocr', '@find'] }, () => {
  test('REG-218 when OCR takes longer than Find will wait, the bar stops spinning and says it is still reading the scan', { tag: '@P3' }, async ({ homeScan: _h, app, page }) => {
    // Test double for a very slow engine start: the language file never arrives.
    await page.route('**/ocr/eng.traineddata.gz', () => { /* left pending on purpose */ })
    await app.viewer.tool('find').click()
    await app.find.search('OCRALPHA')
    const spinner = app.find.input.locator('xpath=..').locator('.animate-spin')
    await expect(spinner).toBeVisible()
    // Find gives up waiting after 20 s (PdfViewer.tsx FIND_WAIT_MAX_MS) while OCR is still queued.
    await expect(page.getByText('Reading scan…', { exact: true })).toBeVisible({ timeout: 40_000 })
    await expect(spinner).toHaveCount(0)
    await expect(app.find.counter).toHaveCount(0)
  })
})

test.describe('Select Area on scanned pages', { tag: ['@regression', '@ocr', '@area-tools'] }, () => {
  test.beforeEach(() => test.setTimeout(OCR_TEST_TIMEOUT))

  test('REG-091 Select Area over an image-only region reads it by OCR into a linked note, without touching the text index', { tag: ['@P1'] }, async ({ homeScan, app, page }) => {
    const { doc } = homeScan
    await app.viewer.tool('select-area').click()
    await app.viewer.dragOnPage(1, ...SCAN_REGIONS.alpha)
    await expect(page.getByText('Running OCR...')).toBeVisible()
    // The overlay (and its "Note created!" line) goes with the tool once the note exists; the stored link is the signal.
    await expectStoreCount(page, 'areaLinks', 1, () => true, OCR_PAGE_TIMEOUT)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    await expectStoreCount(page, 'workspaceItems', 1)
    const [note] = await readStore<NoteRow>(page, 'workspaceItems')
    expect(note).toMatchObject({ id: link.workspaceItemId, type: 'note', documentId: doc.id })
    expect(wordsOf(note.data.content)).toContain('OCRALPHA')
    expect(wordsOf(note.data.content)).not.toContain('OCRBRAVO')
    expect(wordsOf(note.data.sourceExcerpt)).toContain('OCRALPHA')
    expect(note.data.sourcePageNumber).toBe(1)
    const [[x0, y0], [x1, y1]] = SCAN_REGIONS.alpha
    expect(link.pageNumber).toBe(1)
    expect(link.rect.x).toBeCloseTo(x0, 2)
    expect(link.rect.y).toBeCloseTo(y0, 2)
    expect(link.rect.width).toBeCloseTo(x1 - x0, 2)
    expect(link.rect.height).toBeCloseTo(y1 - y0, 2)
    await expect(app.canvas.item(note.id)).toContainText('OCRALPHA')
    expect(await searchRows(page, doc.id)).toEqual([])
  })

  test('REG-212 Select Area over white paper says the area looks blank and creates nothing', { tag: '@P2' }, async ({ homeScan, app, page, toolbar }) => {
    await app.viewer.tool('select-area').click()
    await app.viewer.dragOnPage(1, ...SCAN_REGIONS.blank)
    await app.toasts.expectShown('That area looks blank — nothing to read.')
    expect(await toolbar.isArmed('select-area')).toBe(false)
    await expectStoreCount(page, 'workspaceItems', 0)
    await expectStoreCount(page, 'areaLinks', 0)
    expect(await searchRows(page, homeScan.doc.id)).toEqual([])
  })

  test('REG-213 Select Area over a drawing with no letters says no text was found and creates nothing', { tag: '@P2' }, async ({ homeScan, app, page, toolbar }) => {
    await app.viewer.tool('select-area').click()
    await app.viewer.dragOnPage(1, ...SCAN_REGIONS.picture)
    await expect(page.getByText('Running OCR...')).toBeVisible()
    await app.toasts.expectShown('No text found in selected area.', OCR_PAGE_TIMEOUT)
    expect(await toolbar.isArmed('select-area')).toBe(false)
    await expectStoreCount(page, 'workspaceItems', 0)
    await expectStoreCount(page, 'areaLinks', 0)
    expect(await searchRows(page, homeScan.doc.id)).toEqual([])
  })
})

test.describe('OCR of camera scans', { tag: ['@regression', '@ocr', '@scanner'] }, () => {
  test.beforeEach(() => test.setTimeout(OCR_TEST_TIMEOUT))

  test('REG-216 a page captured with the camera is read by background OCR after Save', { tag: '@P2' }, async ({ project: _p, app, page, scanner, ocrToast }) => {
    await scanner.open(app.documents.scan)
    await scanner.cameraLive()
    await scanner.capture.click()
    await scanner.next.click()
    await scanner.save.click()
    await expect(scanner.dialog).toBeHidden({ timeout: 30_000 })
    await expectStoreCount(page, 'documents', 1, () => true, 30_000)
    const [doc] = await readStore<{ id: string; name: string }>(page, 'documents')
    // The fake camera's frame has no reliable words; what matters is that OCR looked at the page and said so.
    await waitForPages(page, doc.id, [1], OCR_PAGE_TIMEOUT)
    const [row] = await searchRows(page, doc.id)
    expect(Array.isArray(row.words)).toBe(true)
    expectBoxesNormalised(row.words!)
    await expect(ocrToast.root).toHaveCount(0)
  })

  test('REG-217 a photo picked from the gallery is saved as a scan whose words OCR finds where they were', { tag: ['@P1'] }, async ({ project: _p, app, page, scanner }) => {
    const photo = await galleryJpeg(page, 'OCRHOTEL', 'automation-photo.jpg')
    await scanner.open(app.documents.scan)
    await scanner.pickImages([photo])
    await expect(scanner.stripCaption).toHaveText('1 page — tap Next to review + write')
    await scanner.next.click()
    await scanner.name.fill('Gallery Scan')
    await scanner.save.click()
    await expect(scanner.dialog).toBeHidden({ timeout: 30_000 })
    await app.viewer.expectDocumentOpen('Gallery Scan', 1)
    const doc = await documentByName(page, 'Gallery Scan')
    await waitForPages(page, doc.id, [1], OCR_PAGE_TIMEOUT)
    const [row] = await searchRows(page, doc.id)
    expect(wordsOf(row.text)).toContain('OCRHOTEL')
    expectWordAt(row.words, photo.boxes[0])
    await app.viewer.tool('find').click()
    await app.find.search('ocrhotel')
    await app.find.expectCount(1, 1)
  })
})
