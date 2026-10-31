/**
 * Regression: the camera scanner beyond the basic capture and refusal
 * (REG-080/081 in media.spec.ts): gallery import, page removal and the
 * questions that guard unsaved pages, note pages and their writing pad, the
 * review grid, naming and saving. CameraScannerModal.tsx, ScannerNotePad.tsx.
 *
 * The fake camera comes from Chromium flags (playwright.config.ts); gallery
 * images are generated JPEGs, so no real device or photo is involved.
 */
import { test, expect } from '../../fixtures/documents.js'
import type { Page } from '@playwright/test'
import { galleryJpeg, BROKEN_JPEG } from '../../data/documents-files.js'
import { IMAGES } from '../../data/files.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { documentByName, searchRows, waitForPages, wordsOf } from '../../helpers/documents.js'
import { OCR_PAGE_TIMEOUT } from '../../components/DocumentsOcr.js'

/** Answer the next window.confirm and report its question. */
function answerConfirm(page: Page, accept: boolean): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', async (d) => {
      const message = d.message()
      if (accept) await d.accept()
      else await d.dismiss()
      resolve(message)
    })
  })
}

test.describe('Camera scanner', { tag: ['@regression', '@scanner'] }, () => {
  test('REG-220 two gallery photos become a named two-page document; Back to camera keeps the pages', { tag: ['@P1', '@sanity'] }, async ({ project: _p, app, page, scanner }) => {
    const a = await galleryJpeg(page, 'PAGEONE', 'automation-a.jpg')
    const b = await galleryJpeg(page, 'PAGETWO', 'automation-b.jpg')
    await scanner.open(app.documents.scan)
    await expect(scanner.stripCaption).toHaveText('Captured pages appear here')
    await expect(scanner.next).toBeDisabled()
    await scanner.pickImages([a, b])
    await expect(scanner.stripCaption).toHaveText('2 pages — tap Next to review + write')
    await expect(scanner.thumbnails).toHaveCount(2)

    await scanner.next.click()
    await expect(scanner.dialog).toHaveAccessibleName('Review pages')
    await expect(scanner.dialog.getByText('Tap a note page to write on it. Once saved, the document can\'t be edited.')).toBeVisible()
    await expect(scanner.badges).toHaveText(['1', '2'])
    await scanner.backToCamera.click()
    await expect(scanner.dialog).toHaveAccessibleName('Scan Document')
    await expect(scanner.stripCaption).toHaveText('2 pages — tap Next to review + write')

    await scanner.next.click()
    await scanner.name.fill('Field Notes')
    await expect(scanner.save).toHaveText('Save (2)')
    await scanner.save.click()
    await expect(scanner.dialog).toBeHidden({ timeout: 30_000 })
    await app.viewer.expectDocumentOpen('Field Notes', 2)
    const doc = await documentByName(page, 'Field Notes')
    expect(doc.pageCount).toBe(2)
    await expectStoreCount(page, 'documents', 1)
    // Each photo became one page that renders.
    await app.viewer.jumpTo(2)
    await app.viewer.expectPage(2, 2)
    await app.viewer.pageRendered(2)
  })

  test('REG-221 removing a page from the strip asks first; No keeps it, Yes removes it', { tag: '@P2' }, async ({ project: _p, app, page, scanner }) => {
    await scanner.open(app.documents.scan)
    await scanner.pickImages([await galleryJpeg(page, 'KEEPME', 'automation-keep.jpg'), IMAGES.png()])
    await expect(scanner.thumbnails).toHaveCount(2)

    let question = answerConfirm(page, false)
    await scanner.removeStripPage(1).click()
    expect(await question).toBe('Remove page 1 from this scan? It will not be in the saved document.')
    await expect(scanner.thumbnails).toHaveCount(2)

    question = answerConfirm(page, true)
    await scanner.removeStripPage(2).click()
    expect(await question).toBe('Remove page 2 from this scan? It will not be in the saved document.')
    await expect(scanner.thumbnails).toHaveCount(1)
    await expect(scanner.stripCaption).toHaveText('1 page — tap Next to review + write')

    question = answerConfirm(page, true)
    await scanner.removeStripPage(1).click()
    await question
    await expect(scanner.stripCaption).toHaveText('Captured pages appear here')
    await expect(scanner.next).toBeDisabled()
    await expectStoreCount(page, 'documents', 0)
  })

  test('REG-222 closing the scanner with pages asks before discarding; an empty scanner closes at once', { tag: '@P1' }, async ({ project: _p, app, page, scanner }) => {
    await scanner.open(app.documents.scan)
    await scanner.pickImages([await galleryJpeg(page, 'DISCARD', 'automation-d1.jpg'), await galleryJpeg(page, 'DISCARD', 'automation-d2.jpg')])
    await expect(scanner.thumbnails).toHaveCount(2)

    let question = answerConfirm(page, false)
    await scanner.cancel.click()
    expect(await question).toBe('Discard 2 scanned pages? Nothing has been saved yet.')
    await expect(scanner.dialog).toBeVisible()
    await expect(scanner.thumbnails).toHaveCount(2)

    question = answerConfirm(page, true)
    await page.keyboard.press('Escape')
    expect(await question).toBe('Discard 2 scanned pages? Nothing has been saved yet.')
    await expect(scanner.dialog).toBeHidden()
    await expectStoreCount(page, 'documents', 0)

    // Nothing captured: the ✕ closes without a question (a confirm here would hang on the default dismiss).
    let asked = false
    page.on('dialog', (d) => { asked = true; void d.dismiss() })
    await scanner.open(app.documents.scan)
    await scanner.closeX.click()
    await expect(scanner.dialog).toBeHidden()
    expect(asked).toBe(false)
  })

  test('REG-223 a gallery file that cannot be read is named in the scanner; the readable ones are still added', { tag: '@P2' }, async ({ project: _p, app, page, scanner }) => {
    await scanner.open(app.documents.scan)
    await scanner.pickImages([await galleryJpeg(page, 'GOODPAGE', 'automation-good.jpg'), BROKEN_JPEG()])
    await expect(scanner.error).toHaveText('Added 1 image. Couldn\'t read automation-broken.jpg — export as JPEG or PNG and try again.', { timeout: 30_000 })
    await expect(scanner.thumbnails).toHaveCount(1)

    await scanner.pickImages([BROKEN_JPEG('automation-also-broken.jpg')])
    await expect(scanner.error).toHaveText('Couldn\'t read automation-also-broken.jpg. Export as JPEG or PNG and try again.', { timeout: 30_000 })
    await expect(scanner.thumbnails).toHaveCount(1)
    await expectStoreCount(page, 'documents', 0)
  })

  test('REG-224 a note page added in the scanner is written on in the pad, saved into the PDF and read by OCR', { tag: ['@P1', '@ocr'] }, async ({ project: _p, app, page, scanner, notePad }) => {
    test.setTimeout(180_000) // one OCR page after the save (10-15 s alone; more under load)
    await scanner.open(app.documents.scan)
    await scanner.addNotePage.click()
    await expect(scanner.layoutPicker).toContainText('Add a note page')
    await scanner.layout('Lined').click()
    await expect(scanner.layoutPicker).toHaveCount(0)
    await expect(scanner.stripCaption).toHaveText('1 page — tap Next to review + write')
    await expect(scanner.dialog.getByText('1 · note')).toBeVisible()

    await scanner.next.click()
    await scanner.write.click()
    await expect(notePad.label).toHaveText('Page 1 / 1')
    await notePad.text.click()
    await page.keyboard.type('NOTEPADWORD')
    await notePad.done.click()
    await expect(notePad.root).toHaveCount(0)

    await scanner.name.fill('Typed Note')
    await scanner.save.click()
    await expect(scanner.dialog).toBeHidden({ timeout: 30_000 })
    await app.viewer.expectDocumentOpen('Typed Note', 1)
    const doc = await documentByName(page, 'Typed Note')
    // The typed text was flattened into the page image: only OCR can read it back.
    await waitForPages(page, doc.id, [1], OCR_PAGE_TIMEOUT)
    const [row] = await searchRows(page, doc.id)
    expect(wordsOf(row.text)).toContain('NOTEPADWORD')
  })

  test('REG-225 the review grid inserts a note page after a photo, appends one from Add page, and deletes a page after asking', { tag: '@P2' }, async ({ project: _p, app, page, scanner }) => {
    await scanner.open(app.documents.scan)
    await scanner.pickImages([await galleryJpeg(page, 'GRIDONE', 'automation-g1.jpg'), await galleryJpeg(page, 'GRIDTWO', 'automation-g2.jpg')])
    await scanner.next.click()
    await expect(scanner.badges).toHaveText(['1', '2'])

    await scanner.insertAfter.first().click()
    await scanner.layout('Grid').click()
    await expect(scanner.badges).toHaveText(['1', '2 · note', '3'])

    await scanner.addPageTile.click()
    await scanner.layout('Blank').click()
    await expect(scanner.badges).toHaveText(['1', '2 · note', '3', '4 · note'])
    await expect(scanner.save).toHaveText('Save (4)')

    let question = answerConfirm(page, false)
    await scanner.deletePage.nth(1).click()
    expect(await question).toBe('Remove the note on page 2 from this scan? It will not be in the saved document.')
    await expect(scanner.badges).toHaveCount(4)
    question = answerConfirm(page, true)
    await scanner.deletePage.nth(0).click()
    expect(await question).toBe('Remove page 1 from this scan? It will not be in the saved document.')
    await expect(scanner.badges).toHaveText(['1 · note', '2', '3 · note'])

    await scanner.save.click()
    await expect(scanner.dialog).toBeHidden({ timeout: 30_000 })
    await expectStoreCount(page, 'documents', 1, () => true, 30_000)
    const [doc] = await readStore<{ name: string; pageCount: number }>(page, 'documents')
    expect(doc.pageCount).toBe(3)
    expect(doc.name).toMatch(/^Scan /) // unnamed scans are called "Scan <date>"
  })

  test('REG-226 the note pad draws ink in the chosen colour and thickness, undoes it, erases it, clears the page, and Cancel keeps the page as it was', { tag: '@P2' }, async ({ project: _p, app, scanner, notePad }) => {
    await scanner.open(app.documents.scan)
    await scanner.addNotePage.click()
    await scanner.layout('Blank').click()
    await scanner.next.click()
    await scanner.write.click()
    await expect(notePad.tool('Text')).toHaveAttribute('aria-pressed', 'true')
    await expect(notePad.undoInk).toBeDisabled()
    const blank = await notePad.inkPixels()

    await notePad.tool('Pen').click()
    await expect(notePad.tool('Pen')).toHaveAttribute('aria-pressed', 'true')
    await notePad.stroke([0.2, 0.3], [0.8, 0.3])
    await expect.poll(() => notePad.inkPixels()).toBeGreaterThan(blank + 50)
    await expect(notePad.undoInk).toBeEnabled()
    await notePad.undoInk.click()
    await expect.poll(() => notePad.inkPixels()).toBe(blank)

    // Colour and thickness: a thick red line has far more red pixels than a thin one.
    await notePad.colour('#dc2626').click()
    await notePad.size('pen', 'S').click()
    await notePad.stroke([0.2, 0.2], [0.8, 0.2])
    const thinRed = await notePad.pixelsOf([220, 38, 38])
    expect(thinRed).toBeGreaterThan(100)
    await notePad.size('pen', 'L').click()
    await notePad.stroke([0.2, 0.7], [0.8, 0.7])
    expect(await notePad.pixelsOf([220, 38, 38])).toBeGreaterThan(thinRed * 2)
    await notePad.undoInk.click()
    await notePad.undoInk.click()
    await expect.poll(() => notePad.pixelsOf([220, 38, 38])).toBe(0)
    await notePad.colour('#1e293b').click()
    await notePad.size('pen', 'M').click()

    await notePad.stroke([0.2, 0.5], [0.8, 0.5])
    const inked = await notePad.inkPixels()
    expect(inked).toBeGreaterThan(blank + 50)
    await notePad.tool('Eraser').click()
    await notePad.stroke([0.5, 0.42], [0.5, 0.58])
    await expect.poll(() => notePad.inkPixels()).toBeLessThan(inked)

    await notePad.tool('Text').click()
    await notePad.text.click()
    await notePad.text.pressSequentially('words')
    await expect(notePad.text).toHaveValue('words')
    await notePad.clear.click()
    await expect(notePad.text).toHaveValue('')
    await expect.poll(() => notePad.inkPixels()).toBe(blank)

    // Cancel leaves the pad without saving what was done in it.
    await notePad.text.pressSequentially('not kept')
    await notePad.cancel.click()
    await expect(notePad.root).toHaveCount(0)
    await scanner.write.click()
    await expect(notePad.text).toHaveValue('')
  })

  test('REG-227 the note pad flips between pages, adds and deletes pages, shows photos read-only, and carries overflowing text onto a new page', { tag: '@P2' }, async ({ project: _p, app, page, scanner, notePad }) => {
    await scanner.open(app.documents.scan)
    await scanner.pickImages([await galleryJpeg(page, 'PHOTOPAGE', 'automation-photo-ref.jpg')])
    await scanner.addNotePage.click()
    await scanner.layout('Lined').click()
    await scanner.next.click()
    await scanner.write.click()
    await expect(notePad.label).toHaveText('Page 2 / 2')
    await expect(notePad.next).toBeDisabled()

    await notePad.prev.click()
    await expect(notePad.label).toHaveText('Page 1 / 2')
    await expect(notePad.photoCaption).toBeVisible()
    await expect(notePad.text).toHaveCount(0)
    await notePad.next.click()
    await expect(notePad.label).toHaveText('Page 2 / 2')

    await notePad.addPage.click()
    await expect(notePad.label).toHaveText('Page 3 / 3')
    const question = answerConfirm(page, true)
    await notePad.deletePage.click()
    expect(await question).toBe('Remove the note on page 3 from this scan? It will not be in the saved document.')
    await expect(notePad.label).toHaveText('Page 2 / 2')

    // A paste far longer than a page continues on new pages instead of being cut off.
    await notePad.text.click()
    await page.keyboard.insertText(Array.from({ length: 120 }, (_, i) => `overflow sentence number ${i}.`).join(' '))
    await expect(notePad.label).toHaveText(/^Page (\d+) \/ \1$/)
    const [, n] = (await notePad.label.innerText()).match(/^Page (\d+)/)!
    expect(Number(n)).toBeGreaterThan(2)
    await expect(notePad.text).toBeFocused()
    await notePad.done.click()
    await expect(scanner.save).toHaveText(`Save (${n})`)
  })
})
