/**
 * Law mode ("Cognitive Canvas Legal"): the Layout switch in Settings ›
 * Appearance, the header calendar (LawCalendar), the per-day editor
 * (LawEventModal), the due-date reminder (LawEventReminder) and the
 * classification badge on document cards (ClassificationBadge).
 *
 * The badge and its menu items are plain buttons inside the document card,
 * so they are scoped to the card (DocumentsPage.card).
 */
import { expect, type Locator, type Page } from '@playwright/test'

export const LAW_NAME = 'Cognitive Canvas Legal'
export const STANDARD_NAME = 'Cognitive Canvas'
export const LAW_NOTICE = 'Law mode is active — a global calendar and court-date reminders are enabled.'

export const CLASSIFICATIONS = [
  { label: 'Contract', value: 'contract' },
  { label: 'Case File', value: 'case-file' },
  { label: 'Notice', value: 'notice' },
  { label: 'Pleading', value: 'pleading' },
  { label: 'Discovery', value: 'discovery' },
  { label: 'Report', value: 'report' },
  { label: 'Other', value: 'other' },
  { label: 'Unclassified', value: 'unclassified' },
] as const

export const EVENT_COLOURS = { Red: '#ef4444', Amber: '#f59e0b', Green: '#22c55e', Blue: '#0ea5e9', Violet: '#8b5cf6', Slate: '#64748b' } as const

export class LayoutSwitch {
  constructor(private readonly page: Page) {}

  get law() { return this.page.getByRole('button').filter({ hasText: 'Court diary & date reminders' }) }
  get standard() { return this.page.getByRole('button').filter({ hasText: 'Reading & note-taking' }) }
  get notice() { return this.page.getByText(LAW_NOTICE) }
  get dialog() { return this.page.getByRole('dialog', { name: 'Switch layout?' }) }
  get confirm() { return this.dialog.getByRole('button', { name: 'Switch', exact: true }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
  /** The product name in the header's home button. */
  get headerName() { return this.page.getByRole('button', { name: 'Go to home' }) }

  /** Settings › Appearance from anywhere with the header. */
  async open() {
    await this.page.getByRole('button', { name: /^Settings( — new support reply)?$/ }).click()
    await this.page.getByRole('button', { name: 'Appearance', exact: true }).first().click()
    await expect(this.page.getByRole('heading', { name: 'Layout' })).toBeVisible()
  }

  /** Confirm the switch and wait for the reload it triggers. */
  async switchTo(target: 'law' | 'standard') {
    await (target === 'law' ? this.law : this.standard).click()
    await expect(this.dialog).toBeVisible()
    await Promise.all([this.page.waitForEvent('load'), this.confirm.click()])
  }

  variant() {
    return this.page.evaluate(() => localStorage.getItem('cc2_app_variant'))
  }
}

export class LawCalendarDialog {
  constructor(private readonly page: Page) {}

  get openButton() { return this.page.getByRole('button', { name: 'Open calendar' }) }
  get dialog() { return this.page.getByRole('dialog', { name: 'Calendar', exact: true }) }
  get month() { return this.dialog.getByRole('heading', { level: 3 }) }
  get previous() { return this.dialog.getByRole('button', { name: 'Previous month' }) }
  get next() { return this.dialog.getByRole('button', { name: 'Next month' }) }
  get today() { return this.dialog.getByRole('button', { name: 'Today', exact: true }) }
  get close() { return this.dialog.getByRole('button', { name: 'Close', exact: true }) }
  get hint() { return this.dialog.getByText('Tap any day to add a hearing, meeting, or deadline.') }
  /** A day cell of the visible month (its name starts with the day number). */
  day(n: number) { return this.dialog.getByRole('button', { name: new RegExp(`^${n}(\\s*\\+\\d+)?$`) }) }
  /** The coloured dots under a day number. */
  dots(n: number) { return this.day(n).locator('span.rounded-full') }

  async openIt() {
    await this.openButton.click()
    await expect(this.dialog).toBeVisible()
  }
}

/** The per-day editor; its title is the long date, e.g. "Sunday, March 15, 2026". */
export class LawDayDialog {
  readonly dialog: Locator
  constructor(private readonly page: Page, dayLabel: string) {
    this.dialog = page.getByRole('dialog', { name: dayLabel, exact: true })
  }

  get title() { return this.dialog.getByPlaceholder('e.g. Hearing — Sharma v. State') }
  get time() { return this.dialog.locator('input[type="time"]') }
  get note() { return this.dialog.getByPlaceholder('Note (optional)') }
  colour(name: keyof typeof EVENT_COLOURS) { return this.dialog.getByRole('button', { name, exact: true }) }
  get add() { return this.dialog.getByRole('button', { name: 'Add', exact: true }) }
  get update() { return this.dialog.getByRole('button', { name: 'Update', exact: true }) }
  get cancelEdit() { return this.dialog.getByRole('button', { name: 'Cancel edit', exact: true }) }
  get close() { return this.dialog.getByRole('button', { name: 'Close', exact: true }) }
  get formHeading() { return this.dialog.getByText(/^(Add entry|Edit entry)$/) }
  /** An existing entry row, found by its title. */
  entry(title: string) { return this.dialog.locator('div.rounded-lg.border').filter({ has: this.page.getByText(title, { exact: true }) }) }
  get entries() { return this.dialog.locator('div.rounded-lg.border') }

  async addEntry(e: { title: string; time?: string; note?: string; colour?: keyof typeof EVENT_COLOURS }) {
    await this.title.fill(e.title)
    if (e.time) await this.time.fill(e.time)
    if (e.colour) await this.colour(e.colour).click()
    if (e.note) await this.note.fill(e.note)
    await this.add.click()
    await expect(this.entry(e.title)).toBeVisible()
  }
}

export class LawReminder {
  constructor(private readonly page: Page) {}

  get popup() { return this.page.getByRole('alert').filter({ has: this.page.getByRole('button', { name: 'Not done' }) }) }
  get done() { return this.popup.getByRole('button', { name: 'Done', exact: true }) }
  get notDone() { return this.popup.getByRole('button', { name: 'Not done', exact: true }) }
  get dismiss() { return this.popup.getByRole('button', { name: 'Dismiss reminder' }) }
}

/** The classification chip on a document card, and its menu. */
export class ClassificationChip {
  constructor(private readonly card: Locator) {}

  get badge() { return this.card.getByRole('button', { name: new RegExp(`^(${CLASSIFICATIONS.map((c) => c.label).join('|')})$`) }).first() }
  /** The open menu (absolutely positioned under the chip). */
  get menu() { return this.card.locator('div.absolute.top-full') }
  option(label: string) { return this.menu.getByRole('button', { name: label, exact: true }) }
  get options() { return this.menu.getByRole('button') }
}
