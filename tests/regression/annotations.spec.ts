/**
 * Regression: freehand highlighting on the PDF, its colours, the eraser and
 * undo/redo (PdfHighlightLayer.tsx, historySlice.ts). Highlights are stored
 * as page-normalised (0..1) SVG paths, so they must not move on zoom.
 */
import { test, expect } from '../../fixtures/documents.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { expectNormalisedPath, expectStrokeAlong, pathPoints } from '../../assertions/geometry.js'

interface HighlightRow { id: string; pageNumber: number; color: string; tip?: string; freehandPath: string }

test.describe('PDF highlighting', { tag: ['@regression', '@annotations'] }, () => {
  test('REG-042 a highlight drawn on a page is saved with normalised coordinates and the chosen colour', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    await app.viewer.colour('Critical').click()
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    await expect(app.viewer.highlights).toHaveCount(1)
    await expectStoreCount(page, 'highlights', 1)
    const [h] = await readStore<HighlightRow>(page, 'highlights')
    expect(h.pageNumber).toBe(1)
    // Critical on the default highlighter tip (the pen tip would save #dc2626; REG-260 covers both tips).
    expect(h.color).toBe('#fca5a5')
    expect(h.tip).toBe('highlighter')
    expectNormalisedPath(h.freehandPath)
    // Saved exactly where it was drawn: from 12 % to 70 % across, at 17 % down the page.
    expectStrokeAlong(h.freehandPath, [0.12, 0.17], [0.7, 0.17])
    // And drawn there on screen: the mark's box spans the drag on the page canvas.
    const canvas = (await app.viewer.canvasOf(1).boundingBox())!
    const mark = (await app.viewer.highlights.first().locator('path').first().boundingBox())!
    const px = (f: number) => canvas.x + canvas.width * f
    expect(Math.abs(mark.x - px(0.12))).toBeLessThanOrEqual(12) // the stroke's half-width plus its round cap
    expect(Math.abs(mark.x + mark.width - px(0.7))).toBeLessThanOrEqual(12)
    expect(Math.abs(mark.y + mark.height / 2 - (canvas.y + canvas.height * 0.17))).toBeLessThanOrEqual(4)
  })

  test('REG-043 Ctrl+Z removes the last highlight and Ctrl+Y brings it back', { tag: '@P2' }, async ({ pdfOpen: app, page, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    await expect(app.viewer.highlights).toHaveCount(1)
    await expectStoreCount(page, 'highlights', 1)
    const pick = ({ id, pageNumber, color, tip, freehandPath }: HighlightRow) => ({ id, pageNumber, color, tip, freehandPath })
    const before = (await readStore<HighlightRow>(page, 'highlights')).map(pick)
    await page.keyboard.press('Control+z')
    await expect(app.viewer.highlights).toHaveCount(0)
    await expectStoreCount(page, 'highlights', 0)
    await page.keyboard.press('Control+y')
    await expect(app.viewer.highlights).toHaveCount(1)
    // Redo brings back the same highlight: same id, page, colour, tip and path.
    await expect.poll(async () => (await readStore<HighlightRow>(page, 'highlights')).map(pick)).toEqual(before)
  })

  test('REG-044 the eraser removes a highlight it passes over', { tag: '@P2' }, async ({ pdfOpen: app, page, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    // A second highlight, well away from where the eraser will go.
    await app.viewer.dragOnPage(1, [0.12, 0.6], [0.7, 0.6])
    await expectStoreCount(page, 'highlights', 2) // the save is debounced 300 ms
    const rows = await readStore<HighlightRow>(page, 'highlights')
    const crossed = rows.find((h) => pathPoints(h.freehandPath)[0][1] < 0.3)!
    const away = rows.find((h) => h.id !== crossed.id)!
    await app.viewer.tool('highlight-eraser').click()
    // A diagonal pass that crosses the first stroke's line (y 0.17) at x ≈ 0.45.
    await app.viewer.dragOnPage(1, [0.05, 0.1], [0.9, 0.25], 30)
    await expect.poll(async () => (await readStore<HighlightRow>(page, 'highlights')).some((h) => h.id === crossed.id)).toBe(false)
    const after = await readStore<HighlightRow>(page, 'highlights')
    // The untouched highlight is exactly as it was.
    expect(after.find((h) => h.id === away.id)).toMatchObject({ freehandPath: away.freehandPath, color: away.color, tip: away.tip })
    // The crossed one is cut where the eraser passed: what is left keeps its page, colour and tip,
    // reaches both original ends, and no piece runs across the crossing point.
    const pieces = after.filter((h) => h.id !== away.id)
    expect(pieces.length).toBeGreaterThanOrEqual(1)
    const crossX = 0.05 + ((0.17 - 0.1) / (0.25 - 0.1)) * (0.9 - 0.05)
    for (const h of pieces) {
      expect(h).toMatchObject({ pageNumber: 1, color: crossed.color, tip: crossed.tip })
      const xs = pathPoints(h.freehandPath).map((p) => p[0])
      expect(Math.max(...xs) < crossX || Math.min(...xs) > crossX, `a piece spans ${Math.min(...xs).toFixed(3)}-${Math.max(...xs).toFixed(3)} across the cut at ${crossX.toFixed(3)}`).toBe(true)
    }
    const allXs = pieces.flatMap((h) => pathPoints(h.freehandPath).map((p) => p[0]))
    expect(Math.min(...allXs)).toBeCloseTo(0.12, 1)
    expect(Math.max(...allXs)).toBeCloseTo(0.7, 1)
  })

  test('REG-045 a highlight scales with the page on zoom and its stored path does not change', { tag: '@P2' }, async ({ pdfOpen: app, page, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    const path = app.viewer.highlights.first().locator('path').first()
    await expect(path).toBeAttached()
    const d0 = await path.getAttribute('d')
    const w0 = (await path.boundingBox())!.width
    await app.viewer.zoomIn.click()
    await app.viewer.zoomIn.click()
    await expect(app.viewer.zoomReset).toHaveText('120%')
    await expect.poll(async () => (await path.boundingBox())!.width / w0).toBeCloseTo(1.2, 1)
    expect(await path.getAttribute('d')).toBe(d0)
    expect((await readStore<HighlightRow>(page, 'highlights'))[0].freehandPath).toBe(d0)
  })
})
