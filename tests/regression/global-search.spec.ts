/**
 * Regression: quick search (GlobalSearchModal.tsx), the Ctrl+K spotlight of
 * an open project. It searches the open project's document names and the
 * text of its canvas notes and text boxes (the Home tour says "finds any
 * document in the project by name"); it is mounted only inside a project,
 * so other projects' documents are out of its scope by design.
 */
import { test, expect } from '../../fixtures/shell.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { expectStoreCount } from '../../helpers/idb.js'
import { selectionHandles } from '../../pages/ShellPages.js'

test.describe('Quick search', { tag: ['@regression', '@global-search'] }, () => {
  test('REG-676 Ctrl+K lists the project\'s documents, filters by name in any case, and Enter opens the chosen one', { tag: ['@P2', '@sanity'] }, async ({ project: _p, app, shell, page }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)

    await page.keyboard.press('Control+k')
    await expect(shell.quickSearch.input).toBeFocused()
    await expect(shell.quickSearch.results).toHaveCount(2)
    await expect(shell.quickSearch.result(FIND_PDF.displayName)).toContainText(`${FIND_PDF.pageCount} pages`)
    await expect(shell.quickSearch.result(SECOND_PDF.displayName)).toContainText('1 pages')

    await shell.quickSearch.input.fill('SECOND')
    await expect(shell.quickSearch.results).toHaveCount(1)
    await expect(shell.quickSearch.results.first()).toContainText(SECOND_PDF.displayName)
    await expect(shell.quickSearch.results.first()).toContainText('document')
    await page.keyboard.press('Enter')
    await expect(shell.quickSearch.input).toBeHidden()
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)

    // Ctrl+K toggles; Escape closes.
    await page.keyboard.press('Control+k')
    await expect(shell.quickSearch.input).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(shell.quickSearch.input).toBeHidden()
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Escape')
    await expect(shell.quickSearch.input).toBeHidden()
  })

  test('REG-677 canvas notes and text boxes are found by their words and picking one selects it on the canvas', { tag: '@P2' }, async ({ pdfOpen: app, shell, page }) => {
    const note = (await app.canvas.place('note', 0.3, 0.3))!
    await app.canvas.writeNote(note, 'Quarterly kiwi summary')
    const far = (await app.canvas.place('note', 0.8, 0.8))!
    await app.canvas.writeNote(far, 'Unrelated banana list')
    await expectStoreCount(page, 'workspaceItems', 2, (r) => JSON.stringify(r).includes('kiwi') || JSON.stringify(r).includes('banana'))
    await app.canvas.panBy(-300, -200)
    const before = await app.canvas.transform()

    await page.keyboard.press('Control+k')
    await shell.quickSearch.input.fill('kiwi')
    await expect(shell.quickSearch.results).toHaveCount(1)
    await expect(shell.quickSearch.results.first()).toContainText('Quarterly kiwi summary')
    await expect(shell.quickSearch.results.first()).toContainText('Workspace note')
    await shell.quickSearch.results.first().click()
    await expect(shell.quickSearch.input).toBeHidden()
    // Selected notes carry resize handles (WorkspaceCanvas: handles only while selected).
    await expect(selectionHandles(app.canvas.item(note)).first()).toBeVisible()
    await expect(selectionHandles(app.canvas.item(far))).toHaveCount(0)
    await expect.poll(() => app.canvas.transform(), { message: 'the canvas moved to centre the note' }).not.toEqual(before)
    // Centred: the note's middle is at the middle of the canvas surface (within 2 px of rounding).
    const [surface, box] = [(await app.canvas.surface.boundingBox())!, (await app.canvas.item(note).boundingBox())!]
    expect(Math.abs(box.x + box.width / 2 - (surface.x + surface.width / 2))).toBeLessThanOrEqual(2)
    expect(Math.abs(box.y + box.height / 2 - (surface.y + surface.height / 2))).toBeLessThanOrEqual(2)
  })

  test('REG-678 arrow keys move the highlight, Enter takes the highlighted row, and an unknown word says No results found', { tag: '@P3' }, async ({ project: _p, app, shell, page }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await page.keyboard.press('Control+k')
    const row = async (i: number) => (await shell.quickSearch.results.nth(i).textContent())!
    await expect(shell.quickSearch.results).toHaveCount(2)
    await expect(shell.quickSearch.selected).toHaveCount(1)
    const first = await row(0)
    await expect(shell.quickSearch.selected).toHaveText(first)
    await page.keyboard.press('ArrowDown')
    await expect(shell.quickSearch.selected).toHaveText(await row(1))
    await page.keyboard.press('ArrowDown') // already on the last row: stays
    await expect(shell.quickSearch.selected).toHaveText(await row(1))
    await page.keyboard.press('ArrowUp')
    await expect(shell.quickSearch.selected).toHaveText(first)
    await page.keyboard.press('ArrowDown')
    const target = first.includes(FIND_PDF.displayName) ? SECOND_PDF : FIND_PDF
    await page.keyboard.press('Enter')
    await app.viewer.expectDocumentOpen(target.displayName, target.pageCount)

    await page.keyboard.press('Control+k')
    await shell.quickSearch.input.fill('zzz-nothing-like-this')
    await expect(shell.quickSearch.results).toHaveCount(0)
    await expect(shell.quickSearch.empty).toHaveText('No results found')
  })

  test('REG-679 the header search button opens it on the document list, it only knows this project, and Home has no quick search', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.home.createProject('Other Project')
    await app.documents.uploadFiles(SECOND_PDF.payload())
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    await app.header.home.click()
    await page.keyboard.press('Control+k')
    await expect(shell.quickSearch.input).toBeHidden()

    await app.home.createProject('Search Project')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.viewer.backToDocuments.click()
    await app.header.quickSearch.click()
    await expect(shell.quickSearch.input).toBeVisible()
    await expect(shell.quickSearch.results).toHaveCount(1)
    await expect(shell.quickSearch.results.first()).toContainText(FIND_PDF.displayName)
    await shell.quickSearch.input.fill(SECOND_PDF.displayName)
    await expect(shell.quickSearch.empty).toHaveText('No results found')
  })
})
