/**
 * The Sharing screen (components/sharing/SharingPage.tsx and board/*), the
 * Share composer (board/ShareComposer.tsx), the class dialogs (NewListModal,
 * AddPeopleModal), the notification bell and the header Live controls.
 *
 * Structural locators, where the app gives no role or name, are commented:
 * received cards and class cards carry no role, so they are found by the
 * card's own title text inside its rounded panel.
 */
import { expect, type Locator, type Page } from '@playwright/test'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export class SharingScreen {
  constructor(readonly page: Page) {}

  get heading() { return this.page.getByRole('heading', { name: 'Sharing', level: 1 }) }
  get back() { return this.page.getByRole('button', { name: 'Back', exact: true }) }
  get nav() { return this.page.getByRole('navigation', { name: 'Sharing sections' }) }
  /** A tab, by its label; its accessible name also carries the count ("Shares 0"). */
  tab(label: 'Shares' | 'Received' | 'Classes & people' | 'People') {
    return this.nav.getByRole('button', { name: new RegExp(`^${esc(label)}( |$)`) })
  }
  get share() { return this.page.getByRole('button', { name: 'Share', exact: true }) }
  get search() { return this.page.getByRole('searchbox', { name: 'Search' }) }
  get signInPrompt() { return this.page.getByText('Sign in to share your documents and receive what others share with you.') }
  /** The prompt's own button (the header's silhouette shares the name but has no text). */
  get signIn() { return this.page.getByRole('button', { name: 'Sign in', exact: true }).filter({ hasText: /^Sign in$/ }) }
  get loadError() { return this.page.getByRole('alert').filter({ has: this.page.getByRole('button', { name: 'Try again' }) }) }
  get skeletons() { return this.page.getByLabel('Loading', { exact: true }) }

  /* Shares board */
  get sharesFilter() { return this.page.getByRole('group', { name: 'Filter shares' }) }
  filter(group: Locator, label: string) { return group.getByRole('button', { name: new RegExp(`^${esc(label)} \\d+$`) }) }
  /** A share card: role=button, named "<title> — <status>". */
  shareCard(title: string) { return this.page.getByRole('button', { name: new RegExp(`^${esc(title)} — `) }) }
  get detail() { return this.page.getByRole('complementary', { name: 'Share details' }) }

  /* Received board */
  get receivedFilter() { return this.page.getByRole('group', { name: 'Filter received' }) }
  /** Received cards have no role: the rounded card panel holding the title. */
  receivedCard(title: string) {
    return this.page.locator('div.rounded-2xl.overflow-hidden').filter({ has: this.page.getByText(title, { exact: true }) })
  }

  /* Classes & people board */
  /** Class cards have no role either: the rounded card holding the class name. */
  classCard(name: string) {
    return this.page.locator('div.rounded-2xl.p-4').filter({ has: this.page.getByText(name, { exact: true }) })
  }
  managePanel(name: string) { return this.page.getByRole('complementary', { name: `Manage ${name}` }) }
  get newClass() { return this.page.getByRole('button', { name: '+ New class' }) }
  /** The People list rows: one per person, inside the rounded list panel. */
  personRow(name: string) {
    return this.page.locator('div.min-h-\\[56px\\]').filter({ has: this.page.getByText(name, { exact: true }) })
  }

  /** Open a ⋯ menu inside `scope` and choose an item. */
  async menu(scope: Locator, item: string | RegExp, label: string | RegExp = 'More actions') {
    await scope.getByRole('button', { name: label }).click()
    const menu = this.page.getByRole('menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: item }).click()
  }

  /** From anywhere signed in: the profile menu's Sharing item. */
  async open(profileName = 'Automation User') {
    await this.page.getByRole('button', { name: profileName, exact: true }).click()
    await this.page.getByRole('menu').getByRole('menuitem', { name: /^Sharing/ }).click()
    await expect(this.heading).toBeVisible()
  }
}

/** The one Share dialog (board/ShareComposer.tsx). */
export class ShareComposerDialog {
  readonly dialog: Locator
  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Share', exact: true })
  }

  get project() { return this.dialog.getByRole('combobox') }
  doc(name: string) { return this.dialog.getByRole('checkbox', { name, exact: true }) }
  /** The tri-state "Select all" row: its checkbox has no name of its own, so it is the first checkbox of the row labelled Select all. */
  get selectAll() { return this.dialog.locator('label').filter({ hasText: /^(Select all|Tick shown)/ }).getByRole('checkbox') }
  get to() { return this.dialog.getByRole('searchbox', { name: 'Add a class or a person' }) }
  how(mode: 'Live' | 'Copy') { return this.dialog.getByRole('radio', { name: mode, exact: true }) }
  get send() { return this.dialog.getByRole('button', { name: /^(Send a copy|Share live|Sending…|Going live…|Checking size…)/ }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
  get newClass() { return this.dialog.getByRole('button', { name: '+ New class' }) }
  get severalProjects() { return this.dialog.getByRole('button', { name: '+ Share several projects' }) }
  /** A suggestion chip in the Classes / People groups (dashed buttons). */
  suggestion(name: string) { return this.dialog.getByRole('button', { name: new RegExp(`^.{0,3}${esc(name)}`) }) }
  /** A chosen recipient chip's remove button. */
  removeChip(name: string) { return this.dialog.getByRole('button', { name: `Remove ${name}`, exact: true }) }
  alert(text: string | RegExp) { return this.dialog.getByRole('alert').filter({ hasText: text }) }

  async expectOpen() { await expect(this.dialog).toBeVisible() }

  /** Type a name or email and wait for the person's result chip; returns it. */
  async findPerson(query: string, displayName: string) {
    await this.to.fill(query)
    const chip = this.dialog.getByRole('button', { name: new RegExp(`${esc(displayName)}$`) })
    await expect(chip).toBeVisible()
    return chip
  }

  /** Wait until the size measurement settles (the button stops saying "Checking size…"). */
  async sized() {
    await expect(this.dialog.getByRole('button', { name: 'Checking size…' })).toHaveCount(0)
  }
}

/** "New group" (NewListModal.tsx): name, colour, members. */
export class NewGroupDialog {
  readonly dialog: Locator
  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'New group' })
  }
  get name() { return this.dialog.getByPlaceholder('e.g. Physics 101') }
  colour(name: string) { return this.dialog.getByRole('button', { name, exact: true }) }
  get search() { return this.dialog.getByPlaceholder('Search registered users…') }
  get create() { return this.dialog.getByRole('button', { name: /^(Create group|Creating…)$/ }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
  /** A search result row's Add button (rows have no role; the row holding the email). */
  resultRow(email: string) { return this.dialog.locator('div.flex.items-center').filter({ has: this.page.getByText(email, { exact: true }) }) }
}

/** AddPeopleModal.tsx: team / recently searched / search, one click adds. */
export class AddPeopleDialog {
  readonly dialog: Locator
  constructor(readonly page: Page, title: string | RegExp) {
    this.dialog = page.getByRole('dialog', { name: title })
  }
  get search() { return this.dialog.getByPlaceholder('Search by email…') }
  /** A person row (a button named by its name, email and state). */
  person(name: string) { return this.dialog.getByRole('button', { name: new RegExp(`^.{0,4}${esc(name)}`) }) }
  tab(label: RegExp) { return this.dialog.getByRole('button', { name: label }) }
}

/** The global bell (GlobalNotificationBell / NotificationBell). */
export class NotificationBellControl {
  constructor(readonly page: Page) {}
  get button() { return this.page.getByRole('button', { name: 'Notifications', exact: true }) }
  /** The unread badge is the bell's only text. */
  get badge() { return this.button }
  /** The open panel: its "Notifications" heading's container. */
  get panel() { return this.page.locator('div.w-\\[340px\\]') }
  note(title: string) { return this.panel.getByRole('button', { name: new RegExp(`${esc(title)}`) }) }
}

/** Header Live controls (LiveShareControl / LiveSubscriptionBadge). */
export class LiveHeader {
  constructor(readonly page: Page) {}
  /** Not live: "Share this PDF — …"; live: "This PDF is Live — manage recipients"; failing: "Recipients are NOT receiving updates — …". */
  get shareButton() { return this.page.getByRole('button', { name: 'Share this PDF — a copy, a live copy, or to a group' }) }
  get livePill() { return this.page.getByRole('button', { name: 'This PDF is Live — manage recipients' }) }
  get notSyncingPill() { return this.page.getByRole('button', { name: /^Recipients are NOT receiving updates — / }) }
  get panelHeading() { return this.page.getByRole('heading', { name: 'Live — recipients' }) }
  get pushChanges() { return this.page.getByRole('button', { name: /^(Push changes|Pushing…)$/ }) }
  get stopLive() { return this.page.getByRole('button', { name: /^(Stop live|Stopping…)$/ }) }
  /** The recipient's Live / Away badge (title "Kept up to date by …" or "… is signed out …"). */
  get subscriptionBadge() { return this.page.getByRole('button', { name: /^(Live|Away)$/ }) }
}
