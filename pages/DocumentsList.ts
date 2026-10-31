/**
 * The project's document list beyond pages/DocumentsPage.ts: Select mode,
 * bulk delete, drag-to-reorder and file drop (DocumentListView.tsx).
 */
import { expect, type Page } from '@playwright/test'
import { DocumentsPage } from './DocumentsPage.js'
import type { FilePayload } from '../data/files.js'

export class DocumentList extends DocumentsPage {
  constructor(private readonly p: Page) {
    super(p)
  }

  /** "Select" / "Done" (only shown with more than one document). */
  get selectMode() { return this.p.getByRole('button', { name: /^(Select|Done)$/ }) }
  get selectionCount() { return this.p.getByText(/^\d+ of \d+ selected$/) }
  get selectAll() { return this.p.getByRole('button', { name: 'Select all', exact: true }) }
  get deselectAll() { return this.p.getByRole('button', { name: 'Deselect all', exact: true }) }
  /** The selection bar's red button: "Delete" (nothing chosen) or "Delete N". */
  get bulkDelete() { return this.p.getByRole('button', { name: /^Delete( \d+)?$/ }) }
  /** Document names in list order (each card's title paragraph). */
  get names() { return this.cards.locator('p.truncate') }

  /**
   * Drag one card onto another's position with the mouse: press, move past
   * the 8 px threshold, then down/up to the target's centre, release.
   */
  async dragCard(name: string, ontoName: string) {
    const from = await this.card(name).boundingBox()
    const to = await this.card(ontoName).boundingBox()
    if (!from || !to) throw new Error('document card has no box')
    const x = from.x + from.width / 3
    const y0 = from.y + from.height / 2
    const targetY = to.y + (to.y < from.y ? to.height * 0.25 : to.height * 0.75)
    await this.p.mouse.move(x, y0)
    await this.p.mouse.down()
    await this.p.mouse.move(x, y0 + (targetY > y0 ? 12 : -12), { steps: 3 })
    await this.p.mouse.move(x, targetY, { steps: 12 })
    await this.p.mouse.up()
  }

  /**
   * Drop files on the window as the operating system would. Playwright cannot
   * produce an OS file drag, so a DataTransfer holding the files is built in
   * the page and a real `drop` event carrying it is dispatched (the app listens
   * on window; services/layout/fileDropGuard.ts).
   */
  async dropFiles(files: FilePayload[]) {
    await this.p.evaluate((list) => {
      const dt = new DataTransfer()
      const dropped = list.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.mimeType }))
      for (const f of dropped) dt.items.add(f)
      // The app reads the files asynchronously after the event. Keep the transfer and its files
      // reachable until then: a synthetic transfer let go of early made the reads fail with
      // NotReadableError (seen once under load), which an OS drop never does.
      ;(window as unknown as { __ccDrop?: unknown }).__ccDrop = { dt, dropped }
      document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, files.map((f) => ({ name: f.name, mimeType: f.mimeType, b64: f.buffer.toString('base64') })))
  }

  async expectNames(names: string[]) {
    await expect(this.names).toHaveText(names)
  }
}
