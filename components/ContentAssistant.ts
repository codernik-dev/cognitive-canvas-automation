/**
 * Canvas Assistant (src/components/ChatWidget.tsx): the edge tab, and the
 * panel it opens. The panel is the only element with data-ws-tool="chat".
 * Chat bubbles carry no role or hook; each one is the `whitespace-pre-wrap`
 * div holding a message's text, so that one structural locator lives here.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export const ASSISTANT_GREETING = 'Hi! How can I help?'
export const ASSISTANT_ABSTAIN = 'I can open the catalog, jump to a class (9-12), search the catalog, download items, create a project, open a project, or go back to the home screen. What would you like to do?'

export class AssistantPanel {
  constructor(private readonly page: Page) {}

  /** The narrow tab on the window edge (hidden below 768 px). */
  get tab() { return this.page.getByRole('button', { name: 'Open Canvas assistant' }) }
  get panel() { return this.page.locator('[data-ws-tool="chat"]') }
  get title() { return this.panel.getByText('Canvas Assistant', { exact: true }) }
  get menuButton() { return this.panel.getByRole('button', { name: 'Assistant menu' }) }
  menuItem(name: 'Clear chat' | 'Start new session') { return this.panel.getByRole('menuitem', { name }) }
  get close() { return this.panel.getByRole('button', { name: 'Close assistant' }) }
  get input() { return this.panel.getByPlaceholder('Try "open catalog" or "class 11"…') }
  get send() { return this.panel.getByRole('button', { name: 'Send', exact: true }) }
  quickAction(name: 'Create Project' | 'Close Project' | 'Open Product Catalog') { return this.panel.getByRole('button', { name, exact: true }) }
  /** A choice button the bot offered under its latest message. */
  choice(label: string) { return this.panel.getByRole('button', { name: label, exact: true }) }

  /** Every bubble, oldest first (user and bot). */
  get bubbles(): Locator { return this.panel.locator('div.whitespace-pre-wrap') }
  /** The latest bubble. */
  get last(): Locator { return this.bubbles.last() }

  async open() {
    await this.tab.click()
    await expect(this.panel).toBeVisible()
    await expect(this.input).toBeFocused()
  }

  /** Type a request, send it, and wait for the bot's answer to replace the "…" placeholder. */
  async ask(text: string) {
    const before = await this.bubbles.count()
    await this.input.fill(text)
    await this.send.click()
    // The user's bubble, then the bot's reply.
    await expect(this.bubbles).toHaveCount(before + 2, { timeout: 30_000 })
  }

  /** Send through a button (quick action or choice) and wait for the reply. */
  async press(button: Locator) {
    const before = await this.bubbles.count()
    await button.click()
    await expect(this.bubbles).toHaveCount(before + 2, { timeout: 30_000 })
  }
}
