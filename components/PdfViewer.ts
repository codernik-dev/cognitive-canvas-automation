/**
 * The document pane: pdf.js viewer, page navigation, zoom, the doc-tools
 * toolbar and the find bar.
 *
 * Pages are virtualised (PdfViewer.tsx / PdfPageView.tsx): a page's canvas
 * is 0x0 until it scrolls near the viewport, and overlays mount only after
 * the first render. pageRendered() is the wait every page interaction uses.
 */
import { expect, type Locator, type Page } from '@playwright/test'

const RENDER_TIMEOUT = 30_000

export type DocTool ='pan' | 'select-area' | 'highlight' | 'highlight-eraser' | 'extract-image' | 'link-area' | 'ocr' | 'link-doc' | 'find'
export type HighlightColour = 'Important' | 'Critical' | 'Agree' | 'Reference' | 'Question' | 'Revisit'

export class PdfViewer {
  readonly pane: Locator
  readonly nav: Locator
  constructor(private readonly page: Page) {
    this.pane = page.locator('[data-tour="doc-pane"]')
    this.nav = page.locator('[data-tour="page-nav"]')
  }

  // ── Header ──
  get backToDocuments() { return this.page.getByRole('button', { name: 'Back to documents' }) }
  /** The document switcher in the header carries the open document's name. */
  documentTitle(name: string) { return this.page.locator('[data-tour="header-bar"]').getByRole('button', { name, exact: true }) }
  get pageIndexToggle() { return this.page.locator('[data-tour="header-index"]') }

  // ── Pages ──
  get scroller() { return this.page.locator('[data-pdf-scroll="true"]') }
  pageEl(n: number) { return this.page.locator(`[data-page="${n}"]:not([data-placeholder="true"])`) }
  canvasOf(n: number) { return this.pageEl(n).locator('canvas.pdf-page-canvas') }
  get mountedPages() { return this.page.locator('[data-page]:not([data-placeholder="true"])') }

  /**
   * Wait until page n has a real (non-zero) rendered canvas. pdf.js rendering
   * is CPU-bound, so this readiness wait allows for a loaded machine (run 4:
   * >10 s beside three busy workers). Render SPEED is asserted separately,
   * in isolation, by the performance budgets (PRF-002).
   */
  async pageRendered(n: number) {
    await expect(this.pageEl(n)).toBeAttached({ timeout: RENDER_TIMEOUT })
    await expect
      .poll(() => this.canvasOf(n).evaluate((c: HTMLCanvasElement) => c.width).catch(() => 0), { message: `page ${n} canvas never rendered`, timeout: RENDER_TIMEOUT })
      .toBeGreaterThan(0)
  }

  // ── Navigation ──
  get prev() { return this.nav.getByRole('button', { name: 'Previous page' }) }
  get next() { return this.nav.getByRole('button', { name: 'Next page' }) }
  get pageButton() { return this.nav.getByRole('button', { name: /^\d+\/\d+$/ }) }
  get pageInput() { return this.nav.getByRole('spinbutton').or(this.nav.getByRole('textbox')) }

  /**
   * The page the navigator reports AND the page actually in view. The label
   * alone proves little: the app writes the target number into it before the
   * scroll starts, and on reopen copies it from the stored last page.
   */
  async expectPage(current: number, total: number) {
    await expect(this.pageButton).toHaveText(`${current}/${total}`)
    await expect.poll(() => this.pageInView(), { message: `page ${current} is the one in view` }).toBe(current)
  }

  /**
   * The page in view. Continuous scroll: the page whose centre is nearest the
   * scroller's middle, the app's own rule (PdfViewer.tsx updateCurrentPage).
   * Single-page view has no such scroller and mounts only the page it shows.
   */
  pageInView(): Promise<number> {
    return this.page.evaluate(() => {
      const c = document.querySelector<HTMLElement>('[data-pdf-scroll="true"]')
      if (!c) {
        const shown = [...document.querySelectorAll<HTMLElement>('[data-page]:not([data-placeholder="true"])')]
        return shown.length === 1 ? Number(shown[0].dataset.page) : 0
      }
      const mid = c.scrollTop + c.clientHeight / 2
      let best = 0
      let bestDist = Infinity
      for (const el of c.querySelectorAll<HTMLElement>('[data-page]')) {
        const dist = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid)
        if (dist < bestDist) { bestDist = dist; best = Number(el.dataset.page) }
      }
      return best
    })
  }

  async jumpTo(n: number | string) {
    await this.pageButton.click()
    await this.pageInput.fill(String(n))
    await this.pageInput.press('Enter')
  }

  // ── Zoom (the document pane's own controls, not the canvas's) ──
  get zoomIn() { return this.nav.getByRole('button', { name: 'Zoom in' }) }
  get zoomOut() { return this.nav.getByRole('button', { name: 'Zoom out' }) }
  get zoomReset() { return this.nav.getByRole('button', { name: /^\d+%$/ }) }

  async zoomPercent(): Promise<number> {
    return Number((await this.zoomReset.innerText()).replace('%', ''))
  }

  // ── View modes ──
  get singlePageView() { return this.page.getByRole('button', { name: 'Single page view' }) }
  get continuousView() { return this.page.getByRole('button', { name: 'Continuous scroll' }) }
  get focusMode() { return this.page.getByRole('button', { name: 'Focus reading mode' }) }
  get exitFocusMode() { return this.page.getByRole('button', { name: 'Exit focus reading mode' }) }

  // ── Tools ──
  tool(t: DocTool) { return this.page.locator(`button[data-tool="${t}"]`) }
  colour(c: HighlightColour) { return this.page.getByTitle(c, { exact: true }) }
  get undo() { return this.page.getByRole('button', { name: 'Undo' }) }
  get redo() { return this.page.getByRole('button', { name: 'Redo' }) }
  get highlights() { return this.page.locator('g[data-highlight-id]') }
  get areaLinks() { return this.page.locator('[data-area-link-id]') }

  async expectDocumentOpen(name: string, pageCount: number) {
    await expect(this.documentTitle(name)).toBeVisible({ timeout: 30_000 })
    await this.expectPage(1, pageCount)
    await this.pageRendered(1)
  }

  /**
   * Drag across a page in page-relative fractions (0..1). Used by every
   * area tool and the freehand highlighter; steps keep each move >3 px,
   * which PdfHighlightLayer needs to register a stroke.
   */
  async dragOnPage(n: number, from: [number, number], to: [number, number], steps = 12) {
    await this.pageRendered(n)
    await this.canvasOf(n).scrollIntoViewIfNeeded()
    const box = await this.canvasOf(n).boundingBox()
    if (!box) throw new Error(`page ${n} has no box`)
    const at = ([fx, fy]: [number, number]) => [box.x + box.width * fx, box.y + box.height * fy] as const
    const [x0, y0] = at(from)
    const [x1, y1] = at(to)
    await this.page.mouse.move(x0, y0)
    await this.page.mouse.down()
    await this.page.mouse.move(x1, y1, { steps })
    await this.page.mouse.up()
  }
}

export class FindBar {
  constructor(private readonly page: Page) {}

  get input() { return this.page.getByPlaceholder('Find in document...') }
  get counter() { return this.page.getByText(/^\d+ of \d+$/) }
  get noResults() { return this.page.getByText(/^(No results|No readable text|Text could not be read)$/) }
  get nextMatch() { return this.page.getByRole('button', { name: 'Next match' }) }
  get prevMatch() { return this.page.getByRole('button', { name: 'Previous match' }) }
  get clear() { return this.page.getByRole('button', { name: 'Clear search' }) }
  get close() { return this.page.getByRole('button', { name: 'Close find bar' }) }
  get currentMatch() { return this.page.locator('[data-find-current]') }
  /**
   * Every drawn match. Only the current one carries an attribute; the others are
   * known by their fill (PdfFindHighlightLayer.tsx), the one style-based locator here.
   */
  get marks() { return this.page.locator('[data-page] [data-find-current], [data-page] div[style*="rgba(255, 233, 36"]') }

  async search(term: string) {
    await expect(this.input).toBeVisible()
    await this.input.fill(term)
  }

  async expectCount(current: number, total: number) {
    await expect(this.counter).toHaveText(`${current} of ${total}`, { timeout: 20_000 })
  }
}
