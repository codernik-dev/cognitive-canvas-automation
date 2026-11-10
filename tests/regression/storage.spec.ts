/**
 * Regression: the storage figure in the header and the Storage dialog
 * (StorageChip.tsx, projects/StorageModal.tsx, services/storage/storageScan.ts).
 * The figure is the app's own data footprint, summed from IndexedDB, against
 * the plan's local allowance (10 GB on Free), not the browser's estimate.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { StorageScreens } from '../../pages/BackupScreens.js'
import { FIND_PDF } from '../../data/files.js'
import { formatBytes } from '../../workflows/backup.js'

test.describe('Storage', { tag: ['@regression', '@backup', '@storage'] }, () => {
  test('REG-492 an empty library shows 0 KB of 10.00 GB and says nothing is stored yet', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    const storage = new StorageScreens(page)
    await expect(storage.chip).toHaveText('0 KB / 10.00 GB')
    await storage.chip.click()
    await expect(storage.dialog).toBeVisible()
    await expect(storage.dialog.getByText('Nothing stored yet. Projects will appear here as you add them.')).toBeVisible()
    await expect(storage.kind('Documents')).toHaveText('Documents0 KB')
    await expect(storage.kind('Images & recordings')).toHaveText('Images & recordings0 KB')
    await storage.close.click()
    await expect(storage.dialog).toBeHidden()
  })

  test('REG-493 the chip and the dialog agree on the total; documents count the PDF bytes exactly; a project row opens to its documents', { tag: '@P2' }, async ({ pdfOpen: app, page, project }) => {
    const storage = new StorageScreens(page)
    const pdfBytes = FIND_PDF.payload().buffer.length
    await app.viewer.tool('extract-image').click()
    await app.viewer.dragOnPage(1, [0.1, 0.08], [0.5, 0.2])
    await expectStoreCount(page, 'mediaBlobs', 1)
    const [blob] = await readStore<{ size: number }>(page, 'mediaBlobs')
    await app.header.home.click()

    await expect(storage.chip).toHaveText(/^\d+(\.\d)? KB \/ 10\.00 GB$/)
    await storage.chip.click()
    await expect(storage.kind('Documents')).toHaveText(`Documents${formatBytes(pdfBytes)}`)
    await expect(storage.kind('Images & recordings')).toHaveText(`Images & recordings${formatBytes(blob.size)}`)
    const used = (await storage.chip.textContent())!.split(' / ')[0]
    await expect(storage.dialog.getByText(used, { exact: true }).first()).toBeVisible()
    await expect(storage.dialog.getByText('of 10.00 GB', { exact: true })).toBeVisible()
    await expect(storage.dialog.getByText('1 project', { exact: true })).toBeVisible()
    const row = storage.projectRow(project.name)
    await expect(row).toHaveText(`${project.name}${used}`)
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(storage.dialog.getByText(FIND_PDF.displayName, { exact: true })).toBeVisible()

    // The Documents lens lists each file with its project.
    await storage.kind('Documents').click()
    await expect(storage.kind('Documents')).toHaveAttribute('aria-pressed', 'true')
    await expect(storage.dialog.getByText('1 item', { exact: true })).toBeVisible()
    await expect(storage.dialog.getByText(project.name, { exact: true })).toBeVisible()
    await storage.dialog.getByRole('button', { name: 'Documents', exact: true }).click()
    await expect(storage.kind('Documents')).toHaveAttribute('aria-pressed', 'false')
  })

  test('REG-956 the legend filters say what a press does; a kind with nothing in it says "Nothing here yet"; images list with their project, and notes group by project', { tag: '@P3' }, async ({ pdfOpen: app, page, project }) => {
    const storage = new StorageScreens(page)
    const tips: ['Documents' | 'Images & recordings' | 'Notes & highlights', string][] = [
      ['Documents', 'Show only documents'],
      ['Images & recordings', 'Show only images & recordings'],
      ['Notes & highlights', 'Show only notes & highlights'],
    ]
    // Only the PDF so far: no images or recordings.
    await app.header.home.click()
    await storage.chip.click()
    for (const [kind, tip] of tips) await expect(storage.kind(kind), kind).toHaveAttribute('title', tip)
    await storage.kind('Images & recordings').click()
    await expect(storage.kind('Images & recordings')).toHaveAttribute('aria-pressed', 'true')
    await expect(storage.kind('Images & recordings')).toHaveAttribute('title', 'Show everything')
    await expect(storage.dialog.getByText('Nothing here yet', { exact: true })).toBeVisible()
    // The filter is a removable chip above the list.
    await storage.dialog.getByRole('button', { name: 'Images & recordings', exact: true }).click()
    await expect(storage.kind('Images & recordings')).toHaveAttribute('aria-pressed', 'false')
    await storage.close.click()
    await expect(storage.dialog).toBeHidden()

    // An image cut from the PDF, and a note on the canvas.
    await app.home.openProject(project.name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.viewer.tool('extract-image').click()
    await app.viewer.dragOnPage(1, [0.1, 0.08], [0.5, 0.2])
    await expectStoreCount(page, 'mediaBlobs', 1)
    const note = (await app.canvas.place('note', 0.6, 0.6))!
    await app.canvas.writeNote(note, 'Storage lens note')
    await expect.poll(async () => (await readStore<{ type: string; data: { content?: string } }>(page, 'workspaceItems')).some((i) => i.type === 'note' && (i.data.content ?? '').includes('Storage lens note'))).toBe(true)
    await app.header.home.click()

    await storage.chip.click()
    await storage.kind('Images & recordings').click()
    await expect(storage.dialog.getByText('1 item', { exact: true })).toBeVisible()
    // Each image or recording names where it lives: its project, and its document when it has one.
    await expect(storage.dialog.getByText(new RegExp(`^${project.name}( · ${FIND_PDF.displayName})?$`))).toBeVisible()
    await storage.dialog.getByRole('button', { name: 'Images & recordings', exact: true }).click()

    await storage.kind('Notes & highlights').click()
    await expect(storage.kind('Notes & highlights')).toHaveAttribute('aria-pressed', 'true')
    await expect(storage.dialog.getByText('1 item', { exact: true })).toBeVisible()
    await expect(storage.dialog.getByText(project.name, { exact: true }).first()).toBeVisible()
    await storage.dialog.getByRole('button', { name: 'Notes & highlights', exact: true }).click()
    await expect(storage.kind('Notes & highlights')).toHaveAttribute('aria-pressed', 'false')
  })
})
