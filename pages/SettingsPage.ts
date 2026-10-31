/**
 * Settings screen (SettingsPage.tsx). Opens on the last tab used this
 * session, Permissions by default. Theme state lands on <html>:
 * `dark` class for the resolved mode, `style-theme-*` / `color-theme-*` for skins.
 */
import { expect, type Page } from '@playwright/test'

export type SettingsTab = 'Appearance' | 'Language' | 'Plan' | 'Permissions' | 'Shortcuts' | 'Tool Guide' | 'Support' | 'Tutorials'

export class SettingsPage {
  constructor(private readonly page: Page) {}

  get heading() { return this.page.getByRole('heading', { name: 'Settings', exact: true }) }
  get back() { return this.page.getByRole('button', { name: 'Back', exact: true }) }
  get diagnostics() { return this.page.getByRole('button', { name: 'Diagnostics' }) }
  // An unread count joins a tab's accessible name ("Support1"), so the name may end in digits.
  tab(name: SettingsTab) { return this.page.getByRole('button', { name: new RegExp(`^${name}(\\s*\\d+)?$`) }).first() }
  mode(name: 'Light' | 'Dark' | 'System') { return this.page.getByRole('button', { name, exact: true }) }

  async expectOpen() {
    await expect(this.heading).toBeVisible()
  }

  async openTab(name: SettingsTab) {
    await this.tab(name).click()
  }

  /** True when <html> carries the `dark` class. */
  isDark() {
    return this.page.evaluate(() => document.documentElement.classList.contains('dark'))
  }
}
