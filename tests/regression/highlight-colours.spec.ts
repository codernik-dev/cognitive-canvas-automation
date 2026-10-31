/**
 * Regression: the PDF drawing tool's two tips and six colours, the eraser's
 * four sizes, the palette row's switches and the Undo/Redo buttons
 * (HighlightColorPalette, EraserSizePicker, PinnedToolbar, UndoRedoButtons,
 * PdfHighlightLayer).
 *
 * Each colour is saved as its own hex: the highlighter tip uses the pastel
 * set, the pen tip the saturated set (PdfHighlightLayer.tsx COLOR_HEX /
 * PEN_COLOR_HEX).
 */
import { test, expect } from '../../fixtures/documents.js'
import { COLOUR_HEX, ERASER_RADIUS, type ColourName, type EraserSize } from '../../components/DocumentsTools.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { expectNormalisedPath, expectStrokeAlong } from '../../assertions/geometry.js'
import { FIND_PDF } from '../../data/files.js'

interface HighlightRow { id: string; pageNumber: number; color: string; tip?: string; freehandPath: string }

const COLOURS = Object.keys(COLOUR_HEX) as ColourName[]

/** x range of a stored freehand path (page fractions). */
function xRange(path: string): [number, number] {
  const nums = (path.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) ?? []).map(Number)
  const xs = nums.filter((_, i) => i % 2 === 0)
  return [Math.min(...xs), Math.max(...xs)]
}

test.describe('Highlight colours and tips', { tag: ['@regression', '@annotations'] }, () => {
  test('REG-260 each of the six colours is saved with its own colour value, on the highlighter and on the pen, and comes back after a reload', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    await expect(toolbar.tip('Highlighter')).toHaveAttribute('aria-pressed', 'true')
    const expected: Array<{ color: string; tip: string; y: number }> = []
    for (const [tipIndex, tip] of (['highlighter', 'pen'] as const).entries()) {
      for (const [i, name] of COLOURS.entries()) {
        // The palette opens when the tool is armed and closes on every press in the page: reopen it after each mark.
        if (tipIndex > 0 || i > 0) {
          await expect(toolbar.colour(name)).toBeHidden()
          await toolbar.openPalette.click()
        }
        if (i === 0) {
          await toolbar.tip(tip === 'pen' ? 'Pen' : 'Highlighter').click()
          await expect(toolbar.tip(tip === 'pen' ? 'Pen' : 'Highlighter')).toHaveAttribute('aria-pressed', 'true')
        }
        await toolbar.colour(name).click()
        const y = 0.3 + tipIndex * 0.3 + i * 0.04
        await app.viewer.dragOnPage(1, [0.15, y], [0.6, y])
        expected.push({ color: COLOUR_HEX[name][tip], tip, y })
      }
    }
    await expectStoreCount(page, 'highlights', 12)
    const rows = (await readStore<HighlightRow>(page, 'highlights'))
    const byY = (r: HighlightRow) => Number((r.freehandPath.match(/-?\d+(\.\d+)?/g) ?? [])[1])
    rows.sort((a, b) => byY(a) - byY(b))
    expect(rows.map((r) => [r.color, r.tip])).toEqual(expected.map((e) => [e.color, e.tip]))
    for (const [i, r] of rows.entries()) {
      expect(r.pageNumber).toBe(1)
      expectNormalisedPath(r.freehandPath)
      // Each stroke is stored exactly along the line it was drawn on.
      expectStrokeAlong(r.freehandPath, [0.15, expected[i].y], [0.6, expected[i].y])
    }
    // Drawn on the page in the stored colour.
    for (const e of expected) await expect(page.locator(`g[data-highlight-id] path[stroke="${e.color}"]`).first()).toBeAttached()

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(app.viewer.highlights).toHaveCount(12)
    for (const e of expected) await expect(page.locator(`g[data-highlight-id] path[stroke="${e.color}"]`).first()).toBeAttached()
  })

  test('REG-261 each eraser size cuts a gap as wide as its circle', { tag: '@P2' }, async ({ pdfOpen: app, page, toolbar }) => {
    const sizes = Object.keys(ERASER_RADIUS) as EraserSize[]
    const rows = [0.4, 0.52, 0.64, 0.76]
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    for (const y of rows) await app.viewer.dragOnPage(1, [0.1, y], [0.9, y], 40)
    await expectStoreCount(page, 'highlights', 4)
    const pageWidth = (await app.viewer.canvasOf(1).boundingBox())!.width

    await app.viewer.tool('highlight-eraser').click()
    for (const [i, size] of sizes.entries()) {
      // The size row opens with the eraser and closes on each press in the page.
      if (i > 0) await toolbar.openPalette.click()
      await toolbar.eraserSize(size).click()
      await app.viewer.dragOnPage(1, [0.5, rows[i] - 0.03], [0.5, rows[i] + 0.03], 20)
    }
    await expectStoreCount(page, 'highlights', 8)
    const pieces = await readStore<HighlightRow>(page, 'highlights')
    for (const [i, size] of sizes.entries()) {
      const onRow = pieces
        .filter((p) => Math.abs(Number((p.freehandPath.match(/-?\d+(\.\d+)?/g) ?? [])[1]) - rows[i]) < 0.02)
        .map((p) => xRange(p.freehandPath))
        .sort((a, b) => a[0] - b[0])
      expect(onRow, `two pieces left on the ${size} row`).toHaveLength(2)
      const gapPx = (onRow[1][0] - onRow[0][1]) * pageWidth
      // The cut is the circle's chord through its centre: 2 x radius, within a few pixels of path sampling.
      expect(gapPx, `${size} eraser gap`).toBeGreaterThan(2 * ERASER_RADIUS[size] - 6)
      expect(gapPx, `${size} eraser gap`).toBeLessThan(2 * ERASER_RADIUS[size] + 6)
    }
  })

  test('REG-262 the palette row switches between highlighter and eraser, and its chevron closes and reopens it', { tag: '@P3' }, async ({ pdfOpen: app, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.colour('Important')).toBeVisible()
    await toolbar.closePalette.click()
    await expect(toolbar.colour('Important')).toBeHidden()
    await toolbar.openPalette.click()
    await expect(toolbar.colour('Important')).toBeVisible()

    await toolbar.switchToEraser.click()
    expect(await toolbar.isArmed('highlight-eraser')).toBe(true)
    for (const size of Object.keys(ERASER_RADIUS) as EraserSize[]) await expect(toolbar.eraserSize(size)).toBeVisible()
    await expect(toolbar.colour('Important')).toBeHidden()
    await toolbar.switchToHighlighter.click()
    expect(await toolbar.isArmed('highlight')).toBe(true)
    await expect(toolbar.colour('Important')).toBeVisible()

    // Clicking the armed tool again disarms it and the row goes.
    await app.viewer.tool('highlight').click()
    expect(await toolbar.isArmed('highlight')).toBe(false)
    await expect(toolbar.colour('Important')).toBeHidden()
  })

  test('REG-263 the Undo and Redo buttons appear after the first mark, name what they undo, and step highlights and erases back and forth', { tag: ['@P1'] }, async ({ pdfOpen: app, page, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    await expect(toolbar.undo).toHaveCount(0)
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    await expectStoreCount(page, 'highlights', 1)
    const [drawn] = await readStore<HighlightRow>(page, 'highlights')
    await expect(toolbar.undo).toBeEnabled()
    await expect(toolbar.undo).toHaveAttribute('title', 'Undo highlight (Ctrl+Z)')
    await expect(toolbar.redo).toBeDisabled()
    await expect(toolbar.redo).toHaveAttribute('title', 'Nothing to redo (Ctrl+Y)')

    await toolbar.undo.click()
    await app.toasts.expectShown('Undid highlight')
    await expect(app.viewer.highlights).toHaveCount(0)
    await expectStoreCount(page, 'highlights', 0)
    await expect(toolbar.redo).toHaveAttribute('title', 'Redo highlight (Ctrl+Y)')
    await toolbar.redo.click()
    await app.toasts.expectShown('Redid highlight')
    await expect(app.viewer.highlights).toHaveCount(1)
    await expectStoreCount(page, 'highlights', 1)
    const [original] = await readStore<HighlightRow>(page, 'highlights')
    // Redo restores the very highlight that was undone.
    expect(original).toMatchObject({ id: drawn.id, pageNumber: drawn.pageNumber, color: drawn.color, freehandPath: drawn.freehandPath })

    // An erase is one undo step, and Ctrl+Shift+Z redoes it as well as Ctrl+Y.
    await app.viewer.tool('highlight-eraser').click()
    await app.viewer.dragOnPage(1, [0.05, 0.1], [0.9, 0.25], 30)
    await expect.poll(async () => (await readStore<HighlightRow>(page, 'highlights')).some((h) => h.id === original.id)).toBe(false)
    const byPath = (rows: HighlightRow[]) => rows.map((h) => h.freehandPath).sort()
    const erased = byPath(await readStore<HighlightRow>(page, 'highlights'))
    await expect(toolbar.undo).toHaveAttribute('title', 'Undo erase (Ctrl+Z)')
    await toolbar.undo.click()
    await app.toasts.expectShown('Undid erase')
    await expect.poll(async () => (await readStore<HighlightRow>(page, 'highlights')).map((h) => h.id)).toEqual([original.id])
    await page.keyboard.press('Control+Shift+Z')
    await app.toasts.expectShown('Redid erase')
    await expect.poll(async () => (await readStore<HighlightRow>(page, 'highlights')).some((h) => h.id === original.id)).toBe(false)
    // Redoing the erase brings back the same cut pieces, not just "the original is gone".
    await expect.poll(async () => byPath(await readStore<HighlightRow>(page, 'highlights'))).toEqual(erased)

    // The pen tip names its own step.
    await app.viewer.tool('highlight').click()
    await toolbar.tip('Pen').click()
    await app.viewer.dragOnPage(1, [0.2, 0.5], [0.6, 0.5])
    await expect(toolbar.undo).toHaveAttribute('title', 'Undo pen mark (Ctrl+Z)')
  })
})
