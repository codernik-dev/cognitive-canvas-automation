/**
 * Chrome shared by every signed-in screen: the global header, the profile
 * menu, modal dialogs and toasts.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export class GlobalHeader {
  readonly bar: Locator
  constructor(private readonly page: Page) {
    this.bar = page.locator('[data-tour="global-bar"]')
  }

  get home() { return this.page.getByRole('button', { name: 'Go to home' }) }
  get exploreContent() { return this.page.getByRole('button', { name: 'Explore Content' }) }
  get backupRestore() { return this.page.getByRole('button', { name: 'Backup & Restore' }) }
  get settings() { return this.page.getByRole('button', { name: /^Settings( — new support reply)?$/ }) }
  get guidedTour() { return this.page.getByRole('button', { name: 'Start guided tour' }) }
  get storage() { return this.page.getByRole('button', { name: 'Open storage details' }) }
  /** "Sign in" when signed out of MuulOrigin, the user's name when signed in. Always opens the profile menu. */
  get profile() { return this.page.getByRole('button', { name: 'Sign in' }) }
  get quickSearch() { return this.page.locator('[data-tour="header-quicksearch"]') }
}

export class ProfileMenu {
  constructor(private readonly page: Page, private readonly header: GlobalHeader) {}

  get menu() { return this.page.getByRole('menu') }
  item(name: 'Sign in' | 'Sharing' | 'Data Center' | 'Change PIN' | 'Lock' | 'Sign out') {
    return this.menu.getByRole('menuitem', { name, exact: true })
  }

  async choose(name: Parameters<ProfileMenu['item']>[0]) {
    await this.header.profile.click()
    await expect(this.menu).toBeVisible()
    await this.item(name).click()
  }
}

/** A modal: role=dialog, aria-modal, named by its title. */
export class Dialogs {
  constructor(private readonly page: Page) {}

  byTitle(title: string | RegExp) {
    return this.page.getByRole('dialog', { name: title })
  }

  /** Any open modal dialog. */
  get any() {
    return this.page.locator('[role="dialog"][aria-modal="true"]')
  }

  button(dialog: Locator, name: string | RegExp) {
    return dialog.getByRole('button', { name, exact: typeof name === 'string' })
  }
}

/**
 * Toasts carry no ARIA role or test id (Toast.tsx), so the container class
 * is the only stable scope. Kept here, in one place; see the testability
 * notes in 01-APPLICATION-ANALYSIS.md.
 */
export class Toasts {
  readonly container: Locator
  constructor(page: Page) {
    this.container = page.locator('div.fixed.right-4.z-\\[300\\]')
  }

  withText(text: string | RegExp) {
    return this.container.getByText(text)
  }

  /**
   * A toast lives 3.5 s and appears when its work finishes, so `timeout`
   * should cover the work (e.g. processing several uploads), not the toast.
   */
  async expectShown(text: string | RegExp, timeout?: number) {
    await expect(this.withText(text).first()).toBeVisible({ timeout })
  }
}
