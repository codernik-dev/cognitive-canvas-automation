/**
 * Product Catalog screen (src/components/catalog/*) and the deep-link
 * picker. Levels: categories -> subcategories (when a category has any, plus
 * "More in <category>" for its direct items) -> item cards.
 *
 * Hooks: category/subcategory/section cards are <button>s whose accessible
 * name is their whole text, so they are found by their <h3>. Item cards are
 * plain <div>s with no role or data attribute; the card is the nearest
 * "rounded-2xl" ancestor of the item's <h3> (CatalogItemGrid.tsx). That one
 * structural locator lives here only.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export class CatalogScreen {
  constructor(private readonly page: Page) {}

  get hero() { return this.page.getByRole('heading', { name: 'Explore Content', exact: true }) }
  get intro() { return this.page.getByText('Pre-built projects with documents, notes, and annotations. Download and start learning instantly.') }
  get loading() { return this.page.getByText('Loading content...', { exact: true }) }
  get errorTitle() { return this.page.getByText('Failed to load content', { exact: true }) }
  get tryAgain() { return this.page.getByRole('button', { name: 'Try Again', exact: true }) }
  get search() { return this.page.getByPlaceholder('Search the catalog...') }
  get clearSearch() { return this.page.getByRole('button', { name: 'Clear search' }) }
  /** The chevron at the top left. Exact, so it never matches "Back to projects". */
  get back() { return this.page.getByRole('button', { name: 'Back', exact: true }) }
  /** "Select" pill (title "Select multiple items to download"). */
  get selectMode() { return this.page.getByRole('button', { name: 'Select', exact: true }) }
  get multiBar() { return this.page.getByRole('region', { name: 'Multi-download controls' }) }
  /** The breadcrumb caption ("Product Catalog / Science / Biology"): the paragraph holding the root crumb. */
  get breadcrumb() { return this.page.locator('p').filter({ has: this.page.getByText('Product Catalog', { exact: true }) }).first() }
  crumb(name: string) { return this.breadcrumb.getByRole('button', { name, exact: true }) }
  get statsFooter() { return this.page.getByText(/^\d+ items? across \d+ categor(y|ies)$/) }
  /** The "N results for …" / "N sections for …" caption above flat results. */
  resultsCaption(text: RegExp) { return this.page.getByText(text) }

  /** A category, subcategory or search-section card, by its title. */
  card(title: string): Locator {
    return this.page.getByRole('button').filter({ has: this.page.getByRole('heading', { name: title, exact: true }) })
  }

  /** Titles of the category / subcategory / section cards on screen, in order. */
  get cardTitles(): Locator {
    return this.page.getByRole('button').locator('h3')
  }

  /** Every item card currently rendered (category/section cards are buttons, item cards are not). */
  get itemCards(): Locator {
    return this.page.locator('div.rounded-2xl:has(> div > h3)')
  }

  /** The item card(s) titled `title` (two items may share a title, e.g. "Chapter 2"). */
  item(title: string): Locator {
    return this.itemCards.filter({ has: this.page.getByRole('heading', { name: title, exact: true }) })
  }

  downloadButton(title: string) { return this.item(title).getByRole('button').first() }
  copyLink(title: string) { return this.item(title).getByRole('button', { name: 'Copy shareable link' }) }
  /** The green "Downloaded" badge over the cover (the button says it too). */
  downloadedBadge(title: string) { return this.item(title).locator('div.absolute').getByText('Downloaded', { exact: true }) }

  /** Titles of the item cards on screen, in order. */
  get itemTitles(): Locator { return this.itemCards.locator('h3') }

  /** The "Category · Subcategory" pill an item card shows in flat results. */
  itemCrumb(title: string) { return this.item(title).locator('span.uppercase') }

  tag(name: string) { return this.page.getByRole('button', { name, exact: true }) }

  /** Search-overlay lists ("Recent", "Suggestions"): the entries under a heading. */
  overlayEntries(heading: 'Recent' | 'Suggestions'): Locator {
    return this.page.getByRole('heading', { name: heading, exact: true }).locator('xpath=following-sibling::div[1]').getByRole('button')
  }

  /** Wait for the first fetch to settle: the listing or the error state. */
  async expectSettled() {
    await expect(this.hero.or(this.errorTitle)).toBeVisible({ timeout: 30_000 })
  }

  async openCategory(name: string) {
    await this.card(name).click()
    await expect(this.breadcrumb).toContainText(name)
  }

  async openFromHeader() {
    await this.page.getByRole('button', { name: 'Explore Content', exact: true }).click()
  }
}

/** DeepLinkPicker.tsx: "Which one did you mean?" when a link matches 2+ items. */
export class DeepLinkPickerDialog {
  constructor(private readonly page: Page) {}

  get dialog() { return this.page.getByRole('dialog', { name: 'Which one did you mean?' }) }
  get rows() { return this.dialog.locator('button[type="button"]').filter({ has: this.page.locator('p') }) }
  row(crumb: string) { return this.rows.filter({ hasText: crumb }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
}
