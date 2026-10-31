/**
 * Document-pane controls beyond components/PdfViewer.ts: the pinned and
 * floating PDF toolbars (tools/PinnedToolbar.tsx, FloatingToolbar.tsx), the
 * drawing palette and eraser sizes, the Link Doc picker, the page index, the
 * document switcher, the md/txt toolbar and the "Create note" selection
 * action. Locators use aria-labels/titles (the toolbars carry both) and the
 * product's data-tool / data-tour hooks.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export type EraserSize = 'Small' | 'Medium' | 'Large' | 'Extra Large'
/** Radius in page pixels for each eraser size (tools/EraserSizePicker.tsx). */
export const ERASER_RADIUS: Record<EraserSize, number> = { Small: 8, Medium: 14, Large: 22, 'Extra Large': 34 }

/** Highlighter (translucent) and pen (opaque) hex per colour name (PdfHighlightLayer.tsx COLOR_HEX / PEN_COLOR_HEX). */
export const COLOUR_HEX = {
  Important: { id: 'yellow', highlighter: '#fde047', pen: '#eab308', text: 'rgba(250, 204, 21, 0.45)' },
  Critical: { id: 'red', highlighter: '#fca5a5', pen: '#dc2626', text: 'rgba(239, 68, 68, 0.40)' },
  Agree: { id: 'green', highlighter: '#86efac', pen: '#16a34a', text: 'rgba(34, 197, 94, 0.40)' },
  Reference: { id: 'blue', highlighter: '#93c5fd', pen: '#2563eb', text: 'rgba(59, 130, 246, 0.40)' },
  Question: { id: 'purple', highlighter: '#c4b5fd', pen: '#7c3aed', text: 'rgba(168, 85, 247, 0.40)' },
  Revisit: { id: 'orange', highlighter: '#fdba74', pen: '#ea580c', text: 'rgba(249, 115, 22, 0.40)' },
} as const
export type ColourName = keyof typeof COLOUR_HEX

export class DocToolbar {
  constructor(private readonly page: Page) {}

  get unpin() { return this.page.getByRole('button', { name: 'Unpin toolbar', exact: true }) }
  get pin() { return this.page.getByRole('button', { name: 'Pin toolbar to top', exact: true }) }
  get toolGuide() { return this.page.locator('[data-tour="info-doc"]') }
  get tour() { return this.page.locator('[data-tour="doc-tools-tour"]') }
  get linkDoc() { return this.page.locator('button[data-tool="link-doc"]') }
  get openPalette() { return this.page.getByRole('button', { name: 'Open palette', exact: true }) }
  get closePalette() { return this.page.getByRole('button', { name: 'Close palette', exact: true }) }
  get switchToEraser() { return this.page.getByRole('button', { name: 'Switch to eraser', exact: true }) }
  get switchToHighlighter() { return this.page.getByRole('button', { name: 'Switch to highlighter', exact: true }) }
  tip(name: 'Pen' | 'Highlighter') { return this.page.getByTitle(name, { exact: true }) }
  colour(name: ColourName) { return this.page.getByTitle(name, { exact: true }) }
  eraserSize(name: EraserSize) { return this.page.getByTitle(name, { exact: true }) }
  get undo() { return this.page.getByRole('button', { name: 'Undo', exact: true }) }
  get redo() { return this.page.getByRole('button', { name: 'Redo', exact: true }) }

  /**
   * The floating pill. It has no label: its outer box is the absolutely
   * positioned parent of the pin button, and the drag handle is the box that
   * shows the active tool (the one non-button area of the pill).
   */
  get floating() { return this.page.locator('div.absolute.z-20.pointer-events-auto').filter({ has: this.pin }) }
  get floatingHandle() { return this.floating.locator('div.p-1\\.5').first() }
  /** The pill's tool list: collapsed it is a zero-height, transparent grid row (its buttons stay in the DOM). */
  get floatingList() { return this.floating.locator('div[style*="grid-template-rows"]') }

  /**
   * Whether a doc tool is armed. The buttons expose no pressed state; the
   * armed one is the only one painted with the primary fill.
   */
  async isArmed(tool: string): Promise<boolean> {
    return this.page.locator(`button[data-tool="${tool}"]`).first().evaluate((b) => b.classList.contains('bg-primary-500'))
  }

  /**
   * Page n's drawing overlay, live: PdfHighlightLayer's root (it holds the
   * 0..1 viewBox <svg>) switches its pointer events on once the highlighter
   * or eraser is armed. A drag that lands before it mounts draws nothing.
   */
  drawLayer(n: number) {
    return this.page.locator(`[data-page="${n}"] div.absolute.inset-0[style*="pointer-events: auto"]:has(> svg[viewBox="0 0 1 1"])`)
  }

  async expandFloating() {
    await this.floatingHandle.click()
    await expect(this.floatingList).toHaveCSS('opacity', '1')
  }
}

export class LinkDocPicker {
  readonly root: Locator
  constructor(page: Page) {
    this.root = page.locator('div.w-56').filter({ has: page.getByText('Link to Document', { exact: true }) })
  }
  get heading() { return this.root.getByText('Link to Document', { exact: true }) }
  get hint() { return this.root.getByText('Pick a document, then draw a link area', { exact: true }) }
  get empty() { return this.root.getByText('No other documents', { exact: true }) }
  get rows() { return this.root.getByRole('button') }
  row(name: string) { return this.rows.filter({ hasText: name }) }
}

export class IndexPanel {
  readonly root: Locator
  constructor(page: Page) {
    // The panel's container has no role; it is the sidebar holding the "Index" caption.
    this.root = page.locator('div.w-44')
  }
  get caption() { return this.root.getByText('Index', { exact: true }) }
  get close() { return this.root.getByRole('button', { name: 'Close', exact: true }) }
  get pagesTab() { return this.root.getByRole('button', { name: 'Pages', exact: true }) }
  get contentsTab() { return this.root.getByRole('button', { name: 'Contents', exact: true }) }
  outlineItem(title: string) { return this.root.getByRole('button', { name: title, exact: true }) }
  thumb(n: number) { return this.root.locator(`button[data-thumb-page="${n}"]`) }
}

export class DocumentSwitcher {
  constructor(private readonly page: Page) {}
  button(activeName: string) { return this.page.locator('[data-tour="header-bar"]').getByRole('button', { name: activeName, exact: true }) }
  /** The dropdown is portalled to <body> as a fixed list of buttons, one per document. */
  get menu() { return this.page.locator('body > div.fixed.w-56') }
  option(name: string) { return this.menu.getByRole('button', { name, exact: true }) }
}

/** The md/txt viewer's toolbar (tools/TextDocToolbar.tsx) and the passages it marks. */
export class TextDocTools {
  constructor(private readonly page: Page) {}
  get highlight() { return this.page.getByRole('button', { name: 'Highlight', exact: true }) }
  get eraser() { return this.page.getByRole('button', { name: 'Highlight eraser', exact: true }) }
  get linkArea() { return this.page.getByRole('button', { name: 'Link area', exact: true }) }
  get undo() { return this.page.getByRole('button', { name: 'Undo', exact: true }) }
  get redo() { return this.page.getByRole('button', { name: 'Redo', exact: true }) }
  get marks() { return this.page.locator('mark.cc2-text-highlight') }
  get findMarks() { return this.page.locator('mark.cc2-find-mark') }
  get linkRects() { return this.page.locator('.cc2-text-link-rect') }
  get createNote() { return this.page.getByRole('button', { name: 'Create note', exact: true }) }
  /** The rendered document body: the Markdown prose container or the text <pre>. */
  get markdownBody() { return this.page.locator('.markdown-body') }
  get textBody() { return this.page.locator('pre.text-doc-body') }

  /**
   * Select `text` inside `container` with a real mouse drag, from the first
   * character to the last (Range rects give the screen positions).
   */
  async dragSelect(container: Locator, text: string) {
    // The passage may already be split across text nodes by earlier <mark>s, so
    // positions come from the container's flat text, mapped back to nodes.
    const box = await container.evaluate((root, needle) => {
      const at = (root.textContent ?? '').indexOf(needle)
      if (at < 0) return null
      const charRect = (flat: number) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let seen = 0
        let node: Node | null
        while ((node = walker.nextNode())) {
          const len = node.textContent!.length
          if (flat < seen + len) {
            const r = document.createRange()
            r.setStart(node, flat - seen)
            r.setEnd(node, flat - seen + 1)
            return r.getBoundingClientRect()
          }
          seen += len
        }
        throw new Error('offset past the end of the text')
      }
      const first = charRect(at)
      const last = charRect(at + needle.length - 1)
      return { x0: first.left + 1, y0: first.top + first.height / 2, x1: last.right - 1, y1: last.top + last.height / 2 }
    }, text)
    if (!box) throw new Error(`"${text}" not found in the document`)
    await this.page.mouse.move(box.x0, box.y0)
    await this.page.mouse.down()
    await this.page.mouse.move(box.x1, box.y1, { steps: 8 })
    await this.page.mouse.up()
  }

  /** Flat-text offset of `text` in the container (how text highlights and links are stored). */
  async offsetOf(container: Locator, text: string): Promise<number> {
    return container.evaluate((root, needle) => (root.textContent ?? '').indexOf(needle), text)
  }
}
