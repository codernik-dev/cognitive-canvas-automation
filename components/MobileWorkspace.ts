/**
 * The phone workspace (MobileWorkspaceSplit and what it hosts):
 *
 *   modes      the Document / Split / Canvas switch (data-tour="mobile-mode-switch")
 *              and the Split divider ("Drag to resize panes")
 *   status     MobileDocStatusBar: "Page N / total", the page-thumbnail toggle
 *              and the shared ZoomControls
 *   strip      MobilePageStrip, the thumbnail rail (data-thumb-page buttons)
 *   docDial    MobileDocToolBox: a round FAB ("Document tools") that opens a
 *              bottom sheet of tool tiles (data-tool), plus the palette drawer
 *              and the Undo / Redo pair that ride beside the FAB
 *   canvasDial MobileCanvasToolBox: the same for the canvas (data-ws-tool)
 *
 * The tool sheets are portalled to <body> and carry no role; each is found
 * as the aria-hidden root that holds its title text.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export class ToolDial {
  /** The FAB: named by its title ("Document tools" / "Canvas tools"), aria-expanded while the sheet is open. */
  readonly fab: Locator
  /** The bottom sheet's root (aria-hidden="false" while open). */
  readonly sheet: Locator
  constructor(private readonly page: Page, readonly title: 'Document tools' | 'Canvas tools', private readonly hook: 'data-tool' | 'data-ws-tool') {
    this.fab = page.locator(`button[aria-expanded][title="${title}"]`)
    this.sheet = page.locator('div[aria-hidden]').filter({ has: page.getByText(title, { exact: true }) })
  }

  /** A tool tile in the sheet, by its product hook (data-tool / data-ws-tool). */
  tile(id: string) { return this.sheet.locator(`button[${this.hook}="${id}"]`) }
  /** A tile by its visible label ("Tour" has no hook). */
  tileNamed(label: string) { return this.sheet.getByRole('button', { name: label, exact: true }) }
  /** Tile labels in order. */
  async tileLabels(): Promise<string[]> {
    return this.sheet.locator('button[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''))
  }
  /** The tile's square (bg-primary-500 while that tool is armed). */
  tileFace(id: string) { return this.tile(id).locator('span').first() }

  async open() {
    await this.fab.click()
    await expect(this.fab).toHaveAttribute('aria-expanded', 'true')
    await expect(this.sheet).toHaveAttribute('aria-hidden', 'false')
  }

  async expectClosed() {
    await expect(this.fab).toHaveAttribute('aria-expanded', 'false')
    await expect(this.sheet).toHaveAttribute('aria-hidden', 'true')
  }

  /** Open the sheet and tap a tile; the sheet closes itself. */
  async pick(id: string) {
    await this.open()
    await this.tile(id).click()
    await this.expectClosed()
  }

  /** The dimmed backdrop over the page while the sheet is open: the root's first child (no role). */
  get backdrop() { return this.sheet.locator('> div').first() }

  /** The arrow that slides the colour / size drawer out (aria-label = its title). */
  drawer(title: 'Pen / Highlighter' | 'Eraser size' | 'Ink colour') { return this.page.getByRole('button', { name: title, exact: true }) }
}

export class MobileWorkspace {
  readonly modes: Locator
  readonly docDial: ToolDial
  readonly canvasDial: ToolDial
  readonly docPane: Locator
  readonly wsPane: Locator
  constructor(private readonly page: Page) {
    this.modes = page.locator('[data-tour="mobile-mode-switch"]')
    this.docDial = new ToolDial(page, 'Document tools', 'data-tool')
    this.canvasDial = new ToolDial(page, 'Canvas tools', 'data-ws-tool')
    this.docPane = page.locator('[data-tour="doc-pane"]')
    this.wsPane = page.locator('[data-tour="ws-pane"]')
  }

  mode(name: 'Document' | 'Split' | 'Canvas') { return this.modes.getByRole('button', { name, exact: true }) }
  get divider() { return this.page.getByRole('button', { name: 'Drag to resize panes' }) }
  /** The row holding both panes; its width is the 100 % the split ratio refers to. */
  get paneRow() { return this.docPane.locator('xpath=..') }

  // ── Status bar ──
  get pagesToggle() { return this.page.getByRole('button', { name: 'Toggle page thumbnails' }) }
  /** "Page N / total" (the page number is in its own <b>). */
  get pageLabel() { return this.page.getByText(/^Page \d+ \/ \d+$/) }
  get zoomIn() { return this.page.getByRole('button', { name: 'Zoom in' }) }
  get zoomOut() { return this.page.getByRole('button', { name: 'Zoom out' }) }
  get zoomReset() { return this.page.getByRole('button', { name: /^\d+%$/ }) }

  // ── Thumbnail rail ──
  get thumbs() { return this.page.locator('button[data-thumb-page]') }
  thumb(n: number) { return this.page.locator(`button[data-thumb-page="${n}"]`) }

  /**
   * Page n's highlight layer while the Highlight or Eraser tool is really
   * armed on it: it takes pointer events only then (PdfHighlightLayer.tsx).
   * No role or hook: the inset overlay holding the 0..1 SVG.
   */
  drawLayer(n: number) {
    return this.page.locator(`[data-page="${n}"] div.absolute.inset-0[style*="pointer-events: auto"]:has(> svg[viewBox="0 0 1 1"])`)
  }

  // ── Undo / Redo beside the document FAB ──
  get undo() { return this.page.getByRole('button', { name: 'Undo', exact: true }) }
  get redo() { return this.page.getByRole('button', { name: 'Redo', exact: true }) }

  /** Fraction of the pane row the document pane takes (0..1). */
  async docShare(): Promise<number> {
    const row = await this.paneRow.boundingBox()
    const doc = await this.docPane.boundingBox()
    if (!row || !doc) throw new Error('pane row or document pane has no box')
    return doc.width / row.width
  }
}
