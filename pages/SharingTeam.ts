/**
 * Settings › Team Members (components/TeamMembersPage.tsx) and its dialogs:
 * Add member (sharing/AddMemberModal.tsx), Create student account
 * (sharing/CreateSubUserModal.tsx), and the share flow it starts
 * (sharing/shareFlow/ShareFlowModal.tsx).
 * Roster rows have no role: a row is the bordered card holding the email.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export class TeamMembersScreen {
  constructor(readonly page: Page) {}

  get heading() { return this.page.getByRole('heading', { name: 'Team Members', level: 1 }) }
  get tabButton() { return this.page.getByRole('button', { name: 'Team Members', exact: true }) }
  get addMember() { return this.page.getByRole('button', { name: /Add member$/ }) }
  get select() { return this.page.getByRole('button', { name: 'Select', exact: true }) }
  get shareNote() { return this.page.getByRole('button', { name: /Share a note$/ }) }
  get search() { return this.page.getByPlaceholder('Search by name or email…') }
  get sort() { return this.page.getByRole('combobox', { name: 'Sort members' }) }
  /** The error panel (a tinted block with no role). */
  error(text: string) { return this.page.getByText(text, { exact: true }) }
  /** A roster row: the bordered card holding this email. */
  row(email: string): Locator {
    return this.page.locator('div.p-3.rounded-lg.border').filter({ has: this.page.getByText(email, { exact: true }) })
  }
  get rows() { return this.page.locator('div.p-3.rounded-lg.border') }

  async open() {
    await this.page.getByRole('button', { name: /^Settings( — new support reply)?$/ }).click()
    await this.tabButton.click()
    await expect(this.heading).toBeVisible()
  }
}

export class AddMemberDialog {
  readonly dialog: Locator
  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Add member' })
  }
  get search() { return this.dialog.getByPlaceholder('Search by email…') }
  /** A result row: the hover row holding this email. */
  row(email: string) { return this.dialog.locator('div.rounded-lg.p-2').filter({ has: this.page.getByText(email, { exact: true }) }) }
  get createStudent() { return this.dialog.getByRole('button', { name: /Create new student$/ }) }
}

export class CreateStudentDialog {
  readonly dialog: Locator
  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Create student account' })
  }
  get email() { return this.dialog.getByPlaceholder('student@example.com') }
  /** Password and Confirm share a placeholder: first is the password, second the confirmation. */
  get password() { return this.dialog.getByPlaceholder('••••••••').first() }
  get confirm() { return this.dialog.getByPlaceholder('••••••••').nth(1) }
  get firstName() { return this.dialog.getByPlaceholder('John') }
  get lastName() { return this.dialog.getByPlaceholder('Doe') }
  get create() { return this.dialog.getByRole('button', { name: /^(Create student|Creating…)$/ }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
  get showPassword() { return this.dialog.getByRole('button', { name: /^(Show|Hide) password$/ }) }
  /** One password rule line; its tick is a green circle once met. */
  rule(label: string) { return this.dialog.locator('div.flex.items-center.gap-1\\.5').filter({ hasText: label }) }
}
