/**
 * Regression: documents inside a project: what uploads, what is refused and
 * how, and what deleting a document takes with it.
 */
import { test, expect } from '../../fixtures/documents.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { BAD_FILES, BINARY, FIND_PDF, SECOND_PDF, TEXT_FILES } from '../../data/files.js'
import { namedPdf, OVERSIZED_TXT } from '../../data/documents-files.js'

test.describe('Unsupported and broken files', { tag: ['@regression', '@documents', '@files'] }, () => {
  test('REG-032 a corrupt PDF is refused with a readable explanation', { tag: '@P1' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(BAD_FILES.corruptPdf())
    await expect(page.getByText(/"automation-corrupt(\.pdf)?" is not a readable PDF/)).toBeVisible({ timeout: 20_000 })
    await expectStoreCount(page, 'documents', 0)
  })

  // The content check runs before the importer, so the dedicated "is empty (0 bytes)"
  // sentence is never reached; the content-mismatch refusal is what users see (OBS-002).
  test('REG-033 an empty (0-byte) PDF is refused by name', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(BAD_FILES.emptyPdf())
    await expect(page.getByText('“automation-empty.pdf” doesn’t look like a PDF — its contents don’t match its name.')).toBeVisible()
    await expectStoreCount(page, 'documents', 0)
  })

  test('REG-034 a password-protected PDF is refused as password-protected', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(BINARY.encryptedPdf)
    await expect(page.getByText(/is password-protected\. Remove the password and try again\./)).toBeVisible({ timeout: 20_000 })
    await expectStoreCount(page, 'documents', 0)
  })

  test('REG-035 a text file named .pdf is caught by its contents', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(BAD_FILES.textAsPdf())
    await expect(page.getByText(/doesn.t look like a PDF/)).toBeVisible({ timeout: 20_000 })
    await expectStoreCount(page, 'documents', 0)
  })

  test('REG-036 an unsupported file type is refused with the supported list', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(BAD_FILES.exe())
    await expect(page.getByText('Supported file types: PDF, Markdown (.md), text (.txt)')).toBeVisible()
    await expectStoreCount(page, 'documents', 0)
  })
})

test.describe('Supported uploads', { tag: ['@regression', '@documents', '@files'] }, () => {
  test('REG-037 two PDFs uploaded together stay on the list', { tag: ['@P2', '@sanity'] }, async ({ project: _p, app, page }) => {
    // The toast fires as the second card appears: watch for it during the upload.
    await Promise.all([
      app.toasts.expectShown('2 documents uploaded', 45_000),
      app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()]),
    ])
    await expect(app.documents.cards).toHaveCount(2)
    await expect(app.documents.card(FIND_PDF.displayName)).toContainText(`${FIND_PDF.pageCount} pages`)
    await expectStoreCount(page, 'documents', 2)
  })

  test('REG-038 a Markdown file opens as a text document', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(TEXT_FILES.markdown())
    await expect(page.getByText('MARKDOWNMARKER', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    const docs = await readStore<{ name: string; pageCount: number }>(page, 'documents')
    expect(docs).toEqual([expect.objectContaining({ name: 'automation-notes.md', pageCount: 1 })])
  })

  test('REG-039 the extracted page text is indexed for search', { tag: '@P2' }, async ({ pdfOpen: _app, page }) => {
    await expect
      .poll(async () => (await readStore<{ pageNumber: number; text: string }>(page, 'searchText')).map((r) => r.pageNumber).sort())
      .toEqual([1, 2, 3, 4])
    const rows = await readStore<{ pageNumber: number; text: string }>(page, 'searchText')
    expect(rows.find((r) => r.pageNumber === 4)?.text).toContain('ZULUFOUR')
  })
})

test.describe('Deleting documents', { tag: ['@regression', '@documents'] }, () => {
  test('REG-040 deleting a document removes its notes, highlights and text index', { tag: '@P1' }, async ({ pdfOpen: app, page }) => {
    await app.canvas.place('note', 0.5, 0.4)
    await expectStoreCount(page, 'workspaceItems', 1)
    await app.viewer.backToDocuments.click()
    await app.documents.deleteDocument(FIND_PDF.displayName)
    await app.toasts.expectShown('Document deleted')
    await expect(app.documents.emptyState).toBeVisible()
    for (const store of ['documents', 'workspaceItems', 'searchText', 'highlights', 'areaLinks'] as const) await expectStoreCount(page, store, 0)
  })

  test('REG-041 switching documents keeps each document\'s own canvas notes', { tag: '@P1' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await expect(app.documents.cards).toHaveCount(2)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const first = await app.canvas.place('note', 0.5, 0.4)
    await app.viewer.backToDocuments.click()
    await app.documents.openDocument(SECOND_PDF.displayName)
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    await expect(app.canvas.item(first!)).toHaveCount(0)
    await app.canvas.place('note', 0.5, 0.4)
    await expectStoreCount(page, 'workspaceItems', 2)
    const items = await readStore<{ documentId: string }>(page, 'workspaceItems')
    expect(new Set(items.map((i) => i.documentId)).size, 'each note belongs to its own document').toBe(2)
  })
})

test.describe('Document list order', { tag: ['@regression', '@documents'] }, () => {
  test('REG-230 documents are listed newest first until the list is arranged by hand', { tag: '@P3' }, async ({ project: _p, docList, page }) => {
    await docList.uploadMany([namedPdf('automation-older', 'OLDER'), namedPdf('automation-newer', 'NEWER')])
    await docList.expectNames(['automation-newer', 'automation-older'])
    const [project] = await readStore<{ documentOrder?: string[] }>(page, 'projects')
    expect(project.documentOrder ?? []).toEqual([])
  })

  test('REG-095 dragging a document card reorders the list and the order is saved', { tag: '@P3' }, async ({ project: _p, app, docList, page }) => {
    await docList.uploadMany([namedPdf('automation-older', 'OLDER'), namedPdf('automation-newer', 'NEWER')])
    await docList.expectNames(['automation-newer', 'automation-older'])
    await docList.dragCard('automation-older', 'automation-newer')
    await docList.expectNames(['automation-older', 'automation-newer'])
    // A drag is not a click: no document opened.
    await expect(docList.upload).toBeVisible()
    const docs = await readStore<{ id: string; name: string }>(page, 'documents')
    const id = (n: string) => docs.find((d) => d.name === n)!.id
    await expect
      .poll(async () => (await readStore<{ documentOrder?: string[] }>(page, 'projects'))[0].documentOrder)
      .toEqual([id('automation-older'), id('automation-newer')])
    await app.reload()
    await docList.expectNames(['automation-older', 'automation-newer'])
  })
})

test.describe('Selecting and deleting documents', { tag: ['@regression', '@documents'] }, () => {
  test('REG-231 Select mode picks documents, Select all / Deselect all, and deletes the chosen ones in one go', { tag: '@P2' }, async ({ project: _p, app, docList, page }) => {
    await docList.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload(), TEXT_FILES.plain()])
    await docList.selectMode.click()
    await expect(docList.selectMode).toHaveText('Done')
    await expect(docList.selectionCount).toHaveText('0 of 3 selected')
    await expect(docList.bulkDelete).toBeDisabled()
    await expect(docList.card(FIND_PDF.displayName).getByRole('button', { name: 'Delete document' })).toHaveCount(0)

    await docList.card(FIND_PDF.displayName).click()
    await expect(docList.selectionCount).toHaveText('1 of 3 selected')
    await expect(docList.card(FIND_PDF.displayName)).toHaveAttribute('aria-selected', 'true')
    // In Select mode a click selects; it never opens the document.
    await expect(docList.upload).toBeVisible()
    await docList.selectAll.click()
    await expect(docList.selectionCount).toHaveText('3 of 3 selected')
    await docList.deselectAll.click()
    await expect(docList.selectionCount).toHaveText('0 of 3 selected')
    await docList.card(FIND_PDF.displayName).click()
    await docList.card(SECOND_PDF.displayName).click()
    await expect(docList.bulkDelete).toHaveText('Delete 2')

    await docList.bulkDelete.click()
    const dialog = page.getByRole('dialog', { name: 'Delete 2 documents?' })
    await expect(dialog).toContainText('Delete 2 documents?')
    await expect(dialog).toContainText('This can\'t be undone.')
    await dialog.getByRole('button', { name: 'Delete 2', exact: true }).click()
    await expect(dialog).toBeHidden()
    await app.toasts.expectShown('2 documents deleted')
    await expect(docList.cards).toHaveCount(1)
    await expect(docList.card('automation-plain.txt')).toBeVisible()
    const docs = await readStore<{ name: string }>(page, 'documents')
    expect(docs.map((d) => d.name)).toEqual(['automation-plain.txt'])
    // Select mode ended with the delete; with one document left the Select button is gone.
    await expect(docList.selectMode).toHaveCount(0)
  })

  test('REG-237 Escape leaves Select mode without deleting anything', { tag: '@P3' }, async ({ project: _p, docList, page }) => {
    await docList.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await docList.selectMode.click()
    await docList.card(FIND_PDF.displayName).click()
    await expect(docList.selectionCount).toHaveText('1 of 2 selected')
    await page.keyboard.press('Escape')
    await expect(docList.selectionCount).toHaveCount(0)
    await expect(docList.selectMode).toHaveText('Select')
    await expect(docList.card(FIND_PDF.displayName)).not.toHaveAttribute('aria-selected', /.*/)
    await expectStoreCount(page, 'documents', 2)
  })

  test('REG-232 the delete question lists what goes with the document; Cancel and Escape keep everything', { tag: '@P2' }, async ({ pdfOpen: app, docList, page, toolbar }) => {
    await app.viewer.tool('highlight').click()
    await expect(toolbar.drawLayer(1)).toBeAttached()
    await app.viewer.dragOnPage(1, [0.12, 0.17], [0.7, 0.17])
    await expectStoreCount(page, 'highlights', 1)
    await app.viewer.tool('highlight').click()
    await app.canvas.place('note', 0.5, 0.4)
    await expectStoreCount(page, 'workspaceItems', 1)
    await app.viewer.backToDocuments.click()

    await docList.card(FIND_PDF.displayName).getByRole('button', { name: 'Delete document' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete document?' })
    await expect(dialog).toContainText(`Delete ${FIND_PDF.displayName}?`)
    await expect(dialog).toContainText('This will also remove 1 highlight, 1 workspace item tied to this document.')
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()

    await docList.card(FIND_PDF.displayName).getByRole('button', { name: 'Delete document' }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expectStoreCount(page, 'documents', 1)
    await expectStoreCount(page, 'highlights', 1)
    await expectStoreCount(page, 'workspaceItems', 1)
  })
})

test.describe('Upload details', { tag: ['@regression', '@documents', '@files'] }, () => {
  test('REG-233 each card says what the document is and how big; a single upload is announced by name and opened', { tag: '@P3' }, async ({ project: _p, app, docList, page }) => {
    await docList.uploadFiles(TEXT_FILES.markdown())
    await app.toasts.expectShown('"automation-notes.md" uploaded')
    await expect(app.viewer.documentTitle('automation-notes.md')).toBeVisible()
    await app.viewer.backToDocuments.click()
    await docList.uploadMany([FIND_PDF.payload(), TEXT_FILES.plain()])
    const docs = await readStore<{ name: string; fileSize: number }>(page, 'documents')
    const size = (n: string) => docs.find((d) => d.name === n)!.fileSize
    await expect(docList.card(FIND_PDF.displayName)).toContainText(`${FIND_PDF.pageCount} pages · ${(size(FIND_PDF.displayName) / 1024).toFixed(1)} KB`)
    await expect(docList.card('automation-notes.md')).toContainText(`Markdown · ${size('automation-notes.md')} B`)
    await expect(docList.card('automation-plain.txt')).toContainText(`Text · ${size('automation-plain.txt')} B`)
  })

  test('REG-234 a text file over 10 MB is refused with its size and the limit', { tag: '@P2' }, async ({ project: _p, app, docList, page }) => {
    await docList.uploadFiles(OVERSIZED_TXT())
    await app.toasts.expectShown('"automation-big.txt" is too large (10.0 MB). Maximum size is 10 MB.')
    await expectStoreCount(page, 'documents', 0)
    await expect(docList.emptyState).toBeVisible()
  })

  test('REG-235 uploading a supported file together with an unsupported one says the unsupported one was skipped', { tag: '@P3' }, async ({ project: _p, app, docList, page }) => {
    knownDefect('DEF-204')
    await docList.uploadFiles([FIND_PDF.payload(), BAD_FILES.exe()])
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expectStoreCount(page, 'documents', 1)
    // Any message that names the refused file or the supported types will do.
    await expect(page.getByText(/automation-program\.exe|Supported file types: PDF, Markdown \(\.md\), text \(\.txt\)/)).toBeVisible()
  })

  test('REG-238 an upload is refused when the device is almost out of storage', { tag: '@P2' }, async ({ project: _p, app, docList, page }) => {
    // Test double: the browser reports the device 99 % full (navigator.storage.estimate).
    await page.evaluate(() => {
      Object.defineProperty(navigator.storage, 'estimate', { value: async () => ({ usage: 99 * 1024 ** 3, quota: 100 * 1024 ** 3 }) })
    })
    await docList.uploadFiles(FIND_PDF.payload())
    await app.toasts.expectShown('Your device storage is almost full.')
    await expectStoreCount(page, 'documents', 0)
    await expect(docList.emptyState).toBeVisible()
  })

  test('REG-236 files dropped on the document list are uploaded like the Upload button', { tag: '@P2' }, async ({ project: _p, app, docList, page }) => {
    await Promise.all([
      app.toasts.expectShown('2 documents uploaded', 45_000),
      docList.dropFiles([SECOND_PDF.payload(), TEXT_FILES.plain()]),
    ])
    await expect(docList.cards).toHaveCount(2)
    const docs = await readStore<{ name: string }>(page, 'documents')
    expect(docs.map((d) => d.name).sort()).toEqual(['automation-plain.txt', SECOND_PDF.displayName])
  })
})
