/**
 * Settings › Support (components/shared/support/*): the sign-in gate, the
 * "New ticket" form, "My tickets" and a ticket's conversation. SupportModal
 * exists in the source but nothing opens it; Settings is the only entry.
 *
 * Bubbles in the conversation carry no role; each is the rounded-lg div
 * inside a list item of the "Conversation" list, so that structural locator
 * lives here only.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export class SupportPanel {
  constructor(private readonly page: Page) {}

  /** Settings tab; its name gains the unread count ("Support 1"). */
  get settingsTab() { return this.page.getByRole('button', { name: /^Support(\s*\d+)?$/ }) }

  // ── sign-in gate ──
  get gateTitle() { return this.page.getByRole('heading', { name: 'Sign in to MuulOrigin' }) }
  get signInLink() { return this.page.getByRole('link', { name: 'Open sign-in page' }) }
  get signedInButton() { return this.page.getByRole('button', { name: "I've signed in" }) }

  // ── tabs ──
  get newTicketTab() { return this.page.getByRole('button', { name: 'New ticket', exact: true }) }
  /** "My tickets", with the unread badge when there is one. */
  get myTicketsTab() { return this.page.getByRole('button', { name: /^My tickets(\s*\d+)?$/ }) }

  // ── new ticket ──
  get subject() { return this.page.getByLabel('Subject') }
  get description() { return this.page.getByLabel('Description') }
  get category() { return this.page.getByLabel('Category') }
  get addFiles() { return this.page.getByRole('button', { name: 'Add files' }) }
  get submit() { return this.page.getByRole('button', { name: /^(Submit ticket|Submitting…)$/ }) }
  removeFile(name: string) { return this.page.getByRole('button', { name: `Remove ${name}` }) }
  /** A staged attachment row (name + size). */
  stagedFile(name: string) { return this.page.locator('li').filter({ hasText: name }) }
  get progress() { return this.page.getByText(/^Uploading\s/) }
  /** The attachments block of the new-ticket form: the whole block is the drop target. */
  get dropZone() { return this.page.getByText(/^(or drop them here|Drop to attach|Limit of 5 files reached)$/).locator('xpath=..') }

  // ── list ──
  ticketRow(subject: string) { return this.page.getByRole('button').filter({ has: this.page.getByText(subject, { exact: true }) }) }
  get statusFilter() { return this.page.getByRole('combobox', { name: 'Filter by status' }) }
  get sortOrder() { return this.page.getByRole('combobox', { name: 'Sort order' }) }
  /** Subjects of the listed tickets, top to bottom. */
  get listedSubjects(): Locator { return this.page.locator('ul > li > button p.text-sm') }
  get tryAgain() { return this.page.getByRole('button', { name: 'Try again', exact: true }) }

  // ── detail ──
  get backToTickets() { return this.page.getByRole('button', { name: 'Back to tickets' }) }
  get reply() { return this.page.getByPlaceholder(/^Write a reply…/) }
  get send() { return this.page.getByRole('button', { name: /^(Send|Sending…)$/ }) }
  get attach() { return this.page.getByRole('button', { name: 'Attach files' }) }
  /** The conversation list (bubbles, oldest first). */
  get bubbles(): Locator {
    return this.page.getByText('Conversation', { exact: true }).locator('xpath=following-sibling::ul[1]').locator('li > div')
  }

  async open() {
    await this.page.getByRole('button', { name: /^Settings( — new support reply)?$/ }).click()
    await this.settingsTab.click()
  }

  /** Pick files through the visible button and its file chooser. */
  async chooseFiles(button: Locator, files: { name: string; mimeType: string; buffer: Buffer }[]) {
    const chooser = this.page.waitForEvent('filechooser')
    await button.click()
    await (await chooser).setFiles(files)
  }

  async fillTicket(subject: string, description: string) {
    await this.subject.fill(subject)
    await this.description.fill(description)
  }

  async expectList() {
    await expect(this.statusFilter.or(this.page.getByText('No tickets yet'))).toBeVisible()
  }
}
