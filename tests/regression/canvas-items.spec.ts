/**
 * Regression: working with items on the canvas (WorkspaceCanvas.tsx,
 * canvas/useCanvasEvents.ts, tools/panTool.ts, canvas/ResizeHandles.tsx,
 * canvas/ContextMenu.tsx, canvas/ItemDeleteButton.tsx, items/TextItem.tsx,
 * store/slices/workspaceSlice.ts): selection, keyboard shortcuts, resizing,
 * the right-click menu and text boxes. Every change is checked where it is
 * stored (IndexedDB) as well as on screen.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF } from '../../data/files.js'
import type { Page } from '@playwright/test'
import type { CanvasWorkbench, Handle } from '../../components/CanvasWorkbench.js'

const rows = (page: Page) => readStore<ItemRow>(page, 'workspaceItems')
/** One item's stored row, once the debounced save has written it. */
async function row(page: Page, id: string) {
  let r: ItemRow | undefined
  await expect.poll(async () => !!(r = (await rows(page)).find((x) => x.id === id)), { message: `item ${id} saved` }).toBe(true)
  return r!
}

/** Wait until the stored rect of `id` matches the DOM rect (the save is debounced). */
async function storedMatchesDom(ws: CanvasWorkbench, page: Page, id: string) {
  const dom = await ws.worldRect(id)
  await expect.poll(async () => {
    const r = await row(page, id)
    return [r.x, r.y, r.width, r.height].map((v, i) => Math.abs(v - [dom.x, dom.y, dom.width, dom.height][i]) < 0.01).every(Boolean)
  }, { message: `stored rect of ${id} equals the DOM rect` }).toBe(true)
}

async function dragHandle(ws: CanvasWorkbench, page: Page, id: string, h: Handle, dx: number, dy: number) {
  const box = (await ws.handle(id, h).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

test.describe('Canvas resizing', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-314 each of the eight resize handles moves only its own edges, and the size is saved', { tag: '@P2' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.45))!
    await ws.expectSelected(id)
    const { scale } = await ws.transform()
    const dx = 30, dy = 24
    const wx = dx / scale, wy = dy / scale
    // What each handle does to x, y, width, height for a (+dx, +dy) drag.
    const effect: Record<Handle, [number, number, number, number]> = {
      nw: [wx, wy, -wx, -wy], n: [0, wy, 0, -wy], ne: [0, wy, wx, -wy], e: [0, 0, wx, 0],
      se: [0, 0, wx, wy], s: [0, 0, 0, wy], sw: [wx, 0, -wx, wy], w: [wx, 0, -wx, 0],
    }
    // Grow first (se, e, s) so the shrinking handles never reach the 50 px minimum.
    for (const h of ['se', 'e', 's', 'nw', 'n', 'ne', 'sw', 'w'] as Handle[]) {
      const before = await ws.worldRect(id)
      await dragHandle(ws, page, id, h, dx, dy)
      const want = effect[h]
      await expect.poll(async () => {
        const r = await ws.worldRect(id)
        return [r.x - before.x, r.y - before.y, r.width - before.width, r.height - before.height].map((d, i) => Math.abs(d - want[i]) < 1).every(Boolean)
      }, { message: `handle ${h} changes x/y/w/h by ${want.map((v) => v.toFixed(1)).join(', ')}` }).toBe(true)
    }
    await storedMatchesDom(ws, page, id)
  })

  test('REG-315 a note cannot be resized below 50 x 50, and the opposite corner stays put', { tag: '@P3' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.45))!
    const before = await ws.worldRect(id)
    await dragHandle(ws, page, id, 'nw', 400, 400)
    await expect.poll(async () => {
      const r = await ws.worldRect(id)
      return { w: r.width, h: r.height, right: Math.round(r.x + r.width), bottom: Math.round(r.y + r.height) }
    }).toEqual({ w: 50, h: 50, right: Math.round(before.x + before.width), bottom: Math.round(before.y + before.height) })
    await storedMatchesDom(ws, page, id)
  })
})

test.describe('Canvas selection and keyboard', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-316 Shift+drag on empty canvas box-selects only the items it touches; Delete removes just those', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.25, 0.3))!
    const b = (await ws.place('note', 0.42, 0.42))!
    const c = (await ws.place('note', 0.8, 0.78))!
    await ws.drag(await ws.at(0.08, 0.12), await ws.at(0.55, 0.55), { modifiers: ['Shift'], steps: 12 })
    await ws.expectSelected(a)
    await ws.expectSelected(b)
    await expect(ws.resizeHandles(c)).toHaveCount(0)
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'workspaceItems', 1)
    expect((await rows(page))[0].id).toBe(c)
  })

  test('REG-317 Ctrl+A selects every item on the canvas and Delete removes them all', { tag: '@P2' }, async ({ ws, page }) => {
    const ids = [(await ws.place('note', 0.25, 0.3))!, (await ws.place('note', 0.7, 0.3))!, (await ws.place('note', 0.5, 0.75))!]
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y) // clears the selection and gives the canvas the keyboard
    for (const id of ids) await expect(ws.resizeHandles(id)).toHaveCount(0)
    await page.keyboard.press('Control+a')
    for (const id of ids) await ws.expectSelected(id)
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'workspaceItems', 0)
  })

  test('REG-318 dragging one of several selected items moves them all by the same distance', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.6, 0.55))!
    // Box-select both: two quick presses on the same note would read as a double-click and open its editor.
    await ws.drag(await ws.at(0.08, 0.1), await ws.at(0.85, 0.75), { modifiers: ['Shift'] })
    await ws.expectSelected(a)
    await ws.expectSelected(b)
    const [ra, rb] = [await ws.worldRect(a), await ws.worldRect(b)]
    const { scale } = await ws.transform()
    await ws.dragItem(a, 80, 50)
    await expect.poll(async () => (await ws.worldRect(b)).x - rb.x).toBeCloseTo(80 / scale, 0)
    expect((await ws.worldRect(b)).y - rb.y).toBeCloseTo(50 / scale, 0)
    expect((await ws.worldRect(a)).x - ra.x).toBeCloseTo(80 / scale, 0)
    await storedMatchesDom(ws, page, a)
    await storedMatchesDom(ws, page, b)
  })

  test('REG-319 Ctrl+D with two items selected duplicates both, 20 to the right and below, and selects the copies', { tag: '@P3' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.6, 0.55))!
    await ws.select(a)
    await ws.addToSelection(b)
    await page.keyboard.press('Control+d')
    await expectStoreCount(page, 'workspaceItems', 4)
    const all = await rows(page)
    for (const orig of [a, b]) {
      const o = all.find((r) => r.id === orig)!
      const copy = all.find((r) => r.id !== a && r.id !== b && r.x === o.x + 20 && r.y === o.y + 20)
      expect(copy, `a copy of ${orig} at +20,+20`).toBeDefined()
      expect(copy!.data).toEqual(o.data)
      await ws.expectSelected(copy!.id)
    }
    await expect(ws.resizeHandles(a)).toHaveCount(0)
    await expect(ws.resizeHandles(b)).toHaveCount(0)
  })

  test('REG-320 pressing a note brings it in front of an overlapping one, and the order is saved', { tag: '@P3' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.4, 0.4))!
    const b = (await ws.place('note', 0.5, 0.48))! // overlaps A, on top
    await expect.poll(async () => (await row(page, b)).zIndex > (await row(page, a)).zIndex).toBe(true)
    // Press A where B does not cover it (A's top-left corner).
    const box = (await ws.item(a).boundingBox())!
    await page.mouse.click(box.x + 12, box.y + 12)
    await expect.poll(async () => (await row(page, a)).zIndex > (await row(page, b)).zIndex).toBe(true)
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    const z = (id: string) => ws.item(id).evaluate((el) => Number((el as HTMLElement).style.zIndex))
    expect(await z(a)).toBeGreaterThan(await z(b))
  })
})

test.describe('Canvas context menu', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-321 right-clicking a note offers Duplicate, Delete, Bring to Front and Send to Back; Duplicate and Delete work', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.35, 0.35))!
    await ws.rightClickItem(a)
    await expect(ws.contextMenu.getByRole('button')).toHaveText(['Duplicate', 'Delete', 'Bring to Front', 'Send to Back'])
    await ws.menuItem('Duplicate').click()
    await expect(ws.contextMenu).toBeHidden()
    await expectStoreCount(page, 'workspaceItems', 2)
    const copy = (await rows(page)).find((r) => r.id !== a)!
    const orig = await row(page, a)
    expect([copy.x - orig.x, copy.y - orig.y]).toEqual([20, 20])

    // The copy covers most of A: right-click A's top-left corner, the part it leaves uncovered.
    const box = (await ws.item(a).boundingBox())!
    await page.mouse.click(box.x + 4, box.y + 4, { button: 'right' })
    await ws.menuItem('Delete').click()
    await expectStoreCount(page, 'workspaceItems', 1)
    expect((await rows(page))[0].id).toBe(copy.id)
  })

  test('REG-322 Send to Back puts a note behind every other note, on screen and in storage', { tag: '@P3' }, async ({ ws, page }) => {
    knownDefect('DEF-304')
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.4, 0.38))!
    const c = (await ws.place('note', 0.5, 0.46))!
    const z = async () => Object.fromEntries((await rows(page)).map((r) => [r.id, r.zIndex]))
    // Send C (the top one) to the back: right-click its uncovered bottom-right corner.
    const cb = (await ws.item(c).boundingBox())!
    await page.mouse.click(cb.x + cb.width - 15, cb.y + cb.height - 15, { button: 'right' })
    await ws.menuItem('Send to Back').click()
    await expect.poll(async () => { const zz = await z(); return { belowA: zz[c] < zz[a], belowB: zz[c] < zz[b] } }).toEqual({ belowA: true, belowB: true })
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    const dz = (id: string) => ws.item(id).evaluate((el) => Number((el as HTMLElement).style.zIndex))
    expect(await dz(c)).toBeLessThan(await dz(a))
  })

  test('REG-335 Bring to Front lifts every selected note above the unselected ones', { tag: '@P3' }, async ({ ws, page }) => {
    const c = (await ws.place('note', 0.65, 0.7))! // oldest, so lowest
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.4, 0.38))! // newest, so highest
    const z = async () => Object.fromEntries((await rows(page)).map((r) => [r.id, r.zIndex]))
    await expect.poll(async () => { const zz = await z(); return zz[c] < zz[b] }).toBe(true)
    // A and C selected; only A is pressed (the right-click), so only the menu can lift C above B.
    await ws.select(c)
    await ws.addToSelection(a)
    const ab = (await ws.item(a).boundingBox())!
    await page.mouse.click(ab.x + 10, ab.y + 10, { button: 'right' })
    await expect(ws.menuItem('Delete (2)')).toBeVisible()
    await ws.menuItem('Bring to Front').click()
    await expect.poll(async () => { const zz = await z(); return { a: zz[a] > zz[b], c: zz[c] > zz[b] } }).toEqual({ a: true, c: true })
  })

  test('REG-323 with two notes selected the menu shows "Delete (2)", Align Left and Align Top, which line them up', { tag: '@P3' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.65, 0.65))!
    await ws.select(a)
    await ws.addToSelection(b)
    await ws.rightClickItem(b)
    await expect(ws.contextMenu.getByRole('button')).toHaveText(['Duplicate', 'Delete (2)', 'Bring to Front', 'Send to Back', 'Align Left', 'Align Top'])
    const [ra, rb] = [await row(page, a), await row(page, b)]
    await ws.menuItem('Align Left').click()
    await expect.poll(async () => [(await row(page, a)).x, (await row(page, b)).x]).toEqual([Math.min(ra.x, rb.x), Math.min(ra.x, rb.x)])
    await ws.rightClickItem(b)
    await ws.menuItem('Align Top').click()
    await expect.poll(async () => [(await row(page, a)).y, (await row(page, b)).y]).toEqual([Math.min(ra.y, rb.y), Math.min(ra.y, rb.y)])
  })

  test('REG-324 with three notes selected, Distribute H and Distribute V space them evenly', { tag: '@P3' }, async ({ ws, page }) => {
    const ids = [(await ws.place('note', 0.15, 0.2))!, (await ws.place('note', 0.35, 0.75))!, (await ws.place('note', 0.85, 0.4))!]
    await expectStoreCount(page, 'workspaceItems', 3) // the gap check reads all three rows
    await ws.select(ids[0])
    await ws.addToSelection(ids[1])
    await ws.addToSelection(ids[2])
    await ws.rightClickItem(ids[2])
    await expect(ws.menuItem('Distribute H')).toBeVisible()
    await ws.menuItem('Distribute H').click()
    const gaps = async (axis: 'x' | 'y') => {
      const rs = (await rows(page)).sort((p, q) => p[axis] - q[axis])
      const size = axis === 'x' ? 'width' : 'height'
      return [rs[1][axis] - (rs[0][axis] + rs[0][size]), rs[2][axis] - (rs[1][axis] + rs[1][size])]
    }
    await expect.poll(async () => { const [g1, g2] = await gaps('x'); return Math.abs(g1 - g2) < 0.01 }, { message: 'equal horizontal gaps' }).toBe(true)
    await ws.rightClickItem(ids[2])
    await ws.menuItem('Distribute V').click()
    await expect.poll(async () => { const [g1, g2] = await gaps('y'); return Math.abs(g1 - g2) < 0.01 }, { message: 'equal vertical gaps' }).toBe(true)
  })

  test('REG-325 the context menu closes on Escape or an outside click without changing anything', { tag: '@P3' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.35, 0.35))!
    await expectStoreCount(page, 'workspaceItems', 1)
    const before = await row(page, a)
    await ws.rightClickItem(a)
    await page.keyboard.press('Escape')
    await expect(ws.contextMenu).toBeHidden()
    await ws.rightClickItem(a)
    const outside = await ws.at(0.85, 0.85)
    await page.mouse.click(outside.x, outside.y)
    await expect(ws.contextMenu).toBeHidden()
    await expectStoreCount(page, 'workspaceItems', 1)
    const after = await row(page, a)
    // A press may lift it to the front (zIndex) and re-save it (updatedAt); its place, size and content stay.
    const keep = (r: ItemRow) => ({ x: r.x, y: r.y, width: r.width, height: r.height, data: r.data })
    expect(keep(after)).toEqual(keep(before))
  })

  test('REG-326 the empty-canvas menu: Select All is off on an empty board, Reset View frames the origin at 80 %, Select All selects everything', { tag: '@P3' }, async ({ ws }) => {
    await ws.rightClickAt(await ws.at(0.5, 0.5))
    await expect(ws.contextMenu.getByRole('button')).toHaveText(['Select All', 'Reset View'])
    await expect(ws.menuItem('Select All')).toBeDisabled()
    await ws.menuItem('Reset View').click()
    const box = await ws.surfaceBox()
    // The DOM transform carries 3 decimals: compare to 0.01 px.
    const r2 = (v: number) => Math.round(v * 100) / 100
    await expect.poll(async () => { const t = await ws.transform(); return [r2(t.x), r2(t.y), t.scale] }).toEqual([r2(box.width / 2), r2(box.height / 2), 0.8])
    await expect(ws.zoomLabel).toHaveText('80%')

    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.7, 0.7))!
    await ws.rightClickAt(await ws.at(0.1, 0.9))
    await ws.menuItem('Select All').click()
    await ws.expectSelected(a)
    await ws.expectSelected(b)
  })
})

test.describe('Canvas item buttons and links', { tag: ['@regression', '@canvas', '@links'] }, () => {
  test('REG-327 the trash button shows on hover and deletes only its own note', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.7, 0.65))!
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    // Hidden means hidden: invisible and not clickable until the note is hovered or selected.
    await expect(ws.deleteButton(a)).toHaveCSS('opacity', '0')
    await expect(ws.deleteButton(a)).toHaveCSS('pointer-events', 'none')
    await ws.item(a).hover()
    await expect(ws.deleteButton(a)).toHaveCSS('opacity', '1')
    await ws.deleteButton(a).click()
    await expectStoreCount(page, 'workspaceItems', 1)
    expect((await rows(page))[0].id).toBe(b)
  })

  test('REG-328 the Link button arms linking and cancels it when pressed again; Escape also cancels', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.7, 0.65))!
    await ws.select(a)
    await ws.linkButton(a).click()
    await expect(ws.pendingLinkHint).toBeVisible()
    await expect(ws.linkButton(a)).toHaveAccessibleName('Cancel linking')
    await ws.linkButton(a).click()
    await expect(ws.pendingLinkHint).toBeHidden()
    await expect(ws.linkButton(a)).toHaveAccessibleName('Link to another item')

    await ws.linkButton(a).click()
    await page.keyboard.press('Escape')
    await expect(ws.pendingLinkHint).toBeHidden()
    await ws.select(b) // a plain click: must not link now
    // Link B -> A properly. Had Escape not cancelled, the click above would already have
    // stored A -> B and this second link would be refused as a duplicate.
    // (B is armed from its Link button: a second quick press on the same note counts as a double-click.)
    await ws.linkButton(b).click()
    await expect(ws.pendingLinkHint).toBeVisible()
    await ws.select(a)
    await expectStoreCount(page, 'itemLinks', 1)
    const [link] = await readStore<{ fromItemId: string; toItemId: string }>(page, 'itemLinks')
    expect(link).toMatchObject({ fromItemId: b, toItemId: a })
  })

  test('REG-329 Shift+click then a plain click links two items; linking the same pair again adds no duplicate', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.3, 0.3))!
    const b = (await ws.place('note', 0.7, 0.65))!
    const shiftClick = async (id: string) => {
      const box = (await ws.item(id).boundingBox())!
      await page.keyboard.down('Shift')
      await page.mouse.click(box.x + box.width / 2, box.y + 20)
      await page.keyboard.up('Shift')
    }
    await shiftClick(a)
    await expect(ws.pendingLinkHint).toBeVisible()
    await ws.select(b)
    await expect(ws.pendingLinkHint).toBeHidden()
    await expectStoreCount(page, 'itemLinks', 1)
    // The same pair again, the other way round, armed from B's Link button (two quick presses
    // on one note would count as a double-click and open its editor).
    await ws.item(b).hover()
    await ws.linkButton(b).click()
    await expect(ws.pendingLinkHint).toBeVisible()
    await ws.select(a)
    await expect(ws.pendingLinkHint).toBeHidden()
    await expect(ws.itemLinks).toHaveCount(1)
    // Sentinel: a third note linked to B makes two links in all.
    const c = (await ws.place('note', 0.5, 0.85))!
    await ws.linkItems(c, b)
    await expectStoreCount(page, 'itemLinks', 2)
  })

  test('REG-330 clicking a link selects it; Delete then removes only the link and Escape lets it go', { tag: '@P2' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.25, 0.3))!
    const b = (await ws.place('note', 0.75, 0.65))!
    await ws.linkItems(a, b)
    await expectStoreCount(page, 'itemLinks', 1)
    const [link] = await readStore<{ id: string }>(page, 'itemLinks')
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    await expect(ws.linkDelete(link.id)).toHaveCount(0)

    await ws.clickLink(link.id)
    await expect(ws.linkDelete(link.id)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ws.linkDelete(link.id)).toHaveCount(0)

    await ws.clickLink(link.id)
    await expect(ws.linkDelete(link.id)).toBeVisible()
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'itemLinks', 0)
    await expectStoreCount(page, 'workspaceItems', 2)
  })

  test('REG-068 Delete pressed in the PDF pane does not delete a selected link between two notes', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    knownDefect('DEF-305')
    const a = (await ws.place('note', 0.25, 0.3))!
    const b = (await ws.place('note', 0.75, 0.65))!
    await ws.linkItems(a, b)
    await expectStoreCount(page, 'itemLinks', 1)
    const [link] = await readStore<{ id: string }>(page, 'itemLinks')
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    await ws.clickLink(link.id)
    await expect(ws.linkDelete(link.id)).toBeVisible()
    // The user goes back to reading: a press in the PDF hands the keyboard to the document.
    await app.viewer.canvasOf(1).click()
    await page.keyboard.press('Delete')
    // Sentinel: a second link, then both must be there, the first one included.
    const c = (await ws.place('note', 0.5, 0.85))!
    await ws.linkItems(c, b)
    await expectStoreCount(page, 'itemLinks', 2)
    expect((await readStore<{ id: string }>(page, 'itemLinks')).map((l) => l.id)).toContain(link.id)
  })

  test('REG-331 the "Delete link" button on a highlighted link removes the link and keeps both notes', { tag: '@P3' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.25, 0.3))!
    const b = (await ws.place('note', 0.75, 0.65))!
    await ws.linkItems(a, b)
    await expectStoreCount(page, 'itemLinks', 1)
    const [link] = await readStore<{ id: string }>(page, 'itemLinks')
    // A is still selected after linking: a selected end highlights its links and shows their x.
    await ws.expectSelected(a)
    await ws.linkDelete(link.id).click()
    await expectStoreCount(page, 'itemLinks', 0)
    await expect(ws.itemLinks).toHaveCount(0)
    await expectStoreCount(page, 'workspaceItems', 2)
  })

  test('REG-332 a link keeps joining the edges of its notes after one of them is dragged', { tag: '@P3' }, async ({ ws, page }) => {
    const a = (await ws.place('note', 0.25, 0.3))!
    const b = (await ws.place('note', 0.75, 0.6))!
    await ws.linkItems(a, b)
    await expectStoreCount(page, 'itemLinks', 1)
    const [link] = await readStore<{ id: string }>(page, 'itemLinks')
    const onBorder = (p: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) => {
      const inside = p.x >= r.x - 0.5 && p.x <= r.x + r.width + 0.5 && p.y >= r.y - 0.5 && p.y <= r.y + r.height + 0.5
      const edge = Math.min(Math.abs(p.x - r.x), Math.abs(p.x - r.x - r.width), Math.abs(p.y - r.y), Math.abs(p.y - r.y - r.height))
      return inside && edge < 0.5
    }
    const before = await ws.linkEnds(link.id)
    await ws.dragItem(a, 60, 120)
    await expect.poll(async () => {
      const ends = await ws.linkEnds(link.id)
      return onBorder(ends.from, await ws.worldRect(a)) && onBorder(ends.to, await ws.worldRect(b)) && ends.from.y !== before.from.y
    }, { message: 'link ends sit on the borders of both notes' }).toBe(true)
  })
})

test.describe('Text boxes', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-333 a text box is edited on double-click, grows with extra lines, and keeps its text after a reload', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    const id = (await ws.place('text', 0.5, 0.3))!
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y) // leave the edit mode the tool opened
    await expect(ws.item(id).locator('textarea')).toHaveCount(0)
    const h0 = (await ws.worldRect(id)).height
    await ws.item(id).dblclick()
    const box = ws.item(id).locator('textarea')
    await expect(box).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('First line')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second line')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    const shown = ws.item(id).locator('div.whitespace-pre-wrap:not(.invisible)') // the visible text, not TextItem's hidden measuring copy
    await expect(shown).toHaveText('First line\nSecond line')
    await expect.poll(async () => (await ws.worldRect(id)).height).toBeGreaterThan(h0 + 10)
    await expect.poll(async () => (await row(page, id)).data.content).toBe('First line\nSecond line')
    // The grown height is the one saved, and it is what comes back after the reload.
    const grown = (await ws.worldRect(id)).height
    await expect.poll(async () => (await row(page, id)).height).toBeCloseTo(grown, 0)
    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(shown).toHaveText('First line\nSecond line')
    expect((await ws.worldRect(id)).height).toBeCloseTo(grown, 0)
  })

  test('REG-334 a selected text box offers six colours; the chosen one is saved and shown', { tag: '@P3' }, async ({ ws, page }) => {
    const id = (await ws.place('text', 0.5, 0.3))!
    await ws.select(id)
    const swatches = ws.item(id).locator('div.rounded-full > button')
    await expect(swatches).toHaveCount(6)
    expect(await swatches.evaluateAll((els) => els.map((e) => e.getAttribute('title')))).toEqual(['Default', 'Red', 'Orange', 'Green', 'Amber', 'Pink'])
    await ws.item(id).getByTitle('Red', { exact: true }).click()
    await expect.poll(async () => (await row(page, id)).data.color).toBe('#dc2626')
    await expect(ws.item(id).locator('div.whitespace-pre-wrap:not(.invisible)')).toHaveCSS('color', 'rgb(220, 38, 38)')
  })
})
