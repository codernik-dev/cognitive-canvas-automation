/**
 * The phone shell (useIsPhone: a window narrower than 640 px, or a device
 * whose narrow screen edge is under 640 px):
 *
 *   header   GlobalSettingsBar's phone row: logo, storage size
 *            (MobileStorageButton), the screen's tutorial video, Menu
 *   nav      MobileBottomNav: Library / Catalog / Assistant (+ Calendar in
 *            the Legal layout), on the home-style screens only
 *   menu     MobileMenuSheet, the bottom sheet the header's Menu opens
 *   home     the phone project list (ProjectSelectionScreen renderPhone +
 *            MobileProjectRow)
 *   settings the phone Settings section dropdown (SettingsPage.tsx)
 *
 * The sheet, its grip and its backdrop carry no role or label; the few
 * structural locators that need them are kept here, each with its reason.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export class MobileHeader {
  constructor(private readonly page: Page) {}
  get menu() { return this.page.getByRole('button', { name: 'Menu', exact: true }) }
  /** MobileStorageButton: aria-label "Storage", text = the used size ("12 KB"). */
  get storage() { return this.page.getByRole('button', { name: 'Storage', exact: true }) }
  get tutorial() { return this.page.getByRole('button', { name: /^Watch tutorial: / }) }
  get home() { return this.page.getByRole('button', { name: 'Go to home' }) }
}

export class MobileBottomNav {
  constructor(private readonly page: Page) {}
  /** The only <nav> on the home-style phone screens. */
  get bar() { return this.page.locator('nav').filter({ has: this.page.getByRole('button', { name: 'Library', exact: true }) }) }
  tab(name: 'Library' | 'Catalog' | 'Assistant' | 'Calendar') { return this.bar.getByRole('button', { name, exact: true }) }
  get tabs() { return this.bar.getByRole('button') }
}

export type MenuRow =
  | 'Sign in' | 'Product catalog' | 'Sharing' | 'Backup & Restore' | 'Calendar' | 'Settings' | 'Appearance'
  | 'Language' | 'Tool guide' | 'Guided tour' | 'Fullscreen' | 'Install app' | 'Help & support'
  | 'Change PIN' | 'Lock' | 'Sign out'

export class MobileMenuSheet {
  /**
   * The sheet's root: the only element with an aria-hidden attribute that
   * holds the "Help & session" section title. It reads aria-hidden="false"
   * while open and "true" while closed (MobileMenuSheet.tsx).
   */
  readonly root: Locator
  constructor(page: Page, private readonly header: MobileHeader) {
    this.root = page.locator('div[aria-hidden]').filter({ has: page.getByText('Help & session', { exact: true }) })
  }

  row(name: MenuRow) { return this.root.getByRole('button', { name, exact: true }) }
  /** Rows in order, as the user reads them (only meaningful while open). */
  get rows() { return this.root.getByRole('button') }
  section(title: 'Library' | 'Your data' | 'App' | 'Help & session') { return this.root.getByText(title, { exact: true }) }
  /** The dimmed backdrop above the sheet: the root's first child (no role or label). */
  get backdrop() { return this.root.locator('> div').first() }
  /** The grabber strip at the top of the sheet, the only swipe-to-dismiss handle (touch-none, no label). */
  get grip() { return this.root.locator('div.touch-none.cursor-grab') }

  async open() {
    await this.header.menu.click()
    await this.expectOpen()
  }

  async expectOpen() { await expect(this.root).toHaveAttribute('aria-hidden', 'false') }
  async expectClosed() { await expect(this.root).toHaveAttribute('aria-hidden', 'true') }

  async choose(name: MenuRow) {
    await this.open()
    await this.row(name).click()
  }
}

/** The phone project list (renderPhone in ProjectSelectionScreen.tsx). */
export class MobileHome {
  constructor(private readonly page: Page) {}
  get search() { return this.page.getByPlaceholder('Search projects...') }
  get clearSearch() { return this.page.getByRole('button', { name: 'Clear search' }) }
  get newName() { return this.page.getByPlaceholder('New project name...') }
  get create() { return this.page.getByRole('button', { name: 'Create', exact: true }) }
  get nameError() { return this.page.locator('[data-tour="project-create"]').getByRole('alert') }
  get upload() { return this.page.locator('[data-tour="upload-card"]') }
  get catalog() { return this.page.locator('[data-tour="project-create"]').getByRole('button', { name: 'Catalog', exact: true }) }
  get emptyHeading() { return this.page.getByRole('heading', { name: 'No projects yet' }) }
  get emptyText() { return this.page.getByText('Create a project above, upload a PDF, or browse the catalog.') }
  /** "Projects (N)" or, while searching, "N found". */
  get heading() { return this.page.getByRole('heading', { level: 2, name: /^Projects \(\d+\)$|^\d+ found$/ }) }
  noMatch(query: string) { return this.page.getByText(`No projects match "${query}".`) }
  /** The orange status line under the create row ("Uploaded 2 files", "Skipped: ..."). */
  status(text: string | RegExp) { return this.page.getByText(text) }

  get rows(): Locator { return this.page.locator('[data-tour="project-card"]:not([aria-hidden="true"])') }
  row(name: string): Locator { return this.rows.filter({ has: this.page.getByRole('heading', { name, exact: true }) }) }
  /** The "N docs · time" line of a row. */
  meta(name: string) { return this.row(name).locator('p').first() }
  actions(name: string) { return this.row(name).getByRole('button', { name: 'Project actions' }) }
  shareButton(name: string) { return this.page.getByRole('button', { name: `Share ${name}`, exact: true }) }
  /** An item of the open row menu (Rename / Share / Download / Delete). */
  menuItem(name: 'Rename' | 'Share' | 'Download' | 'Delete') { return this.page.locator('[data-tour="project-card"]').getByRole('button', { name, exact: true }) }
  /** The inline rename field (the only text box inside a row). */
  get renameInput() { return this.rows.getByRole('textbox') }

  // Select mode
  get select() { return this.page.getByRole('button', { name: 'Select', exact: true }) }
  get selectedCount() { return this.page.getByText(/^\d+ selected( \(\d+ hidden\))?$/) }
  get all() { return this.page.getByRole('button', { name: 'All', exact: true }) }
  get none() { return this.page.getByRole('button', { name: 'None', exact: true }) }
  get bulkShare() { return this.page.getByRole('button', { name: 'Share', exact: true }) }
  get bulkDelete() { return this.page.getByRole('button', { name: 'Delete', exact: true }) }
  get cancelSelect() { return this.page.getByRole('button', { name: 'Cancel', exact: true }) }

  async createProject(name: string) {
    await this.newName.fill(name)
    await this.create.click()
  }

  async rowAction(name: string, action: 'Rename' | 'Share' | 'Download' | 'Delete') {
    await this.actions(name).click()
    await this.menuItem(action).click()
  }
}

/** Settings on a phone: a section dropdown instead of the left rail. */
export class MobileSettings {
  constructor(private readonly page: Page) {}
  get heading() { return this.page.getByRole('heading', { name: 'Settings', level: 1 }) }
  /** The dropdown trigger names the current section and carries aria-expanded. */
  get sectionPicker() { return this.page.locator('button[aria-expanded]').filter({ has: this.page.locator('span.flex-1') }).first() }
  /** The open list, floating under the trigger (absolute, top-full; no role of its own). */
  get list() { return this.page.locator('div.absolute.top-full').filter({ has: this.page.getByRole('button') }) }
  option(label: string) { return this.list.getByRole('button', { name: label, exact: true }) }
  /** The full-screen invisible layer that closes the open list on an outside tap (no role or label). */
  get listBackdrop() { return this.page.locator('div.fixed.inset-0.z-40') }
}

export class MobileShell {
  readonly header: MobileHeader
  readonly nav: MobileBottomNav
  readonly menu: MobileMenuSheet
  readonly home: MobileHome
  readonly settings: MobileSettings
  constructor(readonly page: Page) {
    this.header = new MobileHeader(page)
    this.nav = new MobileBottomNav(page)
    this.menu = new MobileMenuSheet(page, this.header)
    this.home = new MobileHome(page)
    this.settings = new MobileSettings(page)
  }
}
