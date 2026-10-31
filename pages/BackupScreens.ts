/**
 * Screens around backup that are not the Data Center's own panels:
 *
 *   cloudSync   Data Center > Auto Backup > Cloud (settings/CloudSyncSection.tsx)
 *   notice      the first-run "Cloud backup is on" toast (CloudSyncNotice.tsx)
 *   reminder    the bottom-right backup nudge (BackupReminder.tsx)
 *   overlay     the global "Restoring your data…" loader (RestoreOverlay.tsx)
 *   storage     the header storage chip and the Storage dialog (StorageChip / StorageModal)
 *   plan        Settings > Plan (settings/PlanSection.tsx)
 *   banner      the subscription status banner (SubscriptionStatusBanner.tsx)
 *   signOut     the "Sign out?" confirmation (SignOutConfirmModal.tsx)
 *   video       the tutorial player (TutorialVideoModal.tsx)
 */
import type { Locator, Page } from '@playwright/test'

export class CloudSyncPanel {
  constructor(private readonly page: Page) {}
  get heading() { return this.page.getByRole('heading', { name: 'Cloud', exact: true, level: 2 }) }
  get switch() { return this.page.getByRole('switch') }
  /** The status line under "Automatic cloud backup". */
  get status() { return this.page.getByText('Automatic cloud backup', { exact: true }).locator('xpath=following-sibling::div[1]') }
  get backUpNow() { return this.page.getByRole('button', { name: 'Back up now' }) }
  get seePlans() { return this.page.getByRole('button', { name: 'See plans', exact: true }) }
  /** "Storage used" figure, e.g. "12 KB of 10.00 GB". */
  get storageUsed() { return this.page.getByText('Storage used', { exact: true }).locator('xpath=following-sibling::div[1]') }
  get lastSync() { return this.page.getByText('Last sync', { exact: true }).locator('xpath=following-sibling::div[1]') }
  /** One project row: its name, its state word or time, and its Remove / Sync again button. */
  row(name: string): Locator {
    return this.page.locator('div.divide-y > div').filter({ has: this.page.getByText(name, { exact: true }) })
  }
  removeButton(name: string) { return this.row(name).getByRole('button', { name: /^(Remove|Remove from cloud\?|Removing\.\.\.)$/ }) }
  syncAgain(name: string) { return this.row(name).getByRole('button', { name: 'Sync again' }) }
  get details() { return this.page.locator('details').filter({ hasText: 'Sync details' }) }
  detail(label: string) { return this.details.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]') }
}

export class CloudSyncNotice {
  constructor(private readonly page: Page) {}
  get toast() { return this.page.getByRole('status').filter({ hasText: 'Cloud backup is on' }) }
  get manage() { return this.toast.getByRole('button', { name: 'Manage' }) }
  get turnOff() { return this.toast.getByRole('button', { name: 'Turn it off' }) }
  get dismiss() { return this.toast.getByRole('button', { name: 'Dismiss' }) }
}

export class BackupReminderChip {
  constructor(private readonly page: Page) {}
  /** The chip's main button: "{primary}. {secondary}. Click to open backup." */
  get open() { return this.page.getByRole('button', { name: /\. Click to open backup\.$/ }) }
  get later() { return this.page.getByRole('button', { name: 'Remind me later' }) }
}

export class RestoreLoader {
  constructor(private readonly page: Page) {}
  get title() { return this.page.getByText('Restoring your data…') }
}

export class StorageScreens {
  constructor(private readonly page: Page) {}
  get chip() { return this.page.getByRole('button', { name: 'Open storage details' }) }
  get dialog() { return this.page.getByRole('dialog', { name: 'Storage' }) }
  kind(label: 'Documents' | 'Images & recordings' | 'Notes & highlights') {
    return this.dialog.getByRole('button', { name: new RegExp(`^${label.replace('&', '&')} `) })
  }
  projectRow(name: string) { return this.dialog.getByRole('button', { name: new RegExp(`^${name} `) }) }
  get close() { return this.dialog.getByRole('button', { name: 'Close', exact: true }).last() }
}

export class PlanScreen {
  constructor(private readonly page: Page) {}
  get card() { return this.page.locator('div.rounded-lg').filter({ hasText: 'Your plan' }).first() }
  get name() { return this.card.locator('div.text-lg') }
  get status() { return this.card.getByRole('status') }
  get button() { return this.card.getByRole('button') }
  get includesHeading() { return this.page.getByRole('heading', { name: /^What .+ includes$/ }) }
  /** One "what this plan includes" row: ✓/– + label + value. */
  row(label: string) { return this.page.locator('div.divide-y > div').filter({ has: this.page.getByText(label, { exact: true }) }) }
}

export class StatusBanner {
  constructor(private readonly page: Page) {}
  /** The banner sits at the top of the app with role=status and a red/primary tone. */
  get bar() { return this.page.getByRole('status').filter({ has: this.page.locator('span.truncate') }).first() }
  button(name: string) { return this.bar.getByRole('button', { name }) }
}

export class SignOutDialog {
  constructor(private readonly page: Page) {}
  /** The signed-in header pill, named by the account's full name. */
  accountButton(fullName: string) { return this.page.getByRole('button', { name: fullName, exact: true }) }
  get menuItem() { return this.page.getByRole('menuitem', { name: 'Sign out', exact: true }) }
  get dialog() { return this.page.getByRole('dialog', { name: 'Sign out?' }) }
  get confirm() { return this.dialog.getByRole('button', { name: 'Sign out', exact: true }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
}

export class VideoPlayer {
  constructor(private readonly page: Page) {}
  dialog(title: string) { return this.page.getByRole('dialog', { name: title }) }
  frame(title: string) { return this.dialog(title).locator('iframe') }
}

export class BackupUi {
  readonly cloudSync: CloudSyncPanel
  readonly notice: CloudSyncNotice
  readonly reminder: BackupReminderChip
  readonly overlay: RestoreLoader
  readonly storage: StorageScreens
  readonly plan: PlanScreen
  readonly banner: StatusBanner
  readonly signOut: SignOutDialog
  readonly video: VideoPlayer
  constructor(page: Page) {
    this.cloudSync = new CloudSyncPanel(page)
    this.notice = new CloudSyncNotice(page)
    this.reminder = new BackupReminderChip(page)
    this.overlay = new RestoreLoader(page)
    this.storage = new StorageScreens(page)
    this.plan = new PlanScreen(page)
    this.banner = new StatusBanner(page)
    this.signOut = new SignOutDialog(page)
    this.video = new VideoPlayer(page)
  }
}
