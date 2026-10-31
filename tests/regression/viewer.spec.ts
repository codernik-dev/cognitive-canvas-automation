/** Regression: PDF page navigation, zoom, view modes, page index. */
import { test, expect } from '../../fixtures/test.js'
import { FIND_PDF, LONG_PDF } from '../../data/files.js'
import { readStore } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'

test.describe('PDF navigation', { tag: ['@regression', '@viewer'] }, () => {
  test('REG-025 Previous is disabled on page 1 and Next on the last page', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    await expect(app.viewer.prev).toBeDisabled()
    for (let p = 2; p <= FIND_PDF.pageCount; p++) {
      await app.viewer.next.click()
      await app.viewer.expectPage(p, FIND_PDF.pageCount)
    }
    await expect(app.viewer.next).toBeDisabled()
    await app.viewer.pageRendered(FIND_PDF.pageCount)
  })

  test('REG-026 typing a page number jumps there; out-of-range numbers are clamped', { tag: ['@P2', '@sanity'] }, async ({ pdfOpen: app }) => {
    await app.viewer.jumpTo(3)
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
    await app.viewer.pageRendered(3)
    await app.viewer.jumpTo(99)
    await app.viewer.expectPage(FIND_PDF.pageCount, FIND_PDF.pageCount)
    await app.viewer.jumpTo(0)
    await app.viewer.expectPage(1, FIND_PDF.pageCount)
  })

  test('REG-027 the page index thumbnails navigate to their page', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.pageIndexToggle.click()
    // Opening the index narrows the document pane, and the viewer re-anchors to the page in view
    // shortly afterwards. A thumbnail clicked inside that window can be thrown back to page 1
    // (DEF-212, intermittent), so wait until page 1 sits at the top of the pane again.
    await expect
      .poll(async () => {
        const pane = (await app.viewer.scroller.boundingBox())!
        const first = (await app.viewer.pageEl(1).boundingBox())!
        return Math.round(first.y - pane.y)
      }, { message: 'document re-anchored to page 1 after the pane resized' })
      .toBe(0)
    const thumb = page.locator('button[data-thumb-page="3"]')
    // Thumbnails render lazily; a user clicks a drawn thumbnail, so wait for its image.
    await expect(thumb.getByRole('img', { name: 'Page 3' })).toBeVisible()
    await thumb.click()
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
  })

  test('REG-028 a 40-page PDF reaches and draws its last page (page virtualisation)', { tag: '@P2' }, async ({ project: _p, app }) => {
    await app.documents.uploadFiles(LONG_PDF.payload())
    await app.viewer.expectDocumentOpen(LONG_PDF.displayName, LONG_PDF.pageCount)
    await app.viewer.jumpTo(LONG_PDF.pageCount)
    await app.viewer.expectPage(LONG_PDF.pageCount, LONG_PDF.pageCount)
    await app.viewer.pageRendered(LONG_PDF.pageCount)
    await expect(app.viewer.pageEl(LONG_PDF.pageCount)).toContainText(`Marker LONGPAGE${LONG_PDF.pageCount}`)
  })
})

test.describe('PDF zoom and view modes', { tag: ['@regression', '@viewer'] }, () => {
  test('REG-029 zoom steps by 10 %, resets to 100 %, and stays within 50-250 %', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    await expect(app.viewer.zoomReset).toHaveText('100%')
    // The page itself is measured, not just the label: the drawn page canvas follows the zoom
    // (desktop scale = zoom / 100 of the page's own size, PdfViewer.tsx).
    await app.viewer.pageRendered(1)
    const pageWidth = async () => (await app.viewer.canvasOf(1).boundingBox())!.width
    const width100 = await pageWidth()
    const scaled = (ratio: number) => expect.poll(async () => (await pageWidth()) / width100, { message: `page drawn at ${ratio * 100} %` }).toBeCloseTo(ratio, 1)
    await app.viewer.zoomIn.click()
    await expect(app.viewer.zoomReset).toHaveText('110%')
    await scaled(1.1)
    await app.viewer.zoomReset.click()
    await expect(app.viewer.zoomReset).toHaveText('100%')
    await scaled(1)
    for (let i = 0; i < 8 && (await app.viewer.zoomOut.isEnabled()); i++) await app.viewer.zoomOut.click()
    expect(await app.viewer.zoomPercent()).toBe(50)
    await expect(app.viewer.zoomOut).toBeDisabled()
    await scaled(0.5)
    await app.viewer.zoomReset.click()
    for (let i = 0; i < 20 && (await app.viewer.zoomIn.isEnabled()); i++) await app.viewer.zoomIn.click()
    expect(await app.viewer.zoomPercent()).toBe(250)
    await expect(app.viewer.zoomIn).toBeDisabled()
    await scaled(2.5)
    await app.viewer.pageRendered(1)
  })

  test('REG-030 single-page view shows one page at a time and switches back', { tag: '@P3' }, async ({ pdfOpen: app }) => {
    await expect(app.viewer.mountedPages).toHaveCount(FIND_PDF.pageCount)
    await app.viewer.singlePageView.click()
    await expect(app.viewer.continuousView).toBeVisible()
    await expect(app.viewer.mountedPages).toHaveCount(1)
    await expect(app.viewer.pageEl(1)).toBeAttached()
    await app.viewer.next.click()
    await app.viewer.expectPage(2, FIND_PDF.pageCount)
    await app.viewer.pageRendered(2)
    // Next replaced page 1 with page 2.
    await expect(app.viewer.mountedPages).toHaveCount(1)
    await expect(app.viewer.pageEl(1)).toHaveCount(0)
    await app.viewer.continuousView.click()
    await expect(app.viewer.singlePageView).toBeVisible()
    await expect(app.viewer.mountedPages).toHaveCount(FIND_PDF.pageCount)
  })

  test('REG-031 the page you were reading is restored when the document is reopened', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    knownDefect('DEF-213')
    await app.viewer.jumpTo(3)
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
    await app.viewer.backToDocuments.click()
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
  })
})

test.describe('Reading position across sessions', { tag: ['@regression', '@viewer', '@persistence'] }, () => {
  test('REG-248 the page you were reading is restored after the app is reloaded', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    knownDefect('DEF-208')
    await app.viewer.jumpTo(3)
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
    await app.reload()
    await expect(app.viewer.documentTitle(FIND_PDF.displayName)).toBeVisible({ timeout: 30_000 })
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
    const [doc] = await readStore<{ lastReadPage: number }>(page, 'documents')
    expect(doc.lastReadPage).toBe(3)
  })
})
