/**
 * Data Center (Backup & Restore): DataCenterModal.tsx and everything it
 * routes to: the destination chooser (DataCenterWelcome), the sidebar, the
 * plan gate (SourceGate), the Local .zip export/restore views (BackupView /
 * RestoreView), Cloud backup/restore, the MoBrowser GitHub and folder panels
 * (BackupDestinations) and the automatic cloud sync page (CloudSyncSection).
 *
 * In an ordinary browser only "Local" works without an account: export is a
 * .zip download, restore reads a .zip and asks a native confirm() first, then
 * reloads the page on success. Cloud needs Pro, GitHub needs Economy and
 * MoBrowser; both are exercised against mocks only (helpers/mocks/*).
 *
 * The modal has no title, so it is found by its Backup/Restore toggle. Cards,
 * sidebar rows and panel rows are buttons named by their visible text.
 */
import { expect, type Download, type Locator, type Page } from '@playwright/test'
import type { UploadInput } from '../data/files.js'

export type SourceLabel = 'Cloud' | 'GitHub' | 'Local' | 'Auto Backup'

/** Sidebar subtitles (DataCenterSidebar.tsx). */
export const SIDEBAR_SUBTITLE: Record<SourceLabel, string> = {
  Cloud: 'Sync across devices',
  GitHub: 'Commit to repository',
  Local: 'On this device',
  'Auto Backup': 'Runs on its own',
}

export class DataCenter {
  constructor(private readonly page: Page) {}

  get dialog() { return this.page.getByRole('dialog').filter({ has: this.page.getByRole('button', { name: /^(Backup|Restore)$/ }) }) }
  modeToggle(m: 'Backup' | 'Restore') { return this.dialog.getByRole('button', { name: m, exact: true }) }

  // ── Destination chooser ──
  get chooserHeading() { return this.dialog.getByRole('heading', { name: /^(Select backup destination|Select restore source)$/ }) }
  /** Chooser cards carry the `dc-card` hover scope; the only stable hook that tells them from sidebar rows. */
  get cards() { return this.dialog.locator('button.dc-card') }
  /** Source cards are named "[plan badge] Label description", e.g. "Pro Cloud Sync across all your devices". */
  source(label: SourceLabel) {
    return this.dialog.getByRole('button', { name: new RegExp(`^(Pro |Economy )?${label} `) })
  }
  card(label: SourceLabel) { return this.cards.filter({ has: this.page.getByText(label, { exact: true }) }) }
  get remember() { return this.dialog.getByRole('checkbox', { name: /Remember my choice and skip this screen/ }) }
  get close() { return this.dialog.getByRole('button', { name: 'Close', exact: true }) }
  get videoButton() { return this.dialog.getByRole('button', { name: /^(Tutorial videos|Watch tutorial: .+)$/ }) }
  get videoMenu() { return this.page.getByRole('menu').filter({ hasText: 'Tutorial videos' }) }

  // ── Sidebar (shown once a destination is open) ──
  sidebarSource(label: SourceLabel) {
    return this.dialog.getByRole('button', { name: new RegExp(`^${label} ${SIDEBAR_SUBTITLE[label]}`) })
  }
  autoChild(label: 'Cloud' | 'Folder & GitHub') {
    return this.dialog.getByRole('button', { name: label === 'Cloud' ? 'Cloud Follows your account' : 'Folder & GitHub A copy you control', exact: true })
  }
  get allDestinations() { return this.dialog.getByRole('button', { name: '← All destinations' }) }
  /** The figure beside "Cloud Storage" at the foot of the sidebar, e.g. "0.0 MB / 10.00 GB". */
  get storageFigure() { return this.dialog.getByText('Cloud Storage', { exact: true }).locator('xpath=following-sibling::span[1]') }
  /** The red over-quota sentence under the meter. */
  get overQuota() { return this.dialog.getByText(/^Over your storage limit\./) }

  // ── Plan gate (SourceGate) ──
  get gateHeading() { return this.dialog.getByRole('heading', { level: 3 }) }
  gateButton(name: 'Sign in' | 'Upgrade to Pro' | 'Upgrade to Economy') { return this.dialog.getByRole('button', { name, exact: true }) }

  // ── Local export / restore (ordinary browser) ──
  get exportHeading() { return this.page.getByRole('heading', { name: 'Export to Device' }) }
  get restoreHeading() { return this.page.getByRole('heading', { name: 'Restore from Device' }) }
  get downloadZip() { return this.page.getByRole('button', { name: /^Download \.zip \(\d+\)$/ }) }
  get restoreNow() { return this.page.getByRole('button', { name: /^(Restore Now|Restoring\.\.\.)$/ }) }
  get selectFile() { return this.page.getByRole('button', { name: 'Select File' }) }
  get removeFile() { return this.page.getByRole('button', { name: 'Remove file' }) }
  get cancel() { return this.dialog.getByRole('button', { name: 'Cancel', exact: true }) }
  get description() { return this.dialog.getByPlaceholder('e.g. "End of Sprint 12"') }
  get selectAll() { return this.dialog.getByRole('button', { name: /^(Select All|Deselect All)$/ }) }
  get selectionCount() { return this.dialog.getByText(/^Select Projects \(\d+\/\d+\)$/) }
  /** The project rows of a backup list: <label>s whose second line reads "<when> • <n> docs". */
  get projectRows() { return this.dialog.locator('label').filter({ hasText: '•' }) }
  /** A project row of the backup list (a <label> named by its text). */
  projectRow(name: string) { return this.dialog.locator('label').filter({ has: this.page.getByText(name, { exact: true }) }) }
  /** The red error box under a backup/restore list. */
  get errorBox() { return this.dialog.locator('div.text-red-500').first() }

  // ── Cloud backup / restore ──
  get createBackup() { return this.dialog.getByRole('button', { name: /^Create Backup \(\d+\)$/ }) }
  get unlock() { return this.dialog.getByRole('button', { name: /^(Unlock (Pro|Economy)|Checking your plan…)$/ }) }
  /** Cloud restore rows: <label> with a hidden radio named cloudBackup. */
  get cloudRows() { return this.dialog.locator('label').filter({ has: this.page.locator('input[name="cloudBackup"]') }) }
  cloudRow(text: string) { return this.cloudRows.filter({ hasText: text }) }
  deleteBackup(row: Locator) { return row.getByRole('button', { name: 'Delete backup' }) }

  // ── MoBrowser panels (BackupDestinations) ──
  get panelHeading() { return this.dialog.getByRole('heading', { level: 3 }).first() }
  get openInMoBrowser() { return this.dialog.getByRole('heading', { name: 'Open in MoBrowser' }) }
  get downloadMoBrowser() { return this.dialog.getByRole('button', { name: 'Download MoBrowser' }) }
  /** The repository / folder dropdown trigger (shows the chosen name or "Choose a …"). */
  chooser(kind: 'repository' | 'folder') {
    const label = kind === 'repository' ? 'Which repository' : 'Where to save'
    return this.dialog.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]/button')
  }
  menuOption(name: string) { return this.dialog.getByRole('button', { name: new RegExp(`^${escapeRe(name)} `) }) }
  get refreshRepositories() { return this.dialog.getByRole('button', { name: /^↻ (Refresh repositories|Loading…)$/ }) }
  get refreshFolders() { return this.dialog.getByRole('button', { name: /^↻ (Refresh folders|Loading…)$/ }) }
  get noteInput() { return this.dialog.getByPlaceholder('Backup note / description (optional)') }
  get backUpNow() { return this.dialog.getByRole('button', { name: /^(Back up now|Pushing…|Backing up…)$/ }).first() }
  /** A repository / folder row of a restore list ("name owner/repo · branch ›"). */
  destinationRow(name: string) { return this.dialog.getByRole('button', { name: new RegExp(`^${escapeRe(name)} `) }) }
  get restoreRows() { return this.dialog.getByRole('button', { name: /^Restore backup from / }) }
  get backToRepositories() { return this.dialog.getByRole('button', { name: '← Repositories' }) }
  get backToFolders() { return this.dialog.getByRole('button', { name: '← Folders' }) }
  get refreshList() { return this.dialog.getByRole('button', { name: 'Refresh', exact: true }) }

  // ── Automatic backup (folder & GitHub schedule) ──
  get autoSwitch() { return this.dialog.getByRole('switch') }
  /** "Where to save" choice. Only these carry type="button", which tells GitHub's from the sidebar's GitHub row. */
  target(label: 'Local folder' | 'GitHub') { return this.dialog.getByRole('button', { name: new RegExp(`^${label} `) }).and(this.page.locator('[type="button"]')) }
  interval(label: '10 sec' | '15 min' | '30 min' | '1 hour' | '6 hours') { return this.dialog.getByRole('button', { name: label, exact: true }) }
  /** The confirmation card's figures: Destination / Every / Next backup / Last backup. */
  autoFact(label: 'Destination' | 'Every' | 'Next backup' | 'Last backup') {
    return this.dialog.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]')
  }

  // ── Phone layout (DataCenterMobile, opened from the header's Menu sheet) ──
  get phoneMenu() { return this.page.getByRole('button', { name: 'Menu', exact: true }) }
  get phoneMenuEntry() { return this.page.getByRole('button', { name: 'Backup & Restore', exact: true }) }
  phoneTile(name: string) { return this.dialog.getByRole('button', { name, exact: true }) }
  get backToDataCenter() { return this.dialog.getByRole('button', { name: 'Back to Data Center' }) }

  // ── Journeys ──

  async openFromHeader() {
    await this.page.getByRole('button', { name: 'Backup & Restore' }).click()
    await expect(this.modeToggle('Backup')).toBeVisible()
  }

  /** From the chooser: pick mode, then a card. */
  async choose(mode: 'Backup' | 'Restore', label: SourceLabel) {
    await this.modeToggle(mode).click()
    await this.source(label).click()
  }

  /** Local export: returns the browser download. */
  async exportLocal(): Promise<Download> {
    await this.modeToggle('Backup').click()
    await this.source('Local').click()
    await expect(this.exportHeading).toBeVisible()
    const download = this.page.waitForEvent('download')
    await this.downloadZip.click()
    return download
  }

  /**
   * Local restore. `confirm` decides the native "Restore will bring back…"
   * dialog. Resolves when Restore Now has been pressed; the caller asserts
   * the outcome (reload + data, or the error shown).
   */
  async restoreLocal(file: UploadInput, confirm: boolean = true) {
    await this.modeToggle('Restore').click()
    await this.source('Local').click()
    await expect(this.restoreHeading).toBeVisible()
    await this.pickRestoreFile(file)
    this.page.once('dialog', (d) => (confirm ? d.accept() : d.dismiss()))
    await this.restoreNow.click()
  }

  async pickRestoreFile(file: UploadInput) {
    const chooser = this.page.waitForEvent('filechooser')
    await this.selectFile.click()
    await (await chooser).setFiles(file)
  }
}

export function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
