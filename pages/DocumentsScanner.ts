/**
 * The camera scanner (documents/CameraScannerModal.tsx) and its note pad
 * (documents/ScannerNotePad.tsx), desktop layout.
 *
 * The scanner is a Modal titled "Scan Document" (capture) or "Review pages"
 * (preview). The note pad and the layout picker render OUTSIDE that dialog,
 * as full-screen layers, so they are located from the page.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { FilePayload } from '../data/files.js'

export class ScannerModal {
  constructor(private readonly page: Page) {}

  get dialog() { return this.page.getByRole('dialog', { name: /^(Scan Document|Review pages)$/ }) }
  get capture() { return this.dialog.getByRole('button', { name: 'Capture page', exact: true }) }
  get gallery() { return this.dialog.getByRole('button', { name: 'Pick from gallery', exact: true }) }
  get galleryInput() { return this.dialog.locator('input[type="file"][accept="image/*"]') }
  get addNotePage() { return this.dialog.getByRole('button', { name: 'Add a note page', exact: true }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
  get closeX() { return this.dialog.getByRole('button', { name: 'Close', exact: true }) }
  get next() { return this.dialog.getByRole('button', { name: 'Next →', exact: true }) }
  get backToCamera() { return this.dialog.getByRole('button', { name: '← Back to camera', exact: true }) }
  get stripCaption() { return this.dialog.getByText(/^(\d+ pages? — tap Next to review \+ write|Captured pages appear here)$/) }
  removeStripPage(n: number) { return this.dialog.getByRole('button', { name: `Remove page ${n}`, exact: true }) }
  get thumbnails() { return this.dialog.getByRole('img', { name: /^Page \d+$/ }) }
  get error() { return this.dialog.locator('div.text-accent-red') }
  // Preview phase
  get deletePage() { return this.dialog.getByRole('button', { name: 'Delete page', exact: true }) }
  get insertAfter() { return this.dialog.getByRole('button', { name: 'Insert note page after', exact: true }) }
  get addPageTile() { return this.dialog.getByRole('button', { name: 'Add page', exact: true }) }
  get write() { return this.dialog.getByRole('button', { name: 'Write', exact: true }) }
  get name() { return this.dialog.getByPlaceholder('Document name…') }
  get save() { return this.dialog.getByRole('button', { name: /^(Save \(\d+\)|Saving…)$/ }) }
  /** Thumbnail badge text per page: "1", "2 · note", ... */
  get badges() { return this.dialog.locator('span.absolute.bottom-1') }

  async open(scanButton: Locator) {
    await scanButton.click()
    await expect(this.dialog).toBeVisible()
    await expect(this.dialog).toHaveAccessibleName('Scan Document')
  }

  /** Wait until the fake camera is live (the shutter is disabled until then). */
  async cameraLive() {
    await expect(this.capture).toBeEnabled({ timeout: 15_000 })
  }

  async pickImages(files: FilePayload[]) {
    await this.galleryInput.setInputFiles(files)
  }

  // Layout picker (bottom sheet / popover), outside the dialog
  get layoutPicker() { return this.page.locator('div.fixed.inset-0').filter({ hasText: 'Adds a blank page — write on it later in the preview.' }) }
  layout(name: 'Blank' | 'Lined' | 'Grid') { return this.layoutPicker.getByRole('button', { name, exact: true }) }
}

export class ScannerNotePad {
  readonly root: Locator
  constructor(page: Page) {
    // Full-screen layer with no role; it is the only element holding the "Undo ink" control or a read-only photo caption.
    this.root = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('button', { name: 'Done', exact: true }) }).last()
  }
  get cancel() { return this.root.getByRole('button', { name: 'Cancel', exact: true }) }
  get done() { return this.root.getByRole('button', { name: 'Done', exact: true }) }
  get prev() { return this.root.getByRole('button', { name: 'Previous page', exact: true }) }
  get next() { return this.root.getByRole('button', { name: 'Next page', exact: true }) }
  get addPage() { return this.root.getByRole('button', { name: 'Add a page', exact: true }) }
  get deletePage() { return this.root.getByRole('button', { name: 'Delete this page', exact: true }) }
  get label() { return this.root.getByText(/^Page \d+ \/ \d+$/) }
  get text() { return this.root.locator('textarea') }
  get canvas() { return this.root.locator('canvas') }
  tool(name: 'Pen' | 'Eraser' | 'Text') { return this.root.getByRole('button', { name, exact: true }) }
  colour(hex: string) { return this.root.getByRole('button', { name: `Colour ${hex}`, exact: true }) }
  get undoInk() { return this.root.getByRole('button', { name: 'Undo ink', exact: true }) }
  get clear() { return this.root.getByRole('button', { name: 'Clear', exact: true }) }
  get pageFull() { return this.root.getByText('Page full — tap ＋ to add a page', { exact: true }) }
  get photoCaption() { return this.root.getByText('Scanned page — reference only. Flip to a note page to write.', { exact: true }) }

  /** Non-white pixels on the pad's canvas, a measure of ink. */
  async inkPixels(): Promise<number> {
    return this.canvas.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 16) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) n++
      return n
    })
  }

  /** Pixels of a given ink colour on the pad's canvas (within 40 per channel). */
  async pixelsOf(rgb: [number, number, number]): Promise<number> {
    return this.canvas.evaluate((c: HTMLCanvasElement, [r, g, b]) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 40 && Math.abs(d[i + 1] - g) < 40 && Math.abs(d[i + 2] - b) < 40) n++
      return n
    }, rgb)
  }

  size(kind: 'pen' | 'eraser' | 'text', label: 'S' | 'M' | 'L') { return this.root.getByRole('button', { name: `${kind} size ${label}`, exact: true }) }

  /** Draw a stroke across the pad in canvas fractions. */
  async stroke(from: [number, number], to: [number, number]) {
    const box = await this.canvas.boundingBox()
    if (!box) throw new Error('note pad canvas has no box')
    await this.canvas.page().mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
    await this.canvas.page().mouse.down()
    await this.canvas.page().mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 15 })
    await this.canvas.page().mouse.up()
  }
}
