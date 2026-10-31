/**
 * Multi-step journeys shared by the backup specs.
 */
import { expect, type Dialog, type Page, type TestInfo } from '@playwright/test'
import type { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import type { UploadInput } from '../data/files.js'
import { FIND_PDF } from '../data/files.js'
import { expectStoreCount, readStore } from '../helpers/idb.js'

/**
 * From an open PDF: add one written note and one highlight, go Home and
 * export a Local backup. Returns the saved ZIP's path (inside the test's
 * own output folder) and the note id.
 */
export async function exportProjectWithContent(app: CognitiveCanvas, page: Page, testInfo: TestInfo) {
  const noteId = (await app.canvas.place('note', 0.5, 0.35))!
  await app.canvas.writeNote(noteId, 'Backed up note')
  await app.viewer.tool('highlight').click()
  await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
  await expectStoreCount(page, 'highlights', 1)
  await app.header.home.click()
  const { file, suggestedName } = await exportAllLocal(app, testInfo)
  return { noteId, file, suggestedName }
}

/** From Home: Data Center > Backup > Local > Download .zip with every project selected; save it in the test's output folder. */
export async function exportAllLocal(app: CognitiveCanvas, testInfo: TestInfo) {
  await app.dataCenter.openFromHeader()
  const download = await app.dataCenter.exportLocal()
  const file = testInfo.outputPath(download.suggestedFilename())
  // The 3.5 s toast can come and go while the file is still being saved: watch for both together.
  await Promise.all([app.toasts.expectShown(/^Backup saved/, 30_000), download.saveAs(file)])
  // The Data Center closes itself shortly after a successful export.
  await expect(app.dataCenter.dialog).toBeHidden()
  return { file, suggestedName: download.suggestedFilename() }
}

/** Open the Data Center, restore `file` from Local, confirm, and wait for the app's reload. */
export async function restoreAndReload(app: CognitiveCanvas, page: Page, file: UploadInput) {
  await app.dataCenter.openFromHeader()
  await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), app.dataCenter.restoreLocal(file)])
}

/**
 * Boot a fresh profile to the (empty) projects screen: PIN set up, first-run
 * Catalog dismissed by going Home. The same steps as the `signedIn` fixture,
 * for specs that must install something (an init script, a clock, a held
 * mock) between the mocks and the first page load.
 */
export async function bootToHome(app: CognitiveCanvas) {
  await app.open()
  await app.pinSetup.createPin()
  await app.firstRunCatalogShown()
  await app.home.reach()
}

/** Create projects one after another from Home and come back to Home each time. */
export async function createProjects(app: CognitiveCanvas, names: string[]) {
  for (const name of names) {
    await app.home.createProject(name)
    await app.documents.expectOpen(name)
    await app.documents.backToProjects.click()
    await expect(app.home.card(name)).toBeVisible()
  }
}

/** Create a project holding FIND_PDF, then come back to Home. Returns the project and document ids. */
export async function projectWithPdf(app: CognitiveCanvas, page: Page, name: string) {
  await app.home.createProject(name)
  await app.documents.expectOpen(name)
  const before = (await readStore(page, 'documents')).length
  await app.documents.uploadFiles(FIND_PDF.payload())
  await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
  await expectStoreCount(page, 'documents', before + 1)
  const project = (await readStore<{ id: string; name: string }>(page, 'projects')).find((p) => p.name === name)!
  const doc = (await readStore<{ id: string; projectId: string }>(page, 'documents')).find((d) => d.projectId === project.id)!
  await app.header.home.click()
  await expect(app.home.card(name)).toBeVisible()
  return { projectId: project.id, documentId: doc.id }
}

/** Projects by name -> id. */
export async function projectIds(page: Page): Promise<Record<string, string>> {
  const rows = await readStore<{ id: string; name: string }>(page, 'projects')
  return Object.fromEntries(rows.map((r) => [r.name, r.id]))
}

/**
 * Answer the next native confirm/alert. Start it BEFORE the click that opens
 * the dialog; it resolves with the dialog's type and message once answered.
 */
export function answerNextDialog(page: Page, accept: boolean): Promise<{ type: string; message: string }> {
  return new Promise((resolve) => {
    page.once('dialog', async (d: Dialog) => {
      const seen = { type: d.type(), message: d.message() }
      if (accept) await d.accept()
      else await d.dismiss()
      resolve(seen)
    })
  })
}

/** The exact restore warning every restore path shows (restoreService.ts RESTORE_CONFIRM). */
export const RESTORE_CONFIRM =
  'Restore will bring back the projects from this backup and change your current library — this cannot be undone. If you have work you might still need, make a backup first.\n\nContinue with the restore?'

/** A ZIP file name the app gives a timestamped backup (runBackup.ts backupFilename). */
export const BACKUP_FILE_NAME = /^cc-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/

/** Mirror of src/utils/formatBytes.ts, to state sizes the way the app prints them. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
