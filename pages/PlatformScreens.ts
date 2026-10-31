/**
 * Locators the platform specs (persistence, migration, offline/PWA,
 * accessibility, performance) need that no other page object holds.
 *
 *   BootScreen     the loading screen and its "Could not open your data" error (App.tsx)
 *   UpdateBanner   "A new version is available." (shared/PwaPrompts.tsx UpdateNotification)
 *   CanvasInk      the pen-stroke layer (workspace/items/CanvasStrokeLayer.tsx)
 *   FindStatus     the find bar's waiting spinner (documents/tools/FindBar.tsx)
 */
import type { Locator, Page } from '@playwright/test'

export class BootScreen {
  constructor(private readonly page: Page) {}
  get loading() { return this.page.getByText('Loading...', { exact: true }) }
  get failed() { return this.page.getByText('Could not open your data', { exact: true }) }
  get newerData() { return this.page.getByText(/^Your data on this device was saved by a newer version of Cognitive Canvas than the one that just loaded \(this build expects data version 13\)\./) }
  get tryAgain() { return this.page.getByRole('button', { name: 'Try again', exact: true }) }
  get reload() { return this.page.getByRole('button', { name: 'Reload', exact: true }) }
}

export class UpdateBanner {
  constructor(private readonly page: Page) {}
  get message() { return this.page.getByText('A new version is available.', { exact: true }) }
  /** The banner has no role; its paragraph's parent holds the two buttons. */
  get root() { return this.message.locator('xpath=..') }
  get update() { return this.root.getByRole('button', { name: 'Update', exact: true }) }
  get dismiss() { return this.root.getByRole('button', { name: 'Dismiss', exact: true }) }
}

export class CanvasInk {
  constructor(private readonly page: Page) {}
  /**
   * Pen strokes render as one unlabelled 1x1 overflow-visible <svg> of
   * <g><path/></g> groups inside the canvas world. Line items have their own
   * svg[data-line-id], so the layer is the 1x1 svg without that hook.
   */
  get paths(): Locator {
    return this.page.locator('[data-workspace-canvas] svg[width="1"][height="1"]:not([data-line-id]) > g > path')
  }
}

export class FindStatus {
  constructor(private readonly page: Page) {}
  /** The find bar's spinner (no words, no role): shown while Find waits for pages still being read. */
  get spinner() { return this.page.getByPlaceholder('Find in document...').locator('xpath=..').locator('.animate-spin') }
}
