/**
 * OCR surfaces: the "OCR — Text Recognition" dialog (documents/OcrModal.tsx)
 * and the progress pill the queue runner portals to the top of the page
 * (documents/OcrQueueRunner.tsx).
 *
 * Neither has a dialog/status role or a test id. The dialog is found by its
 * heading (an <h2>), the pill by its fixed top-centre container, the one
 * structural locator here; both are kept in this file only.
 */
import { expect, type Locator, type Page } from '@playwright/test'

/** OCR on a scanned page is CPU-bound (render at 3x, then recognise); allow for a loaded machine. */
export const OCR_PAGE_TIMEOUT = 90_000

export class OcrDialog {
  readonly root: Locator
  constructor(page: Page) {
    this.root = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'OCR — Text Recognition', exact: true }) })
  }

  get heading() { return this.root.getByRole('heading', { name: 'OCR — Text Recognition', exact: true }) }
  get subtitle() { return this.root.getByText('Extract text from scanned or image-based pages', { exact: true }) }
  /** The header's ✕ (aria-label "Close"); the footer button reads "Cancel" or, after a job, "Close". */
  get closeX() { return this.root.getByRole('button', { name: 'Close', exact: true }).first() }
  get footerCancel() { return this.root.getByRole('button', { name: 'Cancel', exact: true }).last() }
  get footerClose() { return this.root.getByRole('button', { name: 'Close', exact: true }).last() }
  mode(name: RegExp | string) { return this.root.getByRole('button', { name, exact: typeof name === 'string' }) }
  get current() { return this.mode(/^Current \(p\.\d+\)$/) }
  get range() { return this.mode('Page range') }
  get all() { return this.mode(/^All \(\d+\)$/) }
  /** Range inputs carry visible "From"/"To" captions that are not bound to them, so position is the stable hook. */
  get from() { return this.root.getByRole('spinbutton').nth(0) }
  get to() { return this.root.getByRole('spinbutton').nth(1) }
  get language() { return this.root.getByRole('combobox') }
  get start() { return this.root.getByRole('button', { name: /^(Start OCR|Run Again|Scanning\.\.\.|OCR busy|Awaiting confirmation)$/ }) }
  get cancelBackgroundJob() { return this.root.getByRole('button', { name: 'Cancel Background Job', exact: true }) }
  get warningTitle() { return this.root.getByText(/^\d+ of \d+ pages? look image-only$/) }
  get warningBody() { return this.root.getByText('Image-only (scanned) pages render at higher resolution for accuracy, so OCR takes roughly 2× longer per page than usual. Continue?', { exact: true }) }
  get warningCancel() { return this.root.getByRole('button', { name: 'Cancel', exact: true }).first() }
  get warningContinue() { return this.root.getByRole('button', { name: 'Continue', exact: true }) }
  get progress() { return this.root.getByText(/^Page \d+ of \d+$/) }
  get completeTitle() { return this.root.getByRole('heading', { name: 'OCR Complete', exact: true }) }

  async expectOpen() {
    await expect(this.heading).toBeVisible()
  }
}

export class OcrToast {
  readonly root: Locator
  constructor(page: Page) {
    // Portalled to <body>, fixed top-centre, no role: its container classes are the only scope.
    this.root = page.locator('body > div.fixed.top-6')
  }

  get cancel() { return this.root.getByRole('button', { name: 'Cancel OCR', exact: true }) }
  get dismiss() { return this.root.getByRole('button', { name: 'Dismiss', exact: true }) }
  get counter() { return this.root.getByText(/^Page \d+ of \d+$/) }
  text(t: string | RegExp) { return this.root.getByText(t) }
  /** "OCR Complete · {n} pages processed" (the count sits in its own span). */
  async expectComplete(pages: number, timeout = OCR_PAGE_TIMEOUT) {
    await expect(this.root).toContainText('OCR Complete', { timeout })
    await expect(this.root).toContainText(`· ${pages} pages processed`)
  }
}
