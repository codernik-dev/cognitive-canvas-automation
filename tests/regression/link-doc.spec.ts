/**
 * Regression: Link Doc (`data-tool="link-doc"`, LinkDocPicker.tsx): link the
 * selected canvas item to a region of ANOTHER document. Picking a document
 * opens it with Link Area armed and the item still selected; the drawn
 * region is stored as an area link on that document.
 */
import { test, expect } from '../../fixtures/documents.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { documentByName } from '../../helpers/documents.js'
import { knownDefect } from '../../helpers/defects.js'

interface AreaLinkRow { id: string; documentId: string; pageNumber: number; workspaceItemId: string; rect: { x: number; y: number; width: number; height: number } }

test.describe('Link Doc', { tag: ['@regression', '@link-doc'] }, () => {
  test('REG-285 Link Doc opens another document with Link Area armed, and the region drawn there is linked to the selected note', { tag: ['@P1', '@sanity'] }, async ({ project: _p, app, page, toolbar, linkDocPicker }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const noteId = (await app.canvas.place('note', 0.55, 0.35))!

    await toolbar.linkDoc.click()
    await expect(linkDocPicker.heading).toBeVisible()
    await expect(linkDocPicker.hint).toBeVisible()
    // Only the other document, with its page count.
    await expect(linkDocPicker.rows).toHaveCount(1)
    await expect(linkDocPicker.row(SECOND_PDF.displayName)).toContainText('1 page')
    await linkDocPicker.row(SECOND_PDF.displayName).click()
    await expect(linkDocPicker.root).toHaveCount(0)

    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    expect(await toolbar.isArmed('link-area')).toBe(true)
    await app.viewer.dragOnPage(1, [0.1, 0.1], [0.5, 0.2])
    await expectStoreCount(page, 'areaLinks', 1)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    const second = await documentByName(page, SECOND_PDF.displayName)
    const first = await documentByName(page, FIND_PDF.displayName)
    expect(link).toMatchObject({ documentId: second.id, pageNumber: 1, workspaceItemId: noteId })
    expect(link.rect.x).toBeCloseTo(0.1, 2)
    expect(link.rect.y).toBeCloseTo(0.1, 2)
    expect(link.rect.width).toBeCloseTo(0.4, 2)
    expect(link.rect.height).toBeCloseTo(0.1, 2)
    // The note still belongs to the first document; the link is what ties it to the second.
    const notes = await readStore<{ id: string; documentId: string }>(page, 'workspaceItems')
    expect(notes).toEqual([expect.objectContaining({ id: noteId, documentId: first.id })])
    await expect(app.viewer.areaLinks).toHaveCount(1)
    // The link used up the selection, so the tools that need one are off again.
    await expect(app.viewer.tool('link-area')).toBeDisabled()
    expect(await toolbar.isArmed('link-area')).toBe(false)
  })

  test('REG-286 with no other document the picker says so, and a click outside closes it', { tag: '@P3' }, async ({ pdfOpen: app, page, toolbar, linkDocPicker }) => {
    await app.canvas.place('note', 0.55, 0.35)
    await toolbar.linkDoc.click()
    await expect(linkDocPicker.empty).toBeVisible()
    await expect(linkDocPicker.rows).toHaveCount(0)
    // Any press outside the picker closes it: here, the empty middle of the document header.
    const header = (await page.locator('[data-tour="header-bar"]').boundingBox())!
    await page.mouse.click(header.x + header.width * 0.6, header.y + header.height / 2)
    await expect(linkDocPicker.root).toHaveCount(0)
    await expectStoreCount(page, 'areaLinks', 0)
  })

  test('REG-287 clicking Link Doc again closes its picker', { tag: '@P3' }, async ({ pdfOpen: app, toolbar, linkDocPicker }) => {
    knownDefect('DEF-210')
    await app.canvas.place('note', 0.55, 0.35)
    await toolbar.linkDoc.click()
    await expect(linkDocPicker.heading).toBeVisible()
    await toolbar.linkDoc.click()
    await expect(linkDocPicker.root).toHaveCount(0)
  })
})
