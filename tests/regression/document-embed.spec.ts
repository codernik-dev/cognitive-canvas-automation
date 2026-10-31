/**
 * Regression: the Document tool's picker and the document card
 * (DocumentPickerModal.tsx, items/DocumentItem.tsx). REG-079 (media.spec.ts)
 * covers opening a document from its card; this covers the picker's lists,
 * its upload tab with its refusals, and the card's contents.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { FIND_PDF, SECOND_PDF, BAD_FILES } from '../../data/files.js'

test.describe('Document embeds', { tag: ['@regression', '@canvas', '@media'] }, () => {
  test('REG-399 the picker offers only the other documents; Upload Local refuses non-PDFs with a reason and embeds a new PDF', { tag: '@P2' }, async ({ pdfOpen: app, ws, dialogs, page, docId }) => {
    await ws.place('document', 0.6, 0.4)
    const picker = dialogs.documentPicker
    await expect(picker).toBeVisible()
    // The open document is never offered: with only one document there is nothing to pick.
    await expect(picker).toContainText('No other documents in this project')

    await picker.getByRole('button', { name: 'Upload Local' }).click()
    const input = picker.locator('input[type=file]')
    await expect(input).toHaveAttribute('accept', '.pdf')
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain words') })
    await expect(picker.getByRole('alert')).toHaveText('Only PDF files can be embedded - "notes.txt" is a .txt file.')
    await input.setInputFiles(BAD_FILES.emptyPdf())
    await expect(picker.getByRole('alert')).toHaveText('"automation-empty.pdf" is empty (0 bytes), so there is nothing to open. Pick a PDF that has content.')
    await expect(picker.getByRole('button', { name: /Pick another PDF file/ })).toBeVisible()
    await expectStoreCount(page, 'documents', 1)

    await input.setInputFiles(SECOND_PDF.payload())
    await expect(picker).toBeHidden({ timeout: 30_000 })
    await expectStoreCount(page, 'documents', 2)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'document')
    const second = (await readStore<{ id: string; name: string }>(page, 'documents')).find((d) => d.name === SECOND_PDF.displayName)!
    const [card] = await readStore<ItemRow<{ linkedDocumentId: string }>>(page, 'workspaceItems')
    expect(card).toMatchObject({ documentId: docId, width: 240, height: 80 })
    expect(card.data.linkedDocumentId).toBe(second.id)
    await expect(ws.item(card.id)).toContainText(SECOND_PDF.displayName)
    await expect(ws.item(card.id)).toContainText('1 page — double-click or › to open')

    // Now the picker lists the second document (with its page count), still not the open one.
    await ws.place('document', 0.3, 0.7)
    await expect(picker.getByRole('button')).toContainText([SECOND_PDF.displayName])
    await expect(picker).toContainText('1 page')
    await expect(picker.getByRole('button', { name: new RegExp(FIND_PDF.displayName) })).toHaveCount(0)
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expectStoreCount(page, 'workspaceItems', 1)

    // Double-clicking the card opens its document.
    await ws.item(card.id).dblclick()
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
  })
})
