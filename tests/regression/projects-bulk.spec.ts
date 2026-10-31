/**
 * Regression: select mode on the projects screen and the bulk delete
 * (ProjectSelectionScreen.tsx select bar, BulkDeleteProjectsModal.tsx).
 * Selection follows the search like a mail client: "Select all" ticks what
 * is shown, and ticked projects hidden by the search are counted, named in
 * the confirmation, and deleted only because the dialog listed them.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/shell.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { FIND_PDF } from '../../data/files.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

async function makeProjects(app: CognitiveCanvas, names: string[]) {
  for (const name of names) {
    await app.home.createProject(name)
    await app.documents.expectOpen(name)
    await app.documents.backToProjects.click()
  }
  await expect(app.home.cards).toHaveCount(names.length)
}

const storedNames = async (page: Page) => (await readStore<{ name: string }>(page, 'projects')).map((p) => p.name).sort()

test.describe('Select mode and bulk delete', { tag: ['@regression', '@projects'] }, () => {
  test('REG-096 select mode deletes only the ticked projects and everything inside them', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, shell, page }) => {
    await makeProjects(app, ['Alpha Project', 'Bravo Project', 'Charlie Project'])
    await app.home.openProject('Bravo Project')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.header.home.click()

    await shell.projects.selectButton.click()
    await app.home.card('Alpha Project').click()
    await app.home.card('Bravo Project').click()
    await expect(shell.projects.selectedCount).toHaveText('2 selected')
    await shell.projects.deleteSelected.click()
    const dialog = shell.projects.bulkDialog('Delete 2 Projects')
    await expect(dialog).toContainText('This will permanently delete 2 projects and all their contents. This action cannot be undone.')
    await expect(dialog.getByRole('listitem')).toHaveText(['Alpha Project', 'Bravo Project'])
    await dialog.getByRole('button', { name: 'Delete 2', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect(app.home.cards).toHaveCount(1)
    await expect(app.home.card('Charlie Project')).toBeVisible()
    expect(await storedNames(page)).toEqual(['Charlie Project'])
    for (const store of ['documents', 'searchText'] as const) await expectStoreCount(page, store, 0)
    // Select mode ends after the delete.
    await expect(shell.projects.selectionBar).toBeHidden()
    await expect(shell.projects.selectButton).toBeVisible()
  })

  test('REG-620 select mode turns cards into checkboxes, hides card menus and the upload tile, and Cancel leaves it with nothing ticked', { tag: '@P2' }, async ({ signedIn: app, shell, page }) => {
    await makeProjects(app, ['One Project', 'Two Project'])
    await expect(app.home.uploadCard).toBeVisible()
    await shell.projects.selectButton.click()
    await expect(shell.projects.selectedCount).toHaveText('0 selected')
    await expect(shell.projects.deleteSelected).toBeDisabled()
    await expect(app.home.uploadCard).toBeHidden()
    await expect(app.home.card('One Project').getByRole('button', { name: 'More actions' })).toBeHidden()

    await app.home.card('One Project').click() // toggles, does not open
    await expect(app.documents.backToProjects).toBeHidden()
    await expect(shell.projects.selectedCount).toHaveText('1 selected')
    await expect(shell.projects.deleteSelected).toBeEnabled()
    await app.home.card('One Project').click()
    await expect(shell.projects.selectedCount).toHaveText('0 selected')

    await shell.projects.selectAll.click()
    await expect(shell.projects.selectedCount).toHaveText('2 selected')
    await expect(shell.projects.deselectAll).toBeVisible()
    await shell.projects.deselectAll.click()
    await expect(shell.projects.selectedCount).toHaveText('0 selected')

    await shell.projects.selectAll.click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(shell.projects.selectionBar).toBeHidden()
    await expect(app.home.uploadCard).toBeVisible()
    // Back in select mode, nothing is still ticked.
    await shell.projects.selectButton.click()
    await expect(shell.projects.selectedCount).toHaveText('0 selected')
    expect(await storedNames(page)).toEqual(['One Project', 'Two Project'])
  })

  test('REG-621 Select all ticks only what the search shows; ticked projects hidden by the search are counted, listed in the dialog, and can be cleared', { tag: '@P1' }, async ({ signedIn: app, shell, page }) => {
    await makeProjects(app, ['Biology Notes', 'Biology Exam', 'Chemistry Lab'])
    await shell.projects.selectButton.click()
    await app.home.card('Chemistry Lab').click()
    await app.home.search.fill('biology')
    await expect(app.home.cards).toHaveCount(2)
    await expect(shell.projects.selectedCount).toHaveText('1 selected (1 hidden by search · clear all)')
    await shell.projects.selectAll.click()
    await expect(shell.projects.selectedCount).toHaveText('3 selected (1 hidden by search · clear all)')
    // Deselect all unticks only what is shown.
    await shell.projects.deselectAll.click()
    await expect(shell.projects.selectedCount).toHaveText('1 selected (1 hidden by search · clear all)')
    await shell.projects.clearHidden.click()
    await expect(shell.projects.selectedCount).toHaveText('0 selected')

    await app.home.card('Biology Exam').click()
    await app.home.search.fill('chem')
    await app.home.card('Chemistry Lab').click()
    await shell.projects.deleteSelected.click()
    const dialog = shell.projects.bulkDialog('Delete 2 Projects')
    await expect(dialog.getByRole('listitem')).toHaveText(['Biology Exam', 'Chemistry Lab'])
    await dialog.getByRole('button', { name: 'Delete 2', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(await storedNames(page)).toEqual(['Biology Notes'])
  })

  test('REG-622 Cancel in the bulk dialog deletes nothing; a single ticked project gets the one-project wording', { tag: '@P2' }, async ({ signedIn: app, shell, page }) => {
    await makeProjects(app, ['Keep Me', 'Keep Me Too'])
    await shell.projects.selectButton.click()
    await shell.projects.selectAll.click()
    await shell.projects.deleteSelected.click()
    const dialog = shell.projects.bulkDialog('Delete 2 Projects')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await storedNames(page)).toEqual(['Keep Me', 'Keep Me Too'])
    await expect(shell.projects.selectedCount).toHaveText('2 selected') // the selection is kept

    await shell.projects.deselectAll.click()
    await app.home.card('Keep Me Too').click()
    await shell.projects.deleteSelected.click()
    const one = shell.projects.bulkDialog('Delete Project')
    await expect(one).toContainText('This will permanently delete this project and all its contents. This action cannot be undone.')
    await one.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(one).toBeHidden()
    expect(await storedNames(page)).toEqual(['Keep Me'])
  })
})
