/**
 * Documents on a phone (Pixel 5, project "phone"): the full-screen phone
 * scanner (CameraScannerModal.tsx `isPhone` layout), the 50 MB PDF limit that
 * applies on phones and tablets (DocumentListView.tsx MAX_PDF_SIZE; desktop
 * has none), and Find reading a scanned page on demand, the phone's stand-in
 * for background OCR, which a phone never runs (DocumentListView.tsx
 * allowAutoOcr). Desktop scanner / OCR: tests/regression/scanner.spec.ts, ocr.spec.ts.
 *
 * This project has no camera (no fake-device flag): the scanner says so in
 * its own words, and pages come from "Pick from gallery". Capturing with a
 * camera on a phone is REG-852 (permissions.phone.spec.ts).
 *
 * The 50 MB files are sparse files written to the test's output folder
 * (data/canvas-files.ts bigFile): the limit reads only file.size, before any
 * byte is read, so their contents (zeros) never matter for the size check.
 */
import { test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { bigFile } from '../../data/canvas-files.js'
import { galleryJpeg, oneWordScan } from '../../data/documents-files.js'
import { documentByName, searchRows, wordsOf } from '../../helpers/documents.js'
import { OCR_PAGE_TIMEOUT } from '../../components/DocumentsOcr.js'
import { openPdfOnPhone } from '../../helpers/mobileFlows.js'

const MB = 1024 * 1024

test.describe('Documents on a phone', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-874 the phone scanner is full screen: gallery pages appear in its strip, a page can be removed after asking, and Next reviews and saves them as one document', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.scan.click()
    const title = page.getByText('Scan Document', { exact: true })
    await expect(title).toBeVisible()
    // The phone layout: a black full-screen page with Back and Close, not the desktop modal.
    await expect(page.getByRole('dialog', { name: 'Scan Document' })).toHaveCount(0)
    const shell = page.locator('div.fixed.inset-0.bg-black')
    expect((await shell.boundingBox())!.width).toBeCloseTo(page.viewportSize()!.width, 0)
    await expect(shell.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
    await expect(page.getByText('Could not start the camera. Close other apps using it, then reopen the scanner.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Capture page' })).toBeDisabled()

    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Pick from gallery' }).click()
    await (await chooser).setFiles([await galleryJpeg(page, 'PHONEPAGEONE', 'one.jpg'), await galleryJpeg(page, 'PHONEPAGETWO', 'two.jpg')])
    await expect(shell.getByRole('img', { name: /^Page \d$/ })).toHaveCount(2, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Next — review 2 pages' })).toBeVisible()

    const asked = new Promise<string>((resolve) => page.once('dialog', async (d) => { const m = d.message(); await d.accept(); resolve(m) }))
    await page.getByRole('button', { name: 'Remove page 2' }).click()
    expect(await asked).toBe('Remove page 2 from this scan? It will not be in the saved document.')
    await expect(shell.getByRole('img', { name: /^Page \d$/ })).toHaveCount(1)
    await page.getByRole('button', { name: 'Next — review 1 page' }).click()
    await expect(page.getByText('Review pages', { exact: true })).toBeVisible()
    await expect(page.getByText('Tap a note page to write on it. Once you save, the document can\'t be edited.')).toBeVisible()
    await page.getByPlaceholder('Document name…').fill('Phone Scan')
    await page.getByRole('button', { name: /^Save \(1\)$/ }).click()
    await expectStoreCount(page, 'documents', 1, () => true, 30_000)
    const [doc] = await readStore<{ name: string; pageCount: number }>(page, 'documents')
    expect(doc).toMatchObject({ name: 'Phone Scan', pageCount: 1 })
    await expect(title).toHaveCount(0)
  })

  test('REG-875 a PDF over 50 MB is refused on a phone with its size and the limit, and nothing is stored; one of exactly 50 MB passes the size check', { tag: '@P2' }, async ({ project: _p, app, page }, testInfo) => {
    const over = bigFile(testInfo.outputPath('over-limit.pdf'), 50 * MB + 1)
    const exact = bigFile(testInfo.outputPath('at-limit.pdf'), 50 * MB)
    await app.documents.uploadFiles(over.path)
    await app.toasts.expectShown('"over-limit.pdf" is too large (50.0 MB). Maximum size is 50 MB.')
    // Exactly 50 MB is within the limit: the next check (its contents) speaks instead.
    await app.documents.uploadFiles(exact.path)
    await app.toasts.expectShown('“at-limit.pdf” doesn’t look like a PDF — its contents don’t match its name.')
    await expect(app.toasts.withText('"at-limit.pdf" is too large')).toHaveCount(0)
    expect(await readStore(page, 'documents')).toEqual([])
    over.remove()
    exact.remove()
  })

  test('REG-876 a phone never OCRs a scan in the background, but Find reads the open scanned page on demand and finds its word', { tag: '@P2' }, async ({ project: _p, app, ws, page }) => {
    // One page of recognition on a loaded machine.
    test.setTimeout(240_000)
    const scan = await oneWordScan(page, 'OCRPHONEWORD', 'automation-phone-scan')
    await openPdfOnPhone(app, ws, scan.payload, 1)
    const doc = await documentByName(page, scan.displayName)
    await ws.docDial.pick('find')
    await app.find.search('OCRPHONEWORD')
    await expect(app.find.counter).toHaveText('1 of 1', { timeout: OCR_PAGE_TIMEOUT })
    const [row] = await searchRows(page, doc.id)
    expect(row.pageNumber).toBe(1)
    expect(wordsOf(row.text)).toContain('OCRPHONEWORD')
  })
})
