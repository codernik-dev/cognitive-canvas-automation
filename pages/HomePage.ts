/**
 * Projects screen (ProjectSelectionScreen.tsx). Name rule (utils/projectName.ts):
 * trimmed, 1-100 characters, letters/digits/spaces only. Creating a project
 * opens it. A profile with no projects first lands on the Catalog, once per
 * session (App.tsx), so reach() goes Home explicitly.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { UploadInput } from '../data/files.js'
import type { GlobalHeader } from '../components/Shell.js'

export class HomePage {
  constructor(private readonly page: Page, private readonly header: GlobalHeader) {}

  get newProjectName() { return this.page.getByPlaceholder('New project name...') }
  get create() { return this.page.getByRole('button', { name: 'Create', exact: true }) }
  get nameError() { return this.page.locator('[data-tour="project-create"]').getByRole('alert') }
  get emptyState() { return this.page.getByRole('heading', { name: 'No projects yet' }) }
  get search() { return this.page.getByRole('searchbox', { name: 'Search projects' }) }
  get countHeading() { return this.page.getByRole('heading', { name: /^Projects \(\d+\)$|^\d+ of \d+ found$/ }) }
  get selectMode() { return this.page.getByRole('button', { name: 'Select', exact: true }) }
  get uploadCard() { return this.page.locator('[data-tour="upload-card"]') }
  /** The home upload status line ("Uploaded N files", "Skipped: …"). */
  statusLine(text: string | RegExp) { return this.page.getByText(text) }

  /** Project cards, excluding the tour's aria-hidden sample card. */
  get cards(): Locator {
    return this.page.locator('[data-tour="project-card"]:not([aria-hidden="true"])')
  }

  card(name: string): Locator {
    return this.cards.filter({ has: this.page.getByText(name, { exact: true }) })
  }

  /** Go to the projects screen from wherever the app is. */
  async reach() {
    await this.header.home.click()
    await expect(this.newProjectName).toBeVisible()
  }

  async createProject(name: string, via: 'button' | 'enter' = 'button') {
    await this.newProjectName.fill(name)
    if (via === 'enter') await this.newProjectName.press('Enter')
    else await this.create.click()
  }

  async openProject(name: string) {
    await this.card(name).getByText(name, { exact: true }).click()
  }

  async cardAction(name: string, action: 'Rename' | 'Share' | 'Download' | 'Delete') {
    await this.card(name).getByRole('button', { name: 'More actions' }).click()
    await this.page.getByRole('button', { name: action, exact: true }).click()
  }

  async renameProject(from: string, to: string) {
    await this.cardAction(from, 'Rename')
    // In rename mode the title becomes an input, so the card no longer "has text" `from`.
    const input = this.cards.getByRole('textbox')
    await expect(input).toHaveValue(from)
    await input.fill(to)
    await input.press('Enter')
  }

  async deleteProject(name: string) {
    await this.cardAction(name, 'Delete')
    const dialog = this.page.getByRole('dialog', { name: 'Delete Project' })
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
  }

  /** Upload from Home through the visible Upload control and its file chooser. */
  async upload(files: UploadInput) {
    const chooser = this.page.waitForEvent('filechooser')
    if (await this.emptyState.isVisible()) await this.page.getByRole('button', { name: 'Upload', exact: true }).click()
    else await this.uploadCard.click()
    await (await chooser).setFiles(files)
  }
}
