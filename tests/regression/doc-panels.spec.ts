/**
 * Regression: the document pane's panels and modes: focus reading mode
 * (FullScreenToggle), single-page view and its keys (PdfViewModeToggle,
 * SinglePagePdfView), the page index's Contents tab (IndexPanel), the
 * document switcher (DocumentSwitcher), zoom reset per document, Escape on
 * an armed tool, and page virtualisation (PdfPagePlaceholder).
 */
import { test, expect } from '../../fixtures/documents.js'
import { FIND_PDF, SECOND_PDF, LONG_PDF } from '../../data/files.js'
import { OUTLINE_PDF } from '../../data/documents-files.js'
import { readStore } from '../../helpers/idb.js'

test.describe('Document pane modes', { tag: ['@regression', '@viewer'] }, () => {
  test('REG-240 focus reading mode widens the document, hides its tools and find bar, shows the canvas as a timeline, and exits cleanly', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.tool('find').click()
    await expect(app.find.input).toBeVisible()
    const shell = (await app.viewer.pane.locator('xpath=..').boundingBox())!
    const before = (await app.viewer.pane.boundingBox())!.width
    await app.viewer.focusMode.click()
    await expect(app.viewer.exitFocusMode).toBeVisible()
    await expect(app.find.input).toBeHidden()
    await expect(page.locator('button[data-tool]')).toHaveCount(0)
    await expect(app.canvas.timelineToggle).toHaveAttribute('title', 'Canvas view')
    // The split moves to 80 / 20.
    await expect.poll(async () => (await app.viewer.pane.boundingBox())!.width / shell.width).toBeGreaterThan(0.7)

    await app.viewer.exitFocusMode.click()
    await expect(app.viewer.focusMode).toBeVisible()
    await expect(app.viewer.tool('highlight')).toBeVisible()
    await expect(app.find.input).toBeVisible()
    await expect(app.canvas.timelineToggle).toHaveAttribute('title', 'Timeline view')
    await expect.poll(async () => Math.round((await app.viewer.pane.boundingBox())!.width)).toBe(Math.round(before))
  })

  test('REG-241 single-page view turns pages with the arrow keys and the edge buttons, but not while typing in Find', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.singlePageView.click()
    const edgePrev = app.viewer.pane.locator('button.absolute.left-0[aria-label="Previous page"]')
    const edgeNext = app.viewer.pane.locator('button.absolute.right-0[aria-label="Next page"]')
    await expect(edgePrev).toBeHidden() // hidden on page 1
    await page.keyboard.press('ArrowRight')
    await app.viewer.expectPage(2, FIND_PDF.pageCount)
    await page.keyboard.press('ArrowDown')
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
    await page.keyboard.press('ArrowLeft')
    await app.viewer.expectPage(2, FIND_PDF.pageCount)
    await edgeNext.click()
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
    await edgePrev.click()
    await app.viewer.expectPage(2, FIND_PDF.pageCount)

    // Typing in Find: the arrow keys belong to the text box (no matches, so they only move the caret).
    await app.viewer.tool('find').click()
    await app.find.input.fill('XYLOPHONEQUARTZ')
    await expect(app.find.noResults).toHaveText('No results', { timeout: 20_000 })
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) await app.find.input.press(key)
    await expect(app.find.input).toBeFocused()
    await app.viewer.expectPage(2, FIND_PDF.pageCount)
    await app.find.close.click()
    await app.viewer.jumpTo(3)
    await app.viewer.expectPage(3, FIND_PDF.pageCount)
    await app.viewer.next.click()
    await app.viewer.expectPage(4, FIND_PDF.pageCount)
    await expect(edgeNext).toBeHidden()
  })

  test('REG-242 the page index lists the PDF\'s bookmarks under Contents and opens their pages; Close hides the index', { tag: '@P2' }, async ({ project: _p, app, indexPanel }) => {
    await app.documents.uploadFiles(OUTLINE_PDF.payload())
    await app.viewer.expectDocumentOpen(OUTLINE_PDF.displayName, OUTLINE_PDF.pageCount)
    await app.viewer.pageIndexToggle.click()
    await expect(indexPanel.caption).toBeVisible()
    await expect(indexPanel.pagesTab).toBeVisible()
    await expect(indexPanel.thumb(3)).toBeVisible()
    await indexPanel.contentsTab.click()
    for (const o of OUTLINE_PDF.outline) await expect(indexPanel.outlineItem(o.title)).toBeVisible()
    await indexPanel.outlineItem('Results').click()
    await app.viewer.expectPage(3, OUTLINE_PDF.pageCount)
    await indexPanel.outlineItem('Introduction').click()
    await app.viewer.expectPage(1, OUTLINE_PDF.pageCount)
    await indexPanel.close.click()
    await expect(indexPanel.caption).toBeHidden()
  })

  test('REG-243 a PDF without bookmarks has no Contents tab', { tag: '@P3' }, async ({ pdfOpen: app, indexPanel }) => {
    await app.viewer.pageIndexToggle.click()
    await expect(indexPanel.pagesTab).toBeVisible()
    await expect(indexPanel.contentsTab).toHaveCount(0)
    await app.viewer.pageIndexToggle.click()
    await expect(indexPanel.caption).toBeHidden()
  })

  test('REG-244 the document switcher lists the project\'s documents in list order and opens the one chosen, at 100 % zoom', { tag: '@P2' }, async ({ project: _p, app, switcher }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.viewer.zoomIn.click()
    await expect(app.viewer.zoomReset).toHaveText('110%')
    await switcher.button(FIND_PDF.displayName).click()
    await expect(switcher.menu.getByRole('button')).toHaveText([SECOND_PDF.displayName, FIND_PDF.displayName])
    await switcher.option(SECOND_PDF.displayName).click()
    await expect(switcher.menu).toHaveCount(0)
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    await expect(app.viewer.zoomReset).toHaveText('100%')
  })

  test('REG-245 Escape disarms the armed document tool', { tag: '@P3' }, async ({ pdfOpen: app, page, toolbar }) => {
    await app.viewer.tool('select-area').click()
    expect(await toolbar.isArmed('select-area')).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => toolbar.isArmed('select-area')).toBe(false)
    // Nothing is drawn by a drag once the tool is off.
    await app.viewer.dragOnPage(1, [0.08, 0.15], [0.85, 0.21])
    expect(await readStore(page, 'areaLinks')).toEqual([])
  })

  test('REG-246 a long PDF keeps only the pages near the view mounted', { tag: '@P3' }, async ({ project: _p, app }) => {
    await app.documents.uploadFiles(LONG_PDF.payload())
    await app.viewer.expectDocumentOpen(LONG_PDF.displayName, LONG_PDF.pageCount)
    const placeholders = app.viewer.pane.locator('[data-page][data-placeholder="true"]')
    await expect(placeholders.first()).toBeAttached()
    expect(await app.viewer.mountedPages.count()).toBeLessThan(LONG_PDF.pageCount)
    await expect(app.viewer.pageEl(LONG_PDF.pageCount)).toHaveCount(0)
    await app.viewer.jumpTo(LONG_PDF.pageCount)
    await app.viewer.pageRendered(LONG_PDF.pageCount)
    await expect(app.viewer.pageEl(1)).toHaveCount(0)
    // Every page keeps its slot, mounted or not.
    await expect(app.viewer.pane.locator('[data-page]')).toHaveCount(LONG_PDF.pageCount)
  })
})
