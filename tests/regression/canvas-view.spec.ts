/**
 * Regression: moving around the canvas and the bottom bar
 * (WorkspaceBottomBar.tsx, canvas/useCanvasEvents.ts wheel / middle-button,
 * canvas/MiniMap.tsx, WorkspacePane.tsx, WorkspaceIntro.tsx, the page-focus
 * and unlinked-notes filters in WorkspaceCanvas.tsx).
 * Zoom and pan are read from the world layer's transform; "stays under the
 * pointer" is checked by converting the same screen point to world units
 * before and after.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF } from '../../data/files.js'
import type { Page } from '@playwright/test'
import type { CanvasWorkbench } from '../../components/CanvasWorkbench.js'

/** The item is fully inside the canvas. Items far off-screen are culled from the DOM, which counts as not on screen. */
async function onScreen(ws: CanvasWorkbench, id: string) {
  if ((await ws.item(id).count()) === 0) return false
  const s = await ws.surfaceBox()
  const b = await ws.item(id).boundingBox()
  return !!b && b.x >= s.x && b.y >= s.y && b.x + b.width <= s.x + s.width && b.y + b.height <= s.y + s.height
}

const rows = (page: Page) => readStore<ItemRow<{ sourcePageNumber?: number | null }>>(page, 'workspaceItems')

test.describe('Canvas zoom and pan', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-379 Zoom out shrinks the canvas by 0.8 per click and stops at 10 %; clicking the percentage resets to 100 %', { tag: '@P2' }, async ({ ws }) => {
    const s0 = (await ws.transform()).scale
    await ws.zoomOut.click()
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(s0 * 0.8, 3)
    await expect(ws.zoomLabel).toHaveText(`${Math.round(s0 * 0.8 * 100)}%`)
    for (let i = 0; i < 15; i++) await ws.zoomOut.click()
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(0.1, 3)
    await expect(ws.zoomLabel).toHaveText('10%')

    await expect(ws.zoomLabel).toHaveAttribute('title', 'Reset to 100%')
    const before = await ws.transform()
    await ws.zoomLabel.click()
    // Only the zoom changes; the pan offset stays.
    await expect.poll(() => ws.transform()).toEqual({ ...before, scale: 1 })
    await expect(ws.zoomLabel).toHaveText('100%')
  })

  test('REG-381 the mouse wheel zooms around the pointer and stays between 10 % and 200 %', { tag: '@P2' }, async ({ ws }) => {
    // Whole pixels: the wheel event reports the pointer in whole CSS pixels.
    const raw = await ws.at(0.3, 0.35)
    const p = { x: Math.round(raw.x), y: Math.round(raw.y) }
    const s0 = (await ws.transform()).scale
    const w0 = await ws.screenToWorld(p)
    await ws.wheelAt(p, -100) // up: zoom in by 8 %
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(s0 * 1.08, 3)
    await ws.settled()
    const w1 = await ws.screenToWorld(p)
    // Within half a world unit: the transform is written with 3 decimals and the pointer in whole pixels.
    expect(Math.abs(w1.x - w0.x)).toBeLessThan(0.5)
    expect(Math.abs(w1.y - w0.y)).toBeLessThan(0.5)
    await ws.wheelAt(p, 100) // down: zoom out by 8 %
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(s0 * 1.08 * 0.92, 3)

    for (let i = 0; i < 40; i++) await ws.wheelAt(p, -100)
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(2, 3)
    for (let i = 0; i < 60; i++) await ws.wheelAt(p, 100)
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(0.1, 3)
    await expect(ws.zoomLabel).toHaveText('10%')
  })

  test('REG-382 Shift+wheel pans without zooming and Ctrl+wheel zooms finely', { tag: '@P3' }, async ({ ws }) => {
    const p = await ws.at(0.5, 0.5)
    const t0 = await ws.transform()
    await ws.wheelAt(p, 100, ['Shift'])
    await expect.poll(async () => { const t = await ws.transform(); return Math.round(Math.abs(t.x - t0.x) + Math.abs(t.y - t0.y)) }).toBe(100)
    expect((await ws.transform()).scale).toBe(t0.scale)
    await ws.settled()
    const t1 = await ws.transform()
    await ws.wheelAt(p, -10, ['Control']) // fine zoom: 1 - deltaY * 0.01 = 1.1
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(t1.scale * 1.1, 3)
  })

  test('REG-383 a middle-button drag pans the canvas even with Draw armed, and draws nothing', { tag: '@P2' }, async ({ ws, page }) => {
    await ws.tool('ink').click()
    const t0 = await ws.transform()
    await ws.drag(await ws.at(0.5, 0.5), await ws.at(0.3, 0.7), { button: 'middle', steps: 8 })
    const box = await ws.surfaceBox()
    await expect.poll(async () => { const t = await ws.transform(); return [Math.round(t.x - t0.x), Math.round(t.y - t0.y)] })
      .toEqual([Math.round(-0.2 * box.width), Math.round(0.2 * box.height)])
    expect(await ws.isArmed('ink')).toBe(true)
    // Sentinel stroke: had the middle drag drawn, there would be two.
    await ws.horizontalStroke(0.4, 0.2, 0.4)
    await expectStoreCount(page, 'canvasStrokes', 1)
  })

  test('REG-391 a two-finger pinch zooms the canvas around the fingers', { tag: '@P3' }, async ({ ws, page }) => {
    // Emulated input: Playwright has no multi-touch gesture API, so real touch events are sent
    // through the browser's DevTools protocol (Input.dispatchTouchEvent), as a finger pair would.
    const cdp = await page.context().newCDPSession(page)
    const c = await ws.at(0.5, 0.5)
    const s0 = (await ws.transform()).scale
    const w0 = await ws.screenToWorld(c)
    const fingers = (half: number) => [{ x: c.x - half, y: c.y, id: 1 }, { x: c.x + half, y: c.y, id: 2 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40) })
    for (const half of [48, 56, 64, 72, 80]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(half) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    // Fingers twice as far apart: twice the zoom, with the point between them fixed.
    await expect.poll(async () => (await ws.transform()).scale).toBeCloseTo(Math.min(2, s0 * 2), 2)
    const w1 = await ws.screenToWorld(c)
    expect(Math.abs(w1.x - w0.x)).toBeLessThan(1)
    expect(Math.abs(w1.y - w0.y)).toBeLessThan(1)
    await cdp.detach()
  })

  test('REG-384 "Fit all notes on screen" brings every item back into view after panning away, never above 100 %', { tag: '@P2' }, async ({ ws }) => {
    const ids = [(await ws.place('note', 0.2, 0.25))!, (await ws.place('note', 0.8, 0.75))!]
    await ws.panBy(-500, -400, [0.9, 0.9])
    await ws.panBy(-500, -400, [0.9, 0.9])
    for (const id of ids) expect(await onScreen(ws, id)).toBe(false)
    await expect(ws.fitAll).toHaveAttribute('title', 'Fit all notes on screen')
    await ws.fitAll.click()
    await ws.settled()
    for (const id of ids) await expect.poll(() => onScreen(ws, id), { message: `item ${id} visible after fit` }).toBe(true)
    expect((await ws.transform()).scale).toBeLessThanOrEqual(1)
  })
})

test.describe('Canvas pane states', { tag: ['@regression', '@canvas'] }, () => {
  test('REG-385 with no document open the pane explains itself; an empty canvas shows its hint until something is placed', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    await expect(ws.emptyHint).toBeVisible()
    await expect(ws.surface.getByText('Workspace', { exact: true })).toBeVisible()
    const id = (await ws.place('note', 0.5, 0.5))!
    await expect(ws.emptyHint).toBeHidden()
    await ws.select(id)
    await page.keyboard.press('Delete')
    await expect(ws.emptyHint).toBeVisible()

    await app.viewer.backToDocuments.click()
    await expect(page.getByRole('heading', { name: 'Read on one side, think on the other' })).toBeVisible()
    await expect(page.getByText('Choose a document from the list on the left')).toBeVisible()
    await expect(ws.surface).toHaveCount(0)
    await expect(ws.controls).toHaveCount(0)
  })

  test('REG-386 the mini-map marks the selected item and clicking a spot on it centres the canvas there', { tag: '@P3' }, async ({ ws, page }) => {
    knownDefect('DEF-309')
    const a = (await ws.place('note', 0.25, 0.3))!
    const b = (await ws.place('note', 0.75, 0.7))!
    await ws.minimapToggle.click()
    await expect(ws.minimapHeader).toContainText('Mini Map')
    await expect(ws.minimapItem(b)).toHaveCSS('opacity', '1') // B is selected
    await expect(ws.minimapItem(a)).toHaveCSS('opacity', '0.7')

    // Clicking B's mark centres the canvas on B (to within the mark's size on the map).
    const mark = (await ws.minimapItem(b).boundingBox())!
    await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2)
    const surface = await ws.surfaceBox()
    await expect.poll(async () => {
      const c = await ws.itemCentre(b)
      const off = { x: Math.round(c.x - (surface.x + surface.width / 2)), y: Math.round(c.y - (surface.y + surface.height / 2)) }
      return Math.abs(off.x) < 12 && Math.abs(off.y) < 12 ? 'centred' : `off by ${off.x}, ${off.y} px`
    }, { message: 'B is in the middle of the canvas' }).toBe('centred')
  })

  test('REG-387 page focus shows only the open page\'s notes: new notes belong to that page, and leaving focus shows them all', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    await expect(ws.pageFocus).toHaveAttribute('title', 'Page focus — review one page at a time')
    await expect(ws.pageFocus).toBeEnabled()
    await ws.pageFocus.click()
    await expect(ws.pageFocus).toHaveAttribute('title', 'Exit page focus')
    const onPage1 = (await ws.place('note', 0.3, 0.3))!
    await app.viewer.next.click()
    await app.viewer.expectPage(2, FIND_PDF.pageCount)
    await expect(ws.item(onPage1)).toHaveCount(0)
    const onPage2 = (await ws.place('note', 0.6, 0.6))!
    await expect.poll(async () => Object.fromEntries((await rows(page)).map((r) => [r.id, r.data.sourcePageNumber]))).toEqual({ [onPage1]: 1, [onPage2]: 2 })
    await app.viewer.prev.click()
    await app.viewer.expectPage(1, FIND_PDF.pageCount)
    await expect(ws.item(onPage2)).toHaveCount(0)
    await expect(ws.item(onPage1)).toBeVisible()
    await ws.pageFocus.click()
    await expect(ws.pageFocus).toHaveAttribute('title', 'Page focus — review one page at a time')
    await expect(ws.item(onPage1)).toBeVisible()
    await expect(ws.item(onPage2)).toBeVisible()
  })

  test('REG-388 "Show unlinked notes" rings every note not linked to the PDF; removing a note\'s link makes it unlinked', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    const loose = (await ws.place('note', 0.75, 0.75))!
    await app.viewer.tool('select-area').click()
    await app.viewer.dragOnPage(1, [0.08, 0.13], [0.8, 0.2])
    await expectStoreCount(page, 'areaLinks', 1)
    const linked = (await readStore<{ workspaceItemId: string }>(page, 'areaLinks'))[0].workspaceItemId
    await expect(ws.item(linked)).toContainText('PAGE 1')

    await expect(ws.unlinkedToggle).toHaveAttribute('title', 'Show unlinked notes')
    await ws.unlinkedToggle.click()
    await expect(ws.unlinkedToggle).toHaveAttribute('title', 'Hide unlinked notes')
    await expect(ws.item(loose)).toHaveClass(/ring-yellow-400/)
    await expect(ws.item(linked)).not.toHaveClass(/ring-yellow-400/)

    await ws.item(linked).getByRole('button', { name: 'Remove link' }).click()
    await expectStoreCount(page, 'areaLinks', 0)
    await expect(ws.item(linked)).toHaveClass(/ring-yellow-400/)
    await expectStoreCount(page, 'workspaceItems', 2) // the note itself stays
    await ws.unlinkedToggle.click()
    await expect(ws.item(loose)).not.toHaveClass(/ring-yellow-400/)
  })
})
