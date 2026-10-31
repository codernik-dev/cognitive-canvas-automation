/**
 * Regression: the workspace tool palette (WorkspaceToolPalette.tsx) and the
 * tools behind it (workspace/tools/*.ts): what each places, where, with which
 * stored fields, and what the Draw / Eraser drawers change. Positions are
 * compared in WORLD units converted through the live transform.
 */
import { test, expect, type ItemRow, type StrokeRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF } from '../../data/files.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { CanvasWorkbench, EraserSize, InkColour, Point } from '../../components/CanvasWorkbench.js'

const INK_HEX: Record<InkColour, string> = {
  Amber: '#f59e0b', Teal: '#14b8a6', Red: '#ef4444', Green: '#22c55e', Pink: '#ec4899', Violet: '#8b5cf6', Black: '#2c2a25', White: '#ffffff',
}
const ERASER_RADIUS: Record<EraserSize, number> = { Small: 6, Medium: 12, Large: 20, 'Extra Large': 32 }

async function reopen(app: CognitiveCanvas) {
  await app.reload()
  await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
}

const strokesByAge = async (page: import('@playwright/test').Page) =>
  (await readStore<StrokeRow & { createdAt: number }>(page, 'canvasStrokes')).sort((a, b) => a.createdAt - b.createdAt)

/** Stroke colours in paint order: SVG paints later groups on top. */
const paintedColours = (ws: CanvasWorkbench) =>
  ws.strokeGroups.evaluateAll((groups) => groups.map((g) => g.querySelector('path')?.getAttribute('stroke') ?? ''))

/** Draw a horizontal stroke through world point `mid`, `half` world units each side. */
async function strokeThroughWorld(ws: CanvasWorkbench, mid: Point, half: number) {
  const pts: Point[] = []
  for (let i = 0; i <= 16; i++) pts.push(await ws.worldToScreen({ x: mid.x - half + (2 * half * i) / 16, y: mid.y }))
  await ws.stroke(pts)
}

test.describe('Canvas tool palette', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-300 the palette lists every canvas tool in order, and the Eraser appears only with Draw', { tag: '@P3' }, async ({ ws }) => {
    const titles = () => ws.paletteButtons().evaluateAll((els) => els.map((e) => e.getAttribute('title')))
    expect(await titles()).toEqual(['Pan', 'Note', 'Text', 'Draw', 'Line', 'Audio', 'Video', 'Document'])
    expect(await ws.isArmed('pan')).toBe(true)
    await expect(ws.toolGuide).toHaveAttribute('title', 'Tool guide')
    await expect(ws.toolsTour).toHaveAttribute('title', 'Take a tour of these tools')

    await ws.tool('ink').click()
    expect(await titles()).toEqual(['Pan', 'Note', 'Text', 'Draw', 'Eraser', 'Line', 'Audio', 'Video', 'Document'])
    await ws.tool('eraser').click()
    expect(await ws.isArmed('eraser')).toBe(true)
    await ws.tool('note').click()
    await expect(ws.tool('eraser')).toHaveCount(0)
    expect(await ws.isArmed('note')).toBe(true)
  })

  test('REG-301 clicking an armed tool again disarms it and the next canvas click does nothing', { tag: '@P3' }, async ({ ws, dialogs, page }) => {
    await ws.tool('note').click()
    await ws.tool('note').click()
    expect(await ws.isArmed('pan')).toBe(true)
    const p = await ws.at(0.5, 0.4)
    await page.mouse.click(p.x, p.y)

    await ws.tool('audio').click()
    await ws.tool('audio').click()
    await page.mouse.click(p.x, p.y)
    await expect(dialogs.audio).toHaveCount(0)

    // Sentinel: one real note. Had either disarmed click placed something, there would be two.
    await ws.place('note', 0.3, 0.3)
    await expectStoreCount(page, 'workspaceItems', 1)
  })

  test('REG-302 the Note tool places a 200x120 note centred on the click, selects it and returns to Pan', { tag: ['@P1', '@sanity'] }, async ({ ws, page, docId }) => {
    const click = await ws.at(0.5, 0.4)
    const world = await ws.screenToWorld(click)
    await ws.tool('note').click()
    await page.mouse.click(click.x, click.y)
    await expectStoreCount(page, 'workspaceItems', 1)
    const [row] = await readStore<ItemRow>(page, 'workspaceItems')
    expect(row).toMatchObject({ type: 'note', width: 200, height: 120, documentId: docId })
    expect(row.x).toBeCloseTo(world.x - 100, 0)
    expect(row.y).toBeCloseTo(world.y - 60, 0)
    expect(row.data).toEqual({ type: 'note', content: '', color: 'yellow', sourceExcerpt: null, sourcePageNumber: null })
    await expect(ws.item(row.id)).toContainText('Double-click to edit')
    await ws.expectSelected(row.id)
    expect(await ws.isArmed('pan')).toBe(true)

    // Back on Pan, an empty-canvas click places nothing; the next note takes the next colour.
    const empty = await ws.at(0.2, 0.8)
    await page.mouse.click(empty.x, empty.y)
    const second = (await ws.place('note', 0.75, 0.7))!
    await expectStoreCount(page, 'workspaceItems', 2)
    const rows = await readStore<ItemRow<{ color: string }>>(page, 'workspaceItems')
    expect(rows.find((r) => r.id === second)!.data.color).toBe('red')
  })

  test('REG-303 the Text tool places a "Text" box centred on the click, 200 wide and fitted to its line, and returns to Pan', { tag: '@P2' }, async ({ ws, page, docId }) => {
    const click = await ws.at(0.5, 0.3)
    const world = await ws.screenToWorld(click)
    const id = (await ws.place('text', 0.5, 0.3))!
    await expectStoreCount(page, 'workspaceItems', 1)
    const [row] = await readStore<ItemRow>(page, 'workspaceItems')
    expect(row).toMatchObject({ id, type: 'text', width: 200, documentId: docId })
    // Placed as a 200x30 box centred on the click, then fitted to its one line of text:
    // the saved height is the height it is drawn at.
    expect(row.x).toBeCloseTo(world.x - 100, 0)
    expect(row.y).toBeCloseTo(world.y - 15, 0)
    expect(row.height).toBeLessThanOrEqual(30)
    expect(row.height).toBeCloseTo((await ws.worldRect(id)).height, 0)
    expect(row.data).toMatchObject({ type: 'text', content: 'Text', fontSize: 16, fontWeight: 400, color: 'var(--text-primary)' })
    // (Typing straight into the new box is REG-055, known defect DEF-006.)
    await expect(ws.item(id).locator('div.whitespace-pre-wrap:not(.invisible)')).toHaveText('Text')
    expect(await ws.isArmed('pan')).toBe(true)
    // Text boxes have no resize handles (only notes and images do).
    await expect(ws.resizeHandles(id)).toHaveCount(0)
  })

  test('REG-304 the Draw drawer offers eight colours; the chosen colour is saved on the next stroke and survives a reload', { tag: ['@P2'] }, async ({ pdfOpen: app, ws, page, docId }) => {
    await ws.tool('ink').click()
    for (const c of Object.keys(INK_HEX) as InkColour[]) await expect(ws.inkColour(c)).toBeVisible()
    await ws.horizontalStroke(0.6, 0.3, 0.55)
    // Drawing on the canvas folds the drawer (its arrow turns to "Open"); the arrow opens it again.
    await expect(ws.drawerArrow('Open')).toBeVisible()
    await ws.drawerArrow('Open').click()
    await expect(ws.drawerArrow('Close')).toBeVisible()
    await ws.inkColour('Teal').click()
    await ws.horizontalStroke(0.75, 0.3, 0.55)
    expect(await ws.isArmed('ink')).toBe(true) // Draw stays armed between strokes

    await expectStoreCount(page, 'canvasStrokes', 2)
    const rows = await strokesByAge(page)
    expect(rows.map((r) => r.color)).toEqual([INK_HEX.Amber, INK_HEX.Teal])
    for (const r of rows) {
      expect(r).toMatchObject({ width: 2, documentId: docId })
      expect(r.points.length).toBeGreaterThan(5)
    }
    await expect(ws.strokeGroups).toHaveCount(2)
    await expect(ws.strokeGroups.nth(0).locator('path')).toHaveAttribute('stroke', INK_HEX.Amber)
    await expect(ws.strokeGroups.nth(1).locator('path')).toHaveAttribute('stroke', INK_HEX.Teal)

    await reopen(app)
    await expect(ws.strokeGroups).toHaveCount(2)
    // Both colours come back. Their stacking order after a reload is REG-395 (DEF-312).
    expect((await paintedColours(ws)).sort()).toEqual([INK_HEX.Amber, INK_HEX.Teal].sort())
  })

  test('REG-395 pen strokes keep their stacking order after a reload, so the newest stroke stays on top', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    knownDefect('DEF-312')
    // Six colours drawn one after another over the same line, each new stroke covering the last.
    // The app reloads strokes in storage-key order (random ids); with six strokes the chance that
    // this matches the drawing order by luck is 1 in 720, so the check is reliable.
    const order: InkColour[] = ['Amber', 'Teal', 'Red', 'Green', 'Pink', 'Violet']
    await ws.tool('ink').click()
    for (const [i, c] of order.entries()) {
      if (i > 0) {
        await ws.drawerArrow('Open').click()
        await expect(ws.drawerArrow('Close')).toBeVisible()
      }
      await ws.inkColour(c).click()
      await ws.horizontalStroke(0.5, 0.3, 0.6)
      await expectStoreCount(page, 'canvasStrokes', i + 1)
    }
    const drawn = order.map((c) => INK_HEX[c])
    expect((await strokesByAge(page)).map((r) => r.color)).toEqual(drawn)
    // Before the reload: painted in drawing order, the newest last (on top).
    await expect.poll(() => paintedColours(ws)).toEqual(drawn)

    await reopen(app)
    await expect(ws.strokeGroups).toHaveCount(order.length)
    expect(await paintedColours(ws)).toEqual(drawn)
  })

  test('REG-305 clicking Draw again returns to Pan, so a drag pans the view instead of drawing', { tag: '@P3' }, async ({ ws, page }) => {
    await ws.tool('ink').click()
    await ws.tool('ink').click()
    expect(await ws.isArmed('pan')).toBe(true)
    const t0 = await ws.transform()
    await ws.panBy(-120, 60, [0.3, 0.5])
    expect((await ws.transform()).x).toBeLessThan(t0.x)
    // Sentinel stroke: had the drag drawn, there would be two.
    await ws.tool('ink').click()
    await ws.horizontalStroke(0.7, 0.3, 0.5)
    await expectStoreCount(page, 'canvasStrokes', 1)
  })

  test('REG-306 the Eraser drawer offers four sizes, Medium by default, and the cursor matches the size', { tag: '@P3' }, async ({ ws }) => {
    knownDefect('DEF-301')
    await ws.tool('ink').click()
    await ws.tool('eraser').click()
    for (const s of Object.keys(ERASER_RADIUS) as EraserSize[]) await expect(ws.eraserSize(s)).toBeVisible()
    // The cursor is a circle of the eraser radius with its hotspot at the centre: Medium (12) by default.
    const cursor = () => ws.surface.evaluate((el) => (el as HTMLElement).style.cursor)
    await expect.poll(cursor).toMatch(/\) 12 12, crosshair$/)
    await ws.eraserSize('Extra Large').click()
    await expect.poll(cursor).toMatch(/\) 32 32, crosshair$/)
  })

  for (const size of ['Small', 'Extra Large'] as const) {
    test(`${size === 'Small' ? 'REG-307 a Small' : 'REG-313 an Extra Large'} eraser pass splits a stroke in two, leaving a gap of its own diameter`, { tag: size === 'Small' ? '@P2' : '@P3' }, async ({ ws, page }) => {
      const centre = await ws.screenToWorld(await ws.at(0.5, 0.6))
      await ws.tool('ink').click()
      await strokeThroughWorld(ws, centre, 120)
      await expectStoreCount(page, 'canvasStrokes', 1)
      const [original] = await readStore<StrokeRow>(page, 'canvasStrokes')

      await ws.tool('eraser').click()
      await ws.eraserSize(size).click()
      // A vertical pass straight through the stroke's middle.
      await ws.drag(await ws.worldToScreen({ x: centre.x, y: centre.y - 80 }), await ws.worldToScreen({ x: centre.x, y: centre.y + 80 }), { steps: 30 })

      await expectStoreCount(page, 'canvasStrokes', 2)
      const pieces = (await readStore<StrokeRow>(page, 'canvasStrokes')).sort((a, b) => a.points[0].x - b.points[0].x)
      const r = ERASER_RADIUS[size]
      const gapStart = pieces[0].points.at(-1)!.x
      const gapEnd = pieces[1].points[0].x
      // The eraser samples its path every 6 world units, so the nearest sample can sit up to
      // 3 units off the stroke line: the cut half-width lies between sqrt(r^2 - 9) and r.
      const minHalf = Math.sqrt(r * r - 9) - 0.5
      expect(centre.x - gapStart).toBeGreaterThanOrEqual(minHalf)
      expect(centre.x - gapStart).toBeLessThanOrEqual(r + 0.5)
      expect(gapEnd - centre.x).toBeGreaterThanOrEqual(minHalf)
      expect(gapEnd - centre.x).toBeLessThanOrEqual(r + 0.5)
      for (const p of pieces) {
        expect(p).toMatchObject({ color: original.color, width: original.width })
        expect(p.id).not.toBe(original.id)
      }
      // The pieces keep the original's outer ends.
      expect(pieces[0].points[0].x).toBeCloseTo(original.points[0].x, 3)
      expect(pieces[1].points.at(-1)!.x).toBeCloseTo(original.points.at(-1)!.x, 3)
    })
  }

  test('REG-308 the eraser removes only pen strokes: notes, lines and strokes off its path are untouched', { tag: '@P1' }, async ({ ws, page }) => {
    const note = (await ws.place('note', 0.5, 0.35))!
    await ws.tool('line').click()
    await ws.drag(await ws.at(0.3, 0.75), await ws.at(0.7, 0.75))
    await ws.tool('ink').click()
    await ws.horizontalStroke(0.55, 0.3, 0.7) // crossed by the eraser
    await ws.horizontalStroke(0.9, 0.62, 0.72) // well to the right of the eraser's path
    await expectStoreCount(page, 'canvasStrokes', 2)
    await expectStoreCount(page, 'workspaceItems', 2)
    const before = await readStore<ItemRow>(page, 'workspaceItems')
    const farStroke = (await readStore<StrokeRow>(page, 'canvasStrokes')).sort((a, b) => b.points[0].y - a.points[0].y)[0]

    await ws.tool('eraser').click()
    await ws.eraserSize('Extra Large').click()
    // Straight down through the note, the first stroke and the line.
    await ws.drag(await ws.at(0.45, 0.2), await ws.at(0.45, 0.85), { steps: 40 })

    await expectStoreCount(page, 'canvasStrokes', 3) // first stroke split in two, far stroke kept
    const strokes = await readStore<StrokeRow>(page, 'canvasStrokes')
    expect(strokes.find((s) => s.id === farStroke.id)?.points).toEqual(farStroke.points)
    const after = await readStore<ItemRow>(page, 'workspaceItems')
    expect(after).toEqual(before)
    await expect(ws.item(note)).toBeVisible()
    await expect(ws.lines).toHaveCount(1)
  })

  test('REG-309 the Line tool draws between two notes, attaches to their edges and follows a dragged note', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.25, 0.3))!
    const b = (await ws.place('note', 0.75, 0.65))!
    await ws.tool('line').click()
    // Released anywhere over a note, an end snaps to that note's nearest edge midpoint (lineSnapping.ts).
    await ws.drag(await ws.itemCentre(a), await ws.itemCentre(b), { steps: 15 })
    expect(await ws.isArmed('pan')).toBe(true)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'line')
    const read = async () => {
      const rows = await readStore<ItemRow<{ fromItemId: string | null; toItemId: string | null; fromAnchor?: string; toAnchor?: string; points: Point[] }>>(page, 'workspaceItems')
      return { line: rows.find((r) => r.type === 'line')!, a: rows.find((r) => r.id === a)!, b: rows.find((r) => r.id === b)! }
    }
    await expect.poll(async () => (await read()).line.data.toItemId).toBe(b)
    const { line, a: ra, b: rb } = await read()
    expect(line.data).toMatchObject({ fromItemId: a, toItemId: b, color: '#64748b', strokeWidth: 2, style: 'solid', arrowHead: false })
    const end = (row: typeof ra, anchor: string | undefined): Point => {
      switch (anchor) {
        case 'top': return { x: row.x + row.width / 2, y: row.y }
        case 'bottom': return { x: row.x + row.width / 2, y: row.y + row.height }
        case 'left': return { x: row.x, y: row.y + row.height / 2 }
        default: return { x: row.x + row.width, y: row.y + row.height / 2 }
      }
    }
    const p0 = { x: line.x + line.data.points[0].x, y: line.y + line.data.points[0].y }
    const p1 = { x: line.x + line.data.points[1].x, y: line.y + line.data.points[1].y }
    expect(p0.x).toBeCloseTo(end(ra, line.data.fromAnchor).x, 0)
    expect(p0.y).toBeCloseTo(end(ra, line.data.fromAnchor).y, 0)
    expect(p1.x).toBeCloseTo(end(rb, line.data.toAnchor).x, 0)
    expect(p1.y).toBeCloseTo(end(rb, line.data.toAnchor).y, 0)

    // Drag note B: the line's end follows it and is saved there.
    const { scale } = await ws.transform()
    await ws.dragItem(b, 0, 90)
    await expect.poll(async () => {
      const now = await read()
      const end1 = { x: now.line.x + now.line.data.points[1].x, y: now.line.y + now.line.data.points[1].y }
      return Math.abs(end1.y - end(now.b, now.line.data.toAnchor).y) < 1 && Math.abs(now.b.y - rb.y - 90 / scale) < 1
    }, { message: 'line end follows the moved note' }).toBe(true)
  })

  test('REG-310 a selected line shows two endpoint handles; dragging a free end moves it and "Delete line" removes only the line', { tag: '@P3' }, async ({ ws, page }) => {
    const keep = (await ws.place('note', 0.8, 0.2))!
    await ws.tool('line').click()
    await ws.drag(await ws.at(0.25, 0.7), await ws.at(0.55, 0.7))
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'line')
    const lineId = (await readStore<ItemRow>(page, 'workspaceItems')).find((r) => r.type === 'line')!.id
    // Select the line by clicking on it (the hit stroke is 12 px wide), a third of the way
    // along: on hover its trash button appears at the midpoint, which a click there would press.
    const onLine = await ws.at(0.35, 0.7)
    await page.mouse.click(onLine.x, onLine.y)
    await expect(ws.lineHandles(lineId)).toHaveCount(2)

    const target = await ws.at(0.55, 0.85)
    const targetWorld = await ws.screenToWorld(target)
    const endHandle = (await ws.lineHandles(lineId).nth(1).boundingBox())!
    await ws.drag({ x: endHandle.x + endHandle.width / 2, y: endHandle.y + endHandle.height / 2 }, target, { steps: 10 })
    await expect.poll(async () => {
      const l = (await readStore<ItemRow<{ points: Point[]; toItemId: string | null }>>(page, 'workspaceItems')).find((r) => r.id === lineId)!
      return Math.hypot(l.x + l.data.points[1].x - targetWorld.x, l.y + l.data.points[1].y - targetWorld.y) < 2 && l.data.toItemId === null
    }, { message: 'free end moved to the drop point' }).toBe(true)

    await ws.lineDelete(lineId).click()
    await expectStoreCount(page, 'workspaceItems', 0, (i) => i.type === 'line')
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.id === keep)
  })

  test('REG-311 the Audio, Video and Document tools open their dialogs, return to Pan, and Cancel creates nothing', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    await ws.place('audio', 0.6, 0.4)
    await expect(dialogs.audio).toBeVisible()
    expect(await ws.isArmed('pan')).toBe(true)
    await dialogs.media(dialogs.audio, 'Audio').cancel.click()
    await expect(dialogs.audio).toBeHidden()

    await ws.place('video', 0.6, 0.4)
    await expect(dialogs.video).toBeVisible()
    await expect(dialogs.media(dialogs.video, 'Video').tab('Upload')).toHaveAttribute('aria-selected', 'true')
    await dialogs.media(dialogs.video, 'Video').cancel.click()
    await expect(dialogs.video).toBeHidden()

    await ws.place('document', 0.6, 0.4)
    await expect(dialogs.documentPicker).toBeVisible()
    await expect(dialogs.documentPicker).toContainText('Select from project or upload a new PDF')
    await dialogs.documentPicker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialogs.documentPicker).toBeHidden()

    // Sentinel note: nothing else was created by the three dialogs.
    await ws.place('note', 0.3, 0.3)
    await expectStoreCount(page, 'workspaceItems', 1)
    await expect(page.getByText('Double-click to edit')).toHaveCount(1)
  })

  test('REG-312 the Tool guide button opens the Workspace Tools guide and the tour button starts the workspace tour', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    await ws.toolGuide.click()
    await app.settings.expectOpen()
    await expect(page.getByRole('heading', { name: 'Workspace Tools', level: 3 })).toBeVisible()
    // Two "Back" buttons: the Settings header's (first) and the guide's own.
    await app.settings.back.first().click()
    await expect(app.settings.heading).toBeHidden()
    await ws.toolsTour.click()
    await expect(page.locator('.tour-tooltip')).toBeVisible()
    await expect(page.locator('.tour-tooltip')).toContainText(/^.*1 of 10/s)
    await page.getByRole('button', { name: 'Close tour' }).click()
    await expect(page.locator('.tour-tooltip')).toHaveCount(0)
    // Once used, the tour button stops pulsing (remembered per install).
    await expect(ws.toolsTour).not.toHaveClass(/tour-entry-pulse/)
    expect(await page.evaluate(() => localStorage.getItem('cc2_tour_workspace-tools_clicked'))).toBe('1')
  })
})
