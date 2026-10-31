/**
 * The workspace canvas, extended for the canvas module specs: the tool
 * palette's drawers, strokes, the context menu, item buttons, links and the
 * media/document dialogs that open from the canvas.
 *
 * Builds on CanvasPane (geometry model documented there):
 *   screen = surface.left/top + transform.x/y + world * scale
 *
 * Several controls carry no role or name of their own (the palette drawer,
 * the context menu, the document picker, item-link paths). Where that is so,
 * the most stable structural locator is used and the reason is written
 * beside it, so the specs never hold selectors.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { CanvasPane, type CanvasTool } from './CanvasPane.js'

export type InkColour = 'Amber' | 'Teal' | 'Red' | 'Green' | 'Pink' | 'Violet' | 'Black' | 'White'
export type EraserSize = 'Small' | 'Medium' | 'Large' | 'Extra Large'
export type ContextMenuEntry =
  | 'Duplicate' | 'Delete' | `Delete (${number})` | 'Bring to Front' | 'Send to Back' | 'Align Left' | 'Align Top'
  | 'Distribute H' | 'Distribute V' | 'Select All' | 'Reset View'
/** Resize handles in DOM order (ResizeHandles.tsx). */
export const HANDLE_ORDER = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Handle = (typeof HANDLE_ORDER)[number]

export interface Point { x: number; y: number }

/** Palette titles, top to bottom (WorkspaceToolPalette.tsx). */
export const PALETTE_TITLES: Record<CanvasTool, string> = {
  pan: 'Pan', note: 'Note', text: 'Text', ink: 'Draw', eraser: 'Eraser', line: 'Line', audio: 'Audio', video: 'Video', document: 'Document',
}

export class CanvasWorkbench extends CanvasPane {
  /**
   * The palette root. It has no role or hook of its own; it is the element
   * whose inner column holds the Pan button.
   */
  readonly palette: Locator
  readonly toolGuide: Locator
  readonly toolsTour: Locator
  /**
   * The right-click menu (ContextMenu.tsx) is a plain fixed div of buttons
   * with no role; its min-width class is the only thing that tells it apart.
   */
  readonly contextMenu: Locator
  readonly emptyHint: Locator

  constructor(private readonly pg: Page) {
    super(pg)
    this.palette = pg.locator('div:has(> div > button[data-ws-tool="pan"])')
    this.toolGuide = pg.locator('[data-tour="info-ws"]')
    this.toolsTour = pg.locator('[data-tour="ws-tools-tour"]')
    this.contextMenu = pg.locator('div.fixed.z-50.min-w-\\[170px\\]')
    this.emptyHint = pg.getByText('Scroll to zoom · Drag to pan · Use tools on the right')
  }

  // ── Palette ──
  paletteButtons() { return this.palette.locator('button[data-ws-tool]') }
  inkColour(c: InkColour) { return this.palette.getByTitle(c, { exact: true }) }
  eraserSize(s: EraserSize) { return this.palette.getByTitle(s, { exact: true }) }
  /** The arrow beside an open drawer: title "Close" while open, "Open" while folded. */
  drawerArrow(state: 'Open' | 'Close') { return this.palette.getByTitle(state, { exact: true }) }
  /** The palette marks the armed tool with the primary background (its only visible state). */
  async isArmed(t: CanvasTool) {
    return (await this.tool(t).getAttribute('class'))?.split(/\s+/).includes('bg-primary-500') ?? false
  }

  // ── Bottom bar ──
  get pageFocus() { return this.controls.getByRole('button', { name: /^(Page focus — review one page at a time|Exit page focus|Page focus is available only on PDFs)$/ }) }
  get unlinkedToggle() { return this.controls.getByRole('button', { name: /^(Show|Hide) unlinked notes$/ }) }
  get minimapHeader() { return this.pg.locator('[data-minimap-drag]') }
  /** The mini-map panel is the header's parent; its content area is the header's next sibling. */
  get minimapPanel() { return this.minimapHeader.locator('xpath=..') }
  get minimapContent() { return this.minimapHeader.locator('xpath=following-sibling::div[1]') }
  minimapItem(id: string) { return this.pg.locator(`[data-minimap-item="${id}"]`) }


  // ── Strokes (CanvasStrokeLayer.tsx renders one <g> per stroke in the first svg of the world layer) ──
  get strokeLayer() { return this.world.locator(':scope > svg').first() }
  get strokeGroups() { return this.strokeLayer.locator(':scope > g') }
  get linkedStrokeHits() { return this.world.locator('[data-stroke-hit]') }

  // ── Items ──
  resizeHandles(id: string) { return this.item(id).locator('[data-resize-handle]') }
  handle(id: string, h: Handle) { return this.resizeHandles(id).nth(HANDLE_ORDER.indexOf(h)) }
  deleteButton(id: string) { return this.item(id).getByRole('button', { name: 'Delete item' }) }
  linkButton(id: string) { return this.item(id).getByRole('button', { name: /^(Link to another item|Cancel linking)$/ }) }
  lineDelete(id: string) { return this.item(id).getByRole('button', { name: 'Delete line' }) }
  lineHandles(id: string) { return this.item(id).locator('circle[data-line-handle]') }
  menuItem(name: ContextMenuEntry | RegExp) { return this.contextMenu.getByRole('button', { name, exact: typeof name === 'string' }) }

  // ── Item links (ItemLinkOverlay.tsx) ──
  linkGroup(linkId: string) { return this.pg.locator(`g[data-item-link="${linkId}"]`) }
  linkDelete(linkId: string) { return this.pg.locator(`[data-item-link-delete="${linkId}"]`).getByRole('button', { name: 'Delete link' }) }

  // ── Geometry ──
  async surfaceBox() {
    const box = await this.surface.boundingBox()
    if (!box) throw new Error('canvas surface has no box')
    return box
  }

  async worldToScreen(p: Point): Promise<Point> {
    const [box, t] = await Promise.all([this.surfaceBox(), this.transform()])
    return { x: box.x + t.x + p.x * t.scale, y: box.y + t.y + p.y * t.scale }
  }

  async screenToWorld(p: Point): Promise<Point> {
    const [box, t] = await Promise.all([this.surfaceBox(), this.transform()])
    return { x: (p.x - box.x - t.x) / t.scale, y: (p.y - box.y - t.y) / t.scale }
  }

  /** Screen point at a fraction of the surface, as a Point. */
  async at(fx: number, fy: number): Promise<Point> {
    const [x, y] = await this.pointAt(fx, fy)
    return { x, y }
  }

  /** Press, move in steps and release, in screen pixels. */
  async drag(from: Point, to: Point, opts: { steps?: number; button?: 'left' | 'middle' | 'right'; modifiers?: Array<'Shift' | 'Control'> } = {}) {
    for (const m of opts.modifiers ?? []) await this.pg.keyboard.down(m)
    await this.pg.mouse.move(from.x, from.y)
    await this.pg.mouse.down({ button: opts.button ?? 'left' })
    await this.pg.mouse.move(to.x, to.y, { steps: opts.steps ?? 10 })
    await this.pg.mouse.up({ button: opts.button ?? 'left' })
    for (const m of opts.modifiers ?? []) await this.pg.keyboard.up(m)
  }

  /** Draw a polyline with the armed tool (screen pixels), one move per point. */
  async stroke(points: Point[]) {
    await this.pg.mouse.move(points[0].x, points[0].y)
    await this.pg.mouse.down()
    for (const p of points.slice(1)) await this.pg.mouse.move(p.x, p.y, { steps: 2 })
    await this.pg.mouse.up()
  }

  /** A horizontal stroke across the surface, `n` points between two fractions. */
  async horizontalStroke(fy: number, fx0: number, fx1: number, n = 12) {
    const a = await this.at(fx0, fy)
    const b = await this.at(fx1, fy)
    const pts = Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / (n - 1), y: a.y }))
    await this.stroke(pts)
  }

  async itemCentre(id: string): Promise<Point> {
    const box = await this.item(id).boundingBox()
    if (!box) throw new Error(`item ${id} not on screen`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  /** Right-click an item (its upper part, clear of the footer buttons). */
  async rightClickItem(id: string) {
    const box = await this.item(id).boundingBox()
    if (!box) throw new Error(`item ${id} not on screen`)
    await this.pg.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 30), { button: 'right' })
    await expect(this.contextMenu).toBeVisible()
  }

  async rightClickAt(p: Point) {
    await this.pg.mouse.click(p.x, p.y, { button: 'right' })
    await expect(this.contextMenu).toBeVisible()
  }

  /** Ctrl+click an item to add it to the selection. */
  async addToSelection(id: string) {
    const box = await this.item(id).boundingBox()
    if (!box) throw new Error(`item ${id} not on screen`)
    await this.pg.keyboard.down('Control')
    await this.pg.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 20))
    await this.pg.keyboard.up('Control')
  }

  /** Selected items show their resize handles (notes, images) or a ring; the store is the truth, read via handles here. */
  async expectSelected(id: string) {
    await expect(this.resizeHandles(id)).toHaveCount(8)
  }

  /**
   * Click an item link on its drawn curve. The main path is
   * `M x1 y1 Q cx cy x2 y2` in world units; a quadratic's midpoint is
   * (P0 + 2C + P2) / 4, which always lies outside both items.
   */
  async clickLink(linkId: string) {
    const d = await this.linkGroup(linkId).locator('path[data-link-path="main"]').getAttribute('d')
    const n = (d?.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    if (n.length !== 6) throw new Error(`unexpected link path "${d}"`)
    const mid = { x: (n[0] + 2 * n[2] + n[4]) / 4, y: (n[1] + 2 * n[3] + n[5]) / 4 }
    const p = await this.worldToScreen(mid)
    await this.pg.mouse.click(p.x, p.y)
  }

  /** Endpoints of a link curve, world units. */
  async linkEnds(linkId: string): Promise<{ from: Point; to: Point }> {
    const d = await this.linkGroup(linkId).locator('path[data-link-path="main"]').getAttribute('d')
    const n = (d?.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    return { from: { x: n[0], y: n[1] }, to: { x: n[4], y: n[5] } }
  }

  /** Wheel over a screen point (deltaY > 0 zooms out, as in the app). */
  async wheelAt(p: Point, deltaY: number, modifiers: Array<'Shift' | 'Control'> = []) {
    await this.pg.mouse.move(p.x, p.y)
    for (const m of modifiers) await this.pg.keyboard.down(m)
    await this.pg.mouse.wheel(0, deltaY)
    for (const m of modifiers) await this.pg.keyboard.up(m)
  }
}

/** The dialogs the media and document tools open on the canvas. */
export class CanvasDialogs {
  constructor(private readonly page: Page) {}

  get audio() { return this.page.getByRole('dialog', { name: 'New Audio Note' }) }
  get video() { return this.page.getByRole('dialog', { name: 'New Video Note' }) }
  get noteEditor() { return this.page.getByRole('dialog', { name: 'Edit Note' }) }
  get imageEditor() { return this.page.getByRole('dialog', { name: 'Edit Image' }) }
  /**
   * DocumentPickerModal.tsx renders no dialog role: the panel is the
   * element holding the "Embed Document" heading.
   */
  get documentPicker() { return this.page.locator('div.w-\\[380px\\]').filter({ has: this.page.getByRole('heading', { name: 'Embed Document' }) }) }

  /** Name field, tabs, file input and buttons of a media dialog (MediaNoteShell.tsx). */
  media(dialog: Locator, kind: 'Audio' | 'Video') {
    return {
      name: dialog.getByPlaceholder(`${kind} name...`),
      tab: (t: 'Upload' | 'Record' | 'Link') => dialog.getByRole('tab', { name: t }),
      file: dialog.locator('input[type=file]'),
      create: dialog.getByRole('button', { name: /^(Create|Creating…)$/ }),
      cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
      remove: dialog.getByRole('button', { name: 'Remove', exact: true }),
      required: dialog.getByText('Required — name it so you can find it on the canvas later.'),
      start: dialog.getByRole('button', { name: 'Start recording' }),
      stop: dialog.getByRole('button', { name: 'Stop recording' }),
      pause: dialog.getByRole('button', { name: 'Pause', exact: true }),
      resume: dialog.getByRole('button', { name: 'Resume', exact: true }),
      recordAgain: dialog.getByRole('button', { name: 'Record again' }),
      link: dialog.getByRole('textbox', { name: `${kind} link` }),
    }
  }
}
