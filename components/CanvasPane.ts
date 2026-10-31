/**
 * The workspace canvas (right pane): tool palette, items, links, pan/zoom.
 *
 * Geometry model (WorkspaceCanvas.tsx, canvas/CanvasCamera.ts):
 *   - each item wrapper carries its WORLD x/y/w/h as inline left/top/width/height;
 *   - the world layer `[data-workspace-canvas] > div.origin-top-left` carries
 *     `translate(Xpx, Ypx) scale(S)`;
 *   - screen = container.left/top + X + world * S.
 * Items far off-screen are culled from the DOM, so COUNTS come from IndexedDB
 * (helpers/idb.ts); the DOM is for geometry and interaction only.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export type CanvasTool = 'pan' | 'note' | 'text' | 'ink' | 'eraser' | 'line' | 'audio' | 'video' | 'document'

export interface Transform { x: number; y: number; scale: number }
export interface Rect { x: number; y: number; width: number; height: number }

export class CanvasPane {
  readonly pane: Locator
  readonly surface: Locator
  readonly world: Locator
  readonly controls: Locator
  constructor(private readonly page: Page) {
    this.pane = page.locator('[data-tour="ws-pane"]')
    this.surface = page.locator('[data-workspace-canvas]')
    this.world = page.locator('[data-workspace-canvas] > div.origin-top-left')
    this.controls = page.locator('[data-tour="canvas-controls"]')
  }

  tool(t: CanvasTool) { return this.page.locator(`button[data-ws-tool="${t}"]`) }
  get items() { return this.page.locator('[data-workspace-item][data-item-id]') }
  item(id: string) { return this.page.locator(`[data-workspace-item][data-item-id="${id}"]`) }
  get itemLinks() { return this.page.locator('g[data-item-link]') }
  get lines() { return this.page.locator('svg[data-line-id]') }
  get pendingLinkHint() { return this.page.getByText('Click another item to link · Esc to cancel') }

  // Bottom bar (titles are the accessible names)
  get zoomIn() { return this.controls.getByRole('button', { name: 'Zoom in' }) }
  get zoomOut() { return this.controls.getByRole('button', { name: 'Zoom out' }) }
  get zoomLabel() { return this.controls.getByRole('button', { name: /^\d+%$/ }) }
  get fitAll() { return this.page.locator('[data-tour="canvas-reset"]') }
  get timelineToggle() { return this.controls.getByRole('button', { name: /^(Timeline view|Canvas view)$/ }) }
  get minimapToggle() { return this.controls.getByRole('button', { name: 'Toggle mini-map' }) }
  get minimap() { return this.page.locator('[data-minimap-drag]') }

  async zoomPercent(): Promise<number> {
    return Number((await this.zoomLabel.innerText()).replace('%', ''))
  }

  async transform(): Promise<Transform> {
    const t = await this.world.evaluate((el) => (el as HTMLElement).style.transform)
    const m = t.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\((-?[\d.]+)\)/)
    if (!m) throw new Error(`unparsable canvas transform "${t}"`)
    return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) }
  }

  /** Item ids currently in the DOM, in document order. */
  async itemIds(): Promise<string[]> {
    return this.items.evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')!))
  }

  /** The item's world rect, from its inline style. */
  async worldRect(id: string): Promise<Rect> {
    return this.item(id).evaluate((el) => {
      const s = (el as HTMLElement).style
      return { x: parseFloat(s.left), y: parseFloat(s.top), width: parseFloat(s.width), height: parseFloat(s.height) }
    })
  }

  /** Viewport point at a fraction of the canvas surface. */
  async pointAt(fx: number, fy: number): Promise<[number, number]> {
    const box = await this.surface.boundingBox()
    if (!box) throw new Error('canvas surface has no box')
    return [box.x + box.width * fx, box.y + box.height * fy]
  }

  /**
   * Arm a tool and click the canvas at a fraction of its surface. Returns the
   * id of the item that appeared (note/text tools place immediately; the
   * media/document tools open a dialog instead and return null).
   */
  async place(t: CanvasTool, fx = 0.5, fy = 0.5): Promise<string | null> {
    const before = new Set(await this.itemIds())
    await this.tool(t).click()
    const [x, y] = await this.pointAt(fx, fy)
    await this.page.mouse.click(x, y)
    if (t !== 'note' && t !== 'text') return null
    let created: string | undefined
    await expect
      .poll(async () => (created = (await this.itemIds()).find((id) => !before.has(id))), { message: `no item appeared after placing a ${t}` })
      .toBeTruthy()
    return created!
  }

  async select(id: string) {
    const box = await this.item(id).boundingBox()
    if (!box) throw new Error(`item ${id} not on screen`)
    await this.page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 20))
  }

  /** Drag an item by its centre, in screen pixels, with real pointer input (pointer capture needs it). */
  async dragItem(id: string, dx: number, dy: number) {
    const box = await this.item(id).boundingBox()
    if (!box) throw new Error(`item ${id} not on screen`)
    const x = box.x + box.width / 2
    const y = box.y + Math.min(box.height / 2, 20)
    await this.page.mouse.move(x, y)
    await this.page.mouse.down()
    await this.page.mouse.move(x + dx, y + dy, { steps: 10 })
    await this.page.mouse.up()
  }

  /** Drag on empty canvas (pans the view). Waits for inertia to settle. */
  async panBy(dx: number, dy: number, from: [number, number] = [0.15, 0.85]) {
    const [x, y] = await this.pointAt(...from)
    await this.page.mouse.move(x, y)
    await this.page.mouse.down()
    await this.page.mouse.move(x + dx, y + dy, { steps: 8 })
    await this.page.mouse.up()
    await this.settled()
  }

  /** Resolve once the transform stops changing (pan inertia, zoom commit). */
  async settled() {
    let last = ''
    await expect
      .poll(async () => {
        const now = JSON.stringify(await this.transform())
        const same = now === last
        last = now
        return same
      }, { intervals: [150, 150, 200, 250, 300], message: 'canvas transform kept moving' })
      .toBe(true)
  }

  /** Open the note editor (double-click) and return its dialog. */
  async openNoteEditor(id: string) {
    const box = await this.item(id).boundingBox()
    if (!box) throw new Error(`note ${id} not on screen`)
    await this.page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    const dialog = this.page.getByRole('dialog', { name: 'Edit Note' })
    await expect(dialog).toBeVisible()
    return dialog
  }

  /** Type into a note through its editor and save with Done. */
  async writeNote(id: string, text: string) {
    const dialog = await this.openNoteEditor(id)
    const editor = dialog.locator('[contenteditable="true"]').first()
    await editor.click()
    await this.page.keyboard.type(text)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(dialog).toBeHidden()
  }

  /** Start an item-to-item link from `from` (its Link button), then click `to`. */
  async linkItems(from: string, to: string) {
    await this.select(from)
    await this.item(from).getByRole('button', { name: 'Link to another item' }).click()
    await expect(this.pendingLinkHint).toBeVisible()
    await this.select(to)
  }

  /** Endpoints of an area-link thread (ConnectionThreads.tsx draws `M fx fy C … tx ty`). */
  async threadEndpoints(areaLinkId: string): Promise<{ from: [number, number]; to: [number, number]; visible: boolean }> {
    return this.page.locator(`g#area-${areaLinkId}`).evaluate((g) => {
      const d = g.querySelectorAll('path')[1]?.getAttribute('d') ?? ''
      const nums = (d.match(/-?[\d.]+/g) ?? []).map(Number)
      if (nums.length < 8) throw new Error(`thread path "${d}" has no curve`)
      return { from: [nums[0], nums[1]], to: [nums[nums.length - 2], nums[nums.length - 1]], visible: (g as SVGGElement).style.opacity === '1' }
    })
  }
}
