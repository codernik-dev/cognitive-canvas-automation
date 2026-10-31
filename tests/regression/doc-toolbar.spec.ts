/**
 * Regression: the PDF tools toolbar, pinned and floating (DocumentToolbar,
 * PinnedToolbar, FloatingToolbar). The choice is remembered in localStorage
 * (cc2_toolbar_pinned: '1' pinned, '0' floating).
 */
import { test, expect } from '../../fixtures/documents.js'
import { FIND_PDF } from '../../data/files.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { localStorageValue } from '../../helpers/documents.js'

test.describe('Document toolbar', { tag: ['@regression', '@doc-toolbar'] }, () => {
  test('REG-280 unpinning turns the toolbar into a floating pill whose tools work, the choice survives a reload, and pinning brings it back', { tag: ['@P2'] }, async ({ pdfOpen: app, page, toolbar }) => {
    expect(await localStorageValue(page, 'cc2_toolbar_pinned')).toBe('1')
    await toolbar.unpin.click()
    await expect(toolbar.floating).toBeVisible()
    await expect(toolbar.unpin).toHaveCount(0)
    await expect.poll(() => localStorageValue(page, 'cc2_toolbar_pinned')).toBe('0')
    // Collapsed: the tool list is folded away.
    await expect(toolbar.floatingList).toHaveCSS('opacity', '0')

    await toolbar.expandFloating()
    await app.viewer.tool('select-area').click()
    await expect(toolbar.floatingList).toHaveCSS('opacity', '0')
    expect(await toolbar.isArmed('select-area')).toBe(true)
    await app.viewer.dragOnPage(1, [0.08, 0.15], [0.85, 0.21])
    await expectStoreCount(page, 'areaLinks', 1)
    // The pill sits over the page, yet the drag went to the page: the stored region is the dragged one,
    // and the note it made quotes the line under it.
    const [link] = await readStore<{ workspaceItemId: string; rect: { x: number; y: number; width: number; height: number } }>(page, 'areaLinks')
    expect(link.rect.x).toBeCloseTo(0.08, 2)
    expect(link.rect.y).toBeCloseTo(0.15, 2)
    expect(link.rect.width).toBeCloseTo(0.77, 2)
    expect(link.rect.height).toBeCloseTo(0.06, 2)
    const note = (await readStore<{ id: string; data: { sourceExcerpt?: string } }>(page, 'workspaceItems')).find((i) => i.id === link.workspaceItemId)
    expect(note?.data.sourceExcerpt).toMatch(/^The quick brown fox jumps over the lazy dog\./)

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(toolbar.floating).toBeVisible()
    await expect(toolbar.unpin).toHaveCount(0)
    await toolbar.expandFloating()
    await toolbar.pin.click()
    await expect(toolbar.unpin).toBeVisible()
    await expect(toolbar.floating).toHaveCount(0)
    await expect.poll(() => localStorageValue(page, 'cc2_toolbar_pinned')).toBe('1')
    await expect(app.viewer.tool('highlight')).toBeVisible()
  })

  test('REG-281 the floating pill can be dragged to another spot in the document pane', { tag: '@P3' }, async ({ pdfOpen: _app, page, toolbar }) => {
    await toolbar.unpin.click()
    await expect(toolbar.floating).toBeVisible()
    const start = (await toolbar.floating.boundingBox())!
    const grab = { x: start.x + start.width / 2, y: start.y + 20 }
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    // The pill only starts moving once it has been held for 150 ms (a quick click toggles it instead),
    // so keep nudging the pointer until it follows.
    let n = 0
    await expect
      .poll(async () => {
        n++
        await page.mouse.move(grab.x + 150 + (n % 2), grab.y + 200)
        return Math.round((await toolbar.floating.boundingBox())!.x - start.x)
      }, { intervals: [60, 100, 150, 200], message: 'pill follows the drag' })
      .toBeGreaterThan(140)
    await page.mouse.up()
    const end = (await toolbar.floating.boundingBox())!
    expect(end.x - start.x).toBeGreaterThan(140)
    expect(end.y - start.y).toBeGreaterThan(190)
    // A drag is not a click: the tool list stays folded.
    await expect(toolbar.floatingList).toHaveCSS('opacity', '0')
  })

  test('REG-282 the tools that need a canvas item say so until one is selected', { tag: '@P2' }, async ({ pdfOpen: app, toolbar }) => {
    await expect(app.viewer.tool('link-area')).toHaveAttribute('aria-label', 'Link Area (select item first)')
    await expect(toolbar.linkDoc).toBeDisabled()
    await expect(toolbar.linkDoc).toHaveAttribute('aria-label', 'Link Doc (select item first)')
    for (const [tool, label] of [['select-area', 'Select Area'], ['highlight', 'Highlight'], ['highlight-eraser', 'Eraser'], ['extract-image', 'Extract Image'], ['ocr', 'OCR'], ['find', 'Find in document']] as const) {
      await expect(app.viewer.tool(tool)).toHaveAttribute('aria-label', label)
      await expect(app.viewer.tool(tool)).toBeEnabled()
    }
    // Desktop has no Pan tool (the page scrolls with the wheel).
    await expect(app.viewer.tool('pan')).toHaveCount(0)
    await app.canvas.place('note', 0.5, 0.4)
    await expect(app.viewer.tool('link-area')).toHaveAttribute('aria-label', 'Link Area')
    await expect(toolbar.linkDoc).toBeEnabled()
    await expect(toolbar.linkDoc).toHaveAttribute('aria-label', 'Link to document')
  })

  test('REG-283 the toolbar\'s Tool guide opens the Document Tools guide in Settings', { tag: '@P3' }, async ({ pdfOpen: app, page, toolbar }) => {
    await toolbar.toolGuide.click()
    await expect(app.settings.heading).toBeVisible()
    await expect(page.getByText('Document Tools', { exact: true }).first()).toBeVisible()
    expect(await readStore(page, 'workspaceItems')).toEqual([])
  })
})
