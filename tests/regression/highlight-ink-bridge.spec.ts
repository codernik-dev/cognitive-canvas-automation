/**
 * Regression: linking a PDF highlight to pen strokes on the canvas, and the
 * bridge drawn between them (shared/HighlightStrokeBridge.tsx,
 * items/StrokeLinkHitLayer.tsx, items/CanvasStrokeLayer.tsx,
 * documents/PdfHighlightLayer.tsx click-to-link, canvas/useCanvasTools.ts).
 *
 * Flow (Settings › Shortcuts, "Click highlight + draw"): draw a highlight,
 * switch the Highlight tool off, click the highlight, then draw with the pen.
 * The bridge is a DOM-drawn <g> in an unlabelled overlay svg; it is found by
 * the filter it carries (#bridge-glow), and its geometry is compared with the
 * highlight and the strokes it joins.
 */
import { test, expect, type StrokeRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF } from '../../data/files.js'
import type { Locator, Page } from '@playwright/test'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { CanvasWorkbench } from '../../components/CanvasWorkbench.js'

interface LinkRow { id: string; highlightId: string; strokeIds: string[] }

const bridge = (page: Page) => page.locator('svg:has(#bridge-glow) > g')
/**
 * A point on the drawn highlight. The stroke is a horizontal line, so its
 * geometric box has no height and Playwright treats it as invisible; the
 * pointer is therefore moved to the line itself (40 % along, at 17 % down the
 * page, where armHighlight drew it), which is where a user would point.
 */
async function onHighlight(app: CognitiveCanvas, pageNo: number) {
  const box = (await app.viewer.canvasOf(pageNo).boundingBox())!
  return { x: box.x + box.width * 0.41, y: box.y + box.height * 0.17 }
}
/** Centre of the highlight's drawn extent, from its own client rect. */
const centreOf = (hl: Locator) => hl.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })

/** Draw a highlight on `pageNo`, switch the tool off, and arm it for linking by clicking it. */
async function armHighlight(app: CognitiveCanvas, page: Page, pageNo = 1) {
  // Pages are virtualised: bring the page into view before drawing on it.
  if (pageNo !== 1) { await app.viewer.jumpTo(pageNo); await app.viewer.expectPage(pageNo, FIND_PDF.pageCount) }
  await app.viewer.tool('highlight').click()
  await app.viewer.dragOnPage(pageNo, [0.12, 0.17], [0.7, 0.17])
  await expectStoreCount(page, 'highlights', 1)
  await app.viewer.tool('highlight').click()
  const hl = app.viewer.highlights.first()
  const [h] = await readStore<{ id: string }>(page, 'highlights')
  await expect(hl).toHaveAttribute('data-highlight-id', h.id)
  await expect(hl.locator('path')).toHaveCount(2) // main stroke + hit target
  const at = await onHighlight(app, pageNo)
  await page.mouse.click(at.x, at.y)
  // Armed: a pulsing outline in the primary colour joins the stroke.
  await expect(hl.locator('path[stroke="var(--color-primary-500)"]')).toHaveCount(1)
  return { hl, highlightId: h.id, at }
}

async function penStroke(ws: CanvasWorkbench, fy: number, fx0 = 0.3, fx1 = 0.6) {
  await ws.horizontalStroke(fy, fx0, fx1)
}

/** A screen point on a stroke (its middle sample): like the highlight, a straight stroke has a zero-height box. */
async function onStroke(ws: CanvasWorkbench, stroke: StrokeRow) {
  return ws.worldToScreen(stroke.points[Math.floor(stroke.points.length / 2)])
}

/** Screen centre of the strokes' world bounding box. */
async function strokesCentre(ws: CanvasWorkbench, strokes: StrokeRow[]) {
  const pts = strokes.flatMap((s) => s.points)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return ws.worldToScreen({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 })
}

/** Bridge ends in page coordinates (its paths are drawn in the overlay svg's own pixels). */
async function bridgeEnds(page: Page) {
  return bridge(page).evaluate((g) => {
    const svg = (g as SVGGElement).ownerSVGElement!.getBoundingClientRect()
    const d = g.querySelectorAll('path')[1]?.getAttribute('d') ?? ''
    const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    return { shown: (g as SVGGElement).style.opacity === '1', from: { x: svg.left + n[0], y: svg.top + n[1] }, to: { x: svg.left + n[n.length - 2], y: svg.top + n[n.length - 1] } }
  })
}

test.describe('Highlight to ink links', { tag: ['@regression', '@canvas', '@links'] }, () => {
  test('REG-094 hovering a highlight linked to pen strokes draws a bridge from the highlight to the strokes, and both glow', { tag: ['@P2', '@sanity'] }, async ({ pdfOpen: app, ws, page }) => {
    const { hl, at } = await armHighlight(app, page)
    await ws.tool('ink').click()
    await penStroke(ws, 0.55)
    await expectStoreCount(page, 'highlightStrokeLinks', 1)
    const strokes = await readStore<StrokeRow>(page, 'canvasStrokes')

    await page.mouse.move(at.x, at.y)
    const hlCentre = await centreOf(hl)
    const target = await strokesCentre(ws, strokes)
    await expect.poll(async () => {
      const b = await bridgeEnds(page)
      const fromOff = Math.max(Math.abs(b.from.x - hlCentre.x), Math.abs(b.from.y - hlCentre.y))
      const toOff = Math.max(Math.abs(b.to.x - target.x), Math.abs(b.to.y - target.y))
      return b.shown && fromOff < 3 && toOff < 3 ? 'joined' : `shown=${b.shown} from off ${fromOff.toFixed(1)} px, to off ${toOff.toFixed(1)} px`
    }, { message: 'bridge joins the highlight centre to the strokes centre' }).toBe('joined')
    // Both sides glow while hovered.
    await expect(ws.strokeGroups.locator('path.animate-pulse')).toHaveCount(1)
    await expect(hl.locator('path.animate-pulse')).not.toHaveCount(0)

    // Away from both: the bridge fades out. Hovering the stroke brings it back.
    const empty = await ws.at(0.15, 0.9)
    await page.mouse.move(empty.x, empty.y)
    await expect.poll(async () => (await bridgeEnds(page)).shown).toBe(false)
    const onIt = await onStroke(ws, strokes[0])
    await page.mouse.move(onIt.x, onIt.y)
    await expect.poll(async () => (await bridgeEnds(page)).shown).toBe(true)
  })

  test('REG-396 every stroke drawn while a highlight is armed joins its link; switching to another tool ends the linking', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    const { highlightId } = await armHighlight(app, page)
    await ws.tool('ink').click()
    await penStroke(ws, 0.5)
    await penStroke(ws, 0.6)
    await expectStoreCount(page, 'canvasStrokes', 2)
    await expect.poll(async () => (await readStore<LinkRow>(page, 'highlightStrokeLinks'))[0]?.strokeIds.length).toBe(2)
    const first = (await readStore<StrokeRow>(page, 'canvasStrokes')).map((s) => s.id).sort()
    const [link] = await readStore<LinkRow>(page, 'highlightStrokeLinks')
    expect(link.highlightId).toBe(highlightId)
    expect([...link.strokeIds].sort()).toEqual(first)

    // Note tool, then Draw again: this stroke is ordinary ink.
    await ws.tool('note').click()
    await ws.tool('ink').click()
    await penStroke(ws, 0.75)
    await expectStoreCount(page, 'canvasStrokes', 3)
    await expect(ws.linkedStrokeHits).toHaveCount(2)
    const [after] = await readStore<LinkRow>(page, 'highlightStrokeLinks')
    expect([...after.strokeIds].sort()).toEqual(first)
    await expectStoreCount(page, 'highlightStrokeLinks', 1)

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(ws.linkedStrokeHits).toHaveCount(2)
  })

  test('REG-397 clicking a linked highlight brings its strokes to the middle of the canvas; clicking a linked stroke scrolls the PDF back to the highlight', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    const { at } = await armHighlight(app, page, 2)
    await ws.tool('ink').click()
    await penStroke(ws, 0.8, 0.6, 0.85)
    await expectStoreCount(page, 'highlightStrokeLinks', 1)
    await ws.tool('ink').click() // back to Pan
    const strokes = await readStore<StrokeRow>(page, 'canvasStrokes')

    // Highlight -> strokes: pan the canvas away, then click the highlight.
    await ws.panBy(250, -150, [0.3, 0.3])
    await page.mouse.click(at.x, at.y)
    const surface = await ws.surfaceBox()
    await expect.poll(async () => {
      const c = await strokesCentre(ws, strokes)
      return Math.round(Math.max(Math.abs(c.x - (surface.x + surface.width / 2)), Math.abs(c.y - (surface.y + surface.height / 2))))
    }, { message: 'strokes centred on the canvas' }).toBeLessThan(3)

    // Stroke -> highlight: move the PDF away, then click the stroke.
    await app.viewer.jumpTo(4)
    await app.viewer.expectPage(4, FIND_PDF.pageCount)
    const onIt = await onStroke(ws, strokes[0])
    await page.mouse.click(onIt.x, onIt.y)
    await app.viewer.expectPage(2, FIND_PDF.pageCount)
  })

  test('REG-398 erasing part of a linked stroke keeps what is left linked to the highlight', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    knownDefect('DEF-303')
    const { at } = await armHighlight(app, page)
    await ws.tool('ink').click()
    await penStroke(ws, 0.55, 0.25, 0.75)
    await expectStoreCount(page, 'highlightStrokeLinks', 1)
    await ws.tool('eraser').click()
    await ws.eraserSize('Large').click()
    await ws.drag(await ws.at(0.5, 0.45), await ws.at(0.5, 0.65), { steps: 20 })
    await expectStoreCount(page, 'canvasStrokes', 2)
    const pieces = (await readStore<StrokeRow>(page, 'canvasStrokes')).map((s) => s.id).sort()
    await expect.poll(async () => [...((await readStore<LinkRow>(page, 'highlightStrokeLinks'))[0]?.strokeIds ?? [])].sort(), { message: 'the link names the surviving pieces' }).toEqual(pieces)
    await ws.tool('eraser').click()
    await page.mouse.move(at.x, at.y)
    await expect.poll(async () => (await bridgeEnds(page)).shown).toBe(true)
  })
})
