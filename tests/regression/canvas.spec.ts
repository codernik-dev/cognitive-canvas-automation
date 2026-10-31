/**
 * Regression: the workspace canvas. Positions are asserted in WORLD units
 * (the item's inline left/top) and converted from screen drags through the
 * current zoom scale, so a pass means the model moved, not just the pixels.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF } from '../../data/files.js'

interface ItemRow<D = Record<string, unknown>> { id: string; type: string; x: number; y: number; width: number; height: number; data: D }

test.describe('Canvas items', { tag: ['@regression', '@canvas'] }, () => {
  // The Text tool marks a new box to open for editing on mount (TextItem.tsx takeEditOnMount).
  test('REG-055 typing straight after placing a text box goes into the box', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    knownDefect('DEF-006')
    const id = (await app.canvas.place('text', 0.5, 0.3))!
    await page.keyboard.type('Hello text box')
    await expect(app.canvas.item(id)).toContainText('Hello text box')
  })

  test('REG-069 clicking a selected text box opens it; the typed text is saved', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const id = (await app.canvas.place('text', 0.5, 0.3))!
    await app.canvas.select(id)
    const box = app.canvas.item(id).locator('textarea')
    await expect(box).toBeFocused()
    await page.keyboard.type('Hello text box')
    await page.keyboard.press('Escape')
    // Editing selects the placeholder, so typing replaces it: the stored text is exactly what was typed.
    await expect.poll(async () => (await readStore<ItemRow<{ content?: string }>>(page, 'workspaceItems')).find((i) => i.id === id)?.data.content).toBe('Hello text box')
  })

  test('REG-056 dragging a note moves it by the drag distance in world units, and it is saved', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    const id = (await app.canvas.place('note', 0.4, 0.3))!
    const { scale } = await app.canvas.transform()
    const before = await app.canvas.worldRect(id)
    await app.canvas.dragItem(id, 150, 80)
    await expect.poll(async () => (await app.canvas.worldRect(id)).x - before.x).toBeCloseTo(150 / scale, 0)
    const after = await app.canvas.worldRect(id)
    expect(after.y - before.y).toBeCloseTo(80 / scale, 0)
    await expect.poll(async () => (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.id === id)?.x).toBeCloseTo(after.x, 0)
    const row = (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.id === id)!
    expect(row.y).toBeCloseTo(after.y, 0)
    // A move is not a resize.
    expect([row.width, row.height]).toEqual([before.width, before.height])
  })

  test('REG-057 a selected note can be resized from its corner handle', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const id = (await app.canvas.place('note', 0.4, 0.3))!
    const { scale } = await app.canvas.transform()
    const before = await app.canvas.worldRect(id)
    const handles = app.canvas.item(id).locator('[data-resize-handle]')
    await expect(handles).toHaveCount(8)
    const se = (await handles.nth(4).boundingBox())! // order: nw, n, ne, e, se, s, sw, w
    const [hx, hy] = [se.x + se.width / 2, se.y + se.height / 2]
    await page.mouse.move(hx, hy)
    await page.mouse.down()
    await page.mouse.move(hx + 60, hy + 40, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await app.canvas.worldRect(id)).width - before.width).toBeCloseTo(60 / scale, 0)
    const after = await app.canvas.worldRect(id)
    expect(after.height - before.height).toBeCloseTo(40 / scale, 0)
    expect([after.x, after.y]).toEqual([before.x, before.y]) // the corner opposite the handle stays
    // The new size is what gets saved.
    await expect.poll(async () => {
      const r = (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.id === id)
      return r ? [Math.round(r.width * 100), Math.round(r.height * 100)] : null
    }).toEqual([Math.round(after.width * 100), Math.round(after.height * 100)])
  })

  test('REG-058 Ctrl+D duplicates the selected note offset by 20', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const id = (await app.canvas.place('note', 0.4, 0.3))!
    await app.canvas.select(id)
    await page.keyboard.press('Control+d')
    await expectStoreCount(page, 'workspaceItems', 2)
    const items = await readStore<ItemRow>(page, 'workspaceItems')
    const orig = items.find((i) => i.id === id)!
    const copy = items.find((i) => i.id !== id)!
    expect([copy.x - orig.x, copy.y - orig.y]).toEqual([20, 20])
    // A true copy: same kind, size and content.
    expect({ type: copy.type, width: copy.width, height: copy.height, data: copy.data }).toEqual({ type: orig.type, width: orig.width, height: orig.height, data: orig.data })
  })

  test('REG-059 Ctrl+click selects two notes and Delete removes both', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const a = (await app.canvas.place('note', 0.3, 0.3))!
    const b = (await app.canvas.place('note', 0.7, 0.6))!
    await app.canvas.select(a)
    const box = (await app.canvas.item(b).boundingBox())!
    await page.keyboard.down('Control')
    await page.mouse.click(box.x + box.width / 2, box.y + 20)
    await page.keyboard.up('Control')
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'workspaceItems', 0)
  })

  test('REG-060 Delete pressed while working in the PDF does not delete the selected note', { tag: '@P1' }, async ({ pdfOpen: app, page }) => {
    const id = (await app.canvas.place('note', 0.5, 0.4))!
    await app.viewer.canvasOf(1).click()
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'workspaceItems', 1)
    await app.canvas.select(id)
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'workspaceItems', 0)
  })

  test('REG-061 the Line tool draws a line; a tap without a drag draws nothing', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    await app.canvas.tool('line').click()
    const [x, y] = await app.canvas.pointAt(0.5, 0.75)
    await page.mouse.click(x, y)
    await expect(app.canvas.lines).toHaveCount(0)
    await app.canvas.tool('line').click()
    await page.mouse.move(x - 100, y)
    await page.mouse.down()
    await page.mouse.move(x + 100, y, { steps: 10 })
    await page.mouse.up()
    await expect(app.canvas.lines).toHaveCount(1)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'line')
    // The stored line spans the drag: 200 screen px, horizontal.
    const { scale } = await app.canvas.transform()
    const [line] = await readStore<ItemRow<{ points: Array<{ x: number; y: number }> }>>(page, 'workspaceItems')
    const [p0, p1] = line.data.points
    expect(p1.x - p0.x).toBeCloseTo(200 / scale, 0)
    expect(p1.y - p0.y).toBeCloseTo(0, 0)
  })

  test('REG-062 drawing with the Draw tool saves a stroke that follows the pointer, in the default colour', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    await app.canvas.tool('ink').click()
    const [x, y] = await app.canvas.pointAt(0.4, 0.6)
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 15, y + Math.sin(i) * 20)
    await page.mouse.up()
    await expectStoreCount(page, 'canvasStrokes', 1)
    const [stroke] = await readStore<{ points: Array<{ x: number; y: number }>; color: string; width: number }>(page, 'canvasStrokes')
    expect(stroke.points.length).toBeGreaterThan(5)
    expect(stroke).toMatchObject({ color: '#f59e0b', width: 2 })
    // First and last points are where the pointer went down and came up, in world units.
    const t = await app.canvas.transform()
    const box = (await app.canvas.surface.boundingBox())!
    const world = (sx: number, sy: number) => ({ x: (sx - box.x - t.x) / t.scale, y: (sy - box.y - t.y) / t.scale })
    const start = world(x, y)
    const end = world(x + 150, y + Math.sin(10) * 20)
    expect(stroke.points[0].x).toBeCloseTo(start.x, 0)
    expect(stroke.points[0].y).toBeCloseTo(start.y, 0)
    expect(stroke.points.at(-1)!.x).toBeCloseTo(end.x, 0)
    expect(stroke.points.at(-1)!.y).toBeCloseTo(end.y, 0)
  })
})

test.describe('Canvas view', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-063 zoom buttons scale the canvas by 1.25 and stop at 200 %', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    const s0 = (await app.canvas.transform()).scale
    await app.canvas.zoomIn.click()
    await expect.poll(async () => (await app.canvas.transform()).scale).toBeCloseTo(s0 * 1.25, 2)
    for (let i = 0; i < 12; i++) await app.canvas.zoomIn.click()
    await expect.poll(async () => (await app.canvas.transform()).scale).toBeCloseTo(2, 2)
    await expect(app.canvas.zoomLabel).toHaveText('200%')
  })

  test('REG-064 dragging empty canvas pans the view without moving items in the world', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    const id = (await app.canvas.place('note', 0.5, 0.3))!
    const world = await app.canvas.worldRect(id)
    const t0 = await app.canvas.transform()
    await app.canvas.panBy(-160, 120)
    const t1 = await app.canvas.transform()
    expect(t1.x).toBeLessThan(t0.x)
    expect(t1.y).toBeGreaterThan(t0.y)
    expect(await app.canvas.worldRect(id)).toEqual(world)
  })

  test('REG-065 the mini-map toggles, counts the items, draws a mark for each, and can be moved to a place it remembers', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const a = (await app.canvas.place('note', 0.3, 0.3))!
    const b = (await app.canvas.place('note', 0.6, 0.6))!
    await app.canvas.minimapToggle.click()
    await expect(app.canvas.minimap).toContainText('2 items')
    await expect(page.locator('[data-minimap-item]')).toHaveCount(2)
    for (const id of [a, b]) await expect(page.locator(`[data-minimap-item="${id}"]`)).toBeAttached()

    // Drag the title bar: the map moves, and the spot is remembered after a reload.
    const panel = app.canvas.minimap.locator('xpath=..')
    const head = (await app.canvas.minimap.boundingBox())!
    await page.mouse.move(head.x + 30, head.y + 8)
    await page.mouse.down()
    await page.mouse.move(head.x + 150, head.y - 200, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem('cc2_minimap_pos'))) ?? '{}').y).toBeGreaterThanOrEqual(0)
    const moved = (await panel.boundingBox())!
    expect(moved.x).toBeGreaterThan(head.x + 100)
    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.canvas.minimapToggle.click()
    const after = (await panel.boundingBox())!
    expect(Math.abs(after.x - moved.x)).toBeLessThan(2)
    expect(Math.abs(after.y - moved.y)).toBeLessThan(2)

    await app.canvas.minimapToggle.click()
    await expect(app.canvas.minimap).toBeHidden()
  })

  test('REG-066 Timeline view swaps the canvas for a timeline and back', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const id = (await app.canvas.place('note', 0.5, 0.3))!
    await expect(app.canvas.timelineToggle).toHaveAccessibleName('Timeline view')
    await app.canvas.timelineToggle.click()
    await expect(app.canvas.timelineToggle).toHaveAccessibleName('Canvas view')
    await expect(app.canvas.surface).toBeHidden()
    // The timeline lists the note instead.
    const timeline = page.locator('div.max-w-2xl')
    await expect(timeline.locator(`[data-item-id="${id}"]`)).toBeVisible()
    await app.canvas.timelineToggle.click()
    await expect(app.canvas.surface).toBeVisible()
    await expect(app.canvas.item(id)).toBeVisible()
    await expect(timeline.locator(`[data-item-id="${id}"]`)).toHaveCount(0)
  })
})

test.describe('Item-to-item links', { tag: ['@regression', '@links'] }, () => {
  test('REG-067 two notes can be linked, and deleting one removes the link', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    const a = (await app.canvas.place('note', 0.3, 0.3))!
    const b = (await app.canvas.place('note', 0.7, 0.65))!
    await app.canvas.linkItems(a, b)
    await expectStoreCount(page, 'itemLinks', 1)
    expect((await readStore<{ fromItemId: string; toItemId: string }>(page, 'itemLinks'))[0]).toMatchObject({ fromItemId: a, toItemId: b })
    await expect(app.canvas.itemLinks).toHaveCount(1)
    await expect(app.canvas.itemLinks.first()).toHaveAttribute('data-link-from', a)
    await expect(app.canvas.itemLinks.first()).toHaveAttribute('data-link-to', b)
    await app.canvas.select(b)
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'itemLinks', 0)
    // Only the deleted note went; the other end of the link stays.
    await expect.poll(async () => (await readStore<ItemRow>(page, 'workspaceItems')).map((i) => i.id)).toEqual([a])
  })
})
