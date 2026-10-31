/**
 * A project's document list (DocumentListView.tsx). Uploading exactly one
 * file opens it; several stay on the list. Accepts .pdf/.md/.txt only.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { FilePayload, UploadInput } from '../data/files.js'

export class DocumentsPage {
  constructor(private readonly page: Page) {}

  get backToProjects() { return this.page.getByRole('button', { name: 'Back to projects' }) }
  get upload() { return this.page.locator('[data-tour="upload-btn"]') }
  get scan() { return this.page.locator('[data-tour="scan-btn"]') }
  get emptyState() { return this.page.getByText('No documents yet') }
  get rename() { return this.page.getByRole('button', { name: 'Rename', exact: true }) }
  get cards(): Locator { return this.page.locator('[data-tour="document-card"]') }

  card(name: string): Locator {
    return this.cards.filter({ hasText: name })
  }

  async expectOpen(projectName: string) {
    await expect(this.backToProjects).toBeVisible()
    await expect(this.page.getByText(projectName, { exact: true }).first()).toBeVisible()
  }

  async uploadFiles(files: UploadInput) {
    const chooser = this.page.waitForEvent('filechooser')
    await this.upload.click()
    await (await chooser).setFiles(files)
  }

  /**
   * Upload several documents and wait until every one has its card. Files are
   * processed one after another and the work is CPU-bound (pdf.js text
   * extraction), so the wait is sized for a loaded machine (run 6: two PDFs
   * took over 10 s beside three busy workers).
   */
  async uploadMany(files: FilePayload[]) {
    const before = await this.cards.count()
    await this.uploadFiles(files)
    await expect(this.cards).toHaveCount(before + files.length, { timeout: 45_000 })
  }

  async openDocument(name: string) {
    await this.card(name).click()
  }

  async deleteDocument(name: string) {
    await this.card(name).getByRole('button', { name: 'Delete document' }).click()
    const dialog = this.page.getByRole('dialog', { name: /^Delete (document|\d+ documents)\?$/ })
    await dialog.getByRole('button', { name: /^Delete/ }).click()
    await expect(dialog).toBeHidden()
  }
}
