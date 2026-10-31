/**
 * Regression: Markdown and plain-text documents (MarkdownViewer, TextViewer,
 * TextDocToolbar, TextHighlightLayer, TextAreaLinkLayer,
 * TextSelectionNoteAction). These documents have no pages: highlights and
 * links are stored as character ranges of the rendered text
 * (textHighlights / textAreaLinks), so the tests compare stored offsets with
 * where the words sit in the text.
 */
import { test, expect } from '../../fixtures/documents.js'
import { MD_DOC, TXT_DOC } from '../../data/documents-files.js'
import { COLOUR_HEX } from '../../components/DocumentsTools.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'

interface TextHighlightRow { id: string; documentId: string; startOffset: number; endOffset: number; color: string }
interface TextLinkRow { id: string; documentId: string; startOffset: number; endOffset: number; workspaceItemId: string }
interface NoteRow { id: string; type: string; documentId: string; data: { content: string; sourceExcerpt: string; sourcePageNumber: number | null } }

test.describe('Text documents', { tag: ['@regression', '@text-documents'] }, () => {
  test('REG-270 a Markdown file is shown formatted, and HTML hidden in it cannot run', { tag: ['@P1', '@sanity'] }, async ({ project: _p, app, page, textTools }) => {
    await app.documents.uploadFiles(MD_DOC.payload())
    const body = textTools.markdownBody
    await expect(body.getByRole('heading', { level: 1, name: 'Rich Markdown Heading' })).toBeVisible()
    await expect(body.getByText(MD_DOC.paragraph, { exact: true })).toBeVisible()
    await expect(body.getByRole('listitem')).toHaveText(['list item one', 'list item two'])
    // Security: the file's <img onerror> and <script> are stripped before they reach the page.
    await expect(body.locator('script')).toHaveCount(0)
    await expect(body.locator('[onerror]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __ccXss?: number }).__ccXss)).toBeUndefined()
    // A text document has its own toolbar, no PDF tools and no page navigation.
    await expect(textTools.highlight).toBeVisible()
    await expect(page.locator('button[data-tool]')).toHaveCount(0)
    await expect(app.viewer.nav).toHaveCount(0)
  })

  test('REG-271 a plain-text file is shown verbatim in a monospace block, spacing kept', { tag: '@P2' }, async ({ project: _p, app, page, textTools }) => {
    await app.documents.uploadFiles(TXT_DOC.payload())
    await expect(textTools.textBody).toContainText('TXTMARKER')
    // Character for character, runs of spaces and line breaks included.
    expect(await textTools.textBody.evaluate((el) => el.textContent)).toBe(TXT_DOC.text)
    expect(await textTools.textBody.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap')
    expect(await textTools.textBody.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i)
    const docs = await readStore<{ name: string; pageCount: number }>(page, 'documents')
    expect(docs).toEqual([expect.objectContaining({ name: TXT_DOC.name, pageCount: 1 })])
    const rows = await readStore<{ text: string; pageNumber: number }>(page, 'searchText')
    expect(rows).toEqual([expect.objectContaining({ pageNumber: 1, text: TXT_DOC.text })])
  })

  test('REG-272 the highlighter marks a selected passage in the chosen colour, saves its character range, and keeps it after a reload', { tag: ['@P1'] }, async ({ project: _p, app, page, textTools, toolbar }) => {
    await app.documents.uploadFiles(MD_DOC.payload())
    const body = textTools.markdownBody
    await expect(body.getByText(MD_DOC.paragraph)).toBeVisible()
    await textTools.highlight.click()
    for (const name of Object.keys(COLOUR_HEX) as Array<keyof typeof COLOUR_HEX>) await expect(toolbar.colour(name)).toBeVisible()
    await toolbar.colour('Agree').click()
    await textTools.dragSelect(body, 'MDHIGHLIGHT')
    await expect(textTools.marks).toHaveText(['MDHIGHLIGHT'])
    await expectStoreCount(page, 'textHighlights', 1)
    const [h] = await readStore<TextHighlightRow>(page, 'textHighlights')
    const start = await textTools.offsetOf(body, 'MDHIGHLIGHT')
    expect(h).toMatchObject({ startOffset: start, endOffset: start + 'MDHIGHLIGHT'.length, color: COLOUR_HEX.Agree.text })
    await expect(textTools.marks).toHaveCSS('background-color', 'rgba(34, 197, 94, 0.4)')

    await app.reload()
    await expect(textTools.marks).toHaveText(['MDHIGHLIGHT'])
    await expect(textTools.marks).toHaveAttribute('data-highlight-id', h.id)
  })

  test('REG-273 a new colour over a highlight replaces it; the eraser splits or removes highlights; Undo and Redo buttons step back and forth', { tag: '@P2' }, async ({ project: _p, app, page, textTools, toolbar }) => {
    await app.documents.uploadFiles(TXT_DOC.payload())
    const body = textTools.textBody
    await expect(textTools.undo).toBeDisabled()
    await textTools.highlight.click()
    await textTools.dragSelect(body, 'First line with TXTMARKER inside.')
    await expectStoreCount(page, 'textHighlights', 1)
    await toolbar.colour('Question').click()
    await textTools.dragSelect(body, 'line with TXTMARKER')
    await expect.poll(async () => (await readStore<TextHighlightRow>(page, 'textHighlights')).map((h) => [h.color, h.endOffset - h.startOffset])).toEqual([[COLOUR_HEX.Question.text, 'line with TXTMARKER'.length]])

    // Eraser through the middle: two pieces with new ids either side of the erased word.
    const [whole] = await readStore<TextHighlightRow>(page, 'textHighlights')
    await textTools.eraser.click()
    await textTools.dragSelect(body, 'with')
    await expect.poll(async () => (await readStore<TextHighlightRow>(page, 'textHighlights')).length).toBe(2)
    const pieces = (await readStore<TextHighlightRow>(page, 'textHighlights')).sort((a, b) => a.startOffset - b.startOffset)
    const withAt = await textTools.offsetOf(body, 'with')
    expect(pieces.map((p) => [p.startOffset, p.endOffset])).toEqual([[whole.startOffset, withAt], [withAt + 4, whole.endOffset]])
    expect(pieces.every((p) => p.id !== whole.id)).toBe(true)
    await expect(textTools.marks).toHaveText(['line ', ' TXTMARKER'])

    // The pill's undo/redo name what they will do and take the erase back and forth.
    await expect(textTools.undo).toHaveAttribute('title', 'Undo erase (Ctrl+Z)')
    await textTools.undo.click()
    await app.toasts.expectShown('Undid erase')
    await expect.poll(async () => (await readStore<TextHighlightRow>(page, 'textHighlights')).map((h) => h.id)).toEqual([whole.id])
    await expect(textTools.redo).toHaveAttribute('title', 'Redo erase (Ctrl+Y)')
    await textTools.redo.click()
    await app.toasts.expectShown('Redid erase')
    await expect.poll(async () => (await readStore<TextHighlightRow>(page, 'textHighlights')).length).toBe(2)

    // Erasing across everything leaves nothing.
    await textTools.dragSelect(body, 'First line with TXTMARKER inside.')
    await expectStoreCount(page, 'textHighlights', 0)
    await expect(textTools.marks).toHaveCount(0)
  })

  test('REG-274 Link area needs a selected note, then ties a dragged passage to it; the marker can jump to the note or remove the link', { tag: ['@P1'] }, async ({ project: _p, app, page, textTools }) => {
    await app.documents.uploadFiles(MD_DOC.payload())
    const body = textTools.markdownBody
    await expect(body.getByText(MD_DOC.second)).toBeVisible()
    await expect(textTools.linkArea).toBeDisabled()
    await expect(textTools.linkArea).toHaveAttribute('title', 'Select a note in the workspace first, then link a passage to it')

    const noteId = (await app.canvas.place('note', 0.6, 0.5))!
    await expect(textTools.linkArea).toBeEnabled()
    await expect(textTools.linkArea).toHaveAttribute('title', 'Link a passage to the selected note (drag over the text)')
    await textTools.linkArea.click()
    await textTools.dragSelect(body, 'MDLINKWORD')
    await expectStoreCount(page, 'textAreaLinks', 1)
    const [link] = await readStore<TextLinkRow>(page, 'textAreaLinks')
    const at = await textTools.offsetOf(body, 'MDLINKWORD')
    expect(link.workspaceItemId).toBe(noteId)
    expect(link.startOffset).toBeLessThanOrEqual(at + 1)
    expect(link.endOffset).toBeGreaterThanOrEqual(at + 'MDLINKWORD'.length - 1)
    expect(link.endOffset - link.startOffset).toBeLessThanOrEqual('MDLINKWORD'.length + 2)
    // The link took the selection and the tool with it.
    await expect(textTools.linkArea).toBeDisabled()
    await expect(textTools.linkRects).toHaveCount(1)

    // "Go to linked note" pans the canvas to the note.
    await app.canvas.panBy(-400, -300)
    const before = await app.canvas.transform()
    await textTools.linkRects.first().getByTitle('Go to linked note').click()
    await expect.poll(async () => JSON.stringify(await app.canvas.transform())).not.toBe(JSON.stringify(before))
    await expect(app.canvas.item(noteId)).toBeInViewport()

    await textTools.linkRects.first().getByTitle('Remove link').click()
    await expectStoreCount(page, 'textAreaLinks', 0)
    await expect(textTools.linkRects).toHaveCount(0)
    await expectStoreCount(page, 'workspaceItems', 1)
  })

  test('REG-275 selecting text with no tool armed offers "Create note", which makes a linked note from the passage', { tag: '@P2' }, async ({ project: _p, app, page, textTools }) => {
    await app.documents.uploadFiles(TXT_DOC.payload())
    const body = textTools.textBody
    await textTools.dragSelect(body, 'TXTMARKER')
    await expect(textTools.createNote).toBeVisible()
    await textTools.createNote.click()
    await expect(textTools.createNote).toHaveCount(0)
    await expectStoreCount(page, 'workspaceItems', 1)
    const [note] = await readStore<NoteRow>(page, 'workspaceItems')
    expect(note).toMatchObject({ type: 'note', data: { content: 'TXTMARKER', sourceExcerpt: 'TXTMARKER', sourcePageNumber: null } })
    await expectStoreCount(page, 'textAreaLinks', 1)
    const [link] = await readStore<TextLinkRow>(page, 'textAreaLinks')
    const at = await textTools.offsetOf(body, 'TXTMARKER')
    expect(link).toMatchObject({ workspaceItemId: note.id, startOffset: at, endOffset: at + 9 })
    await expect(app.canvas.item(note.id)).toContainText('TXTMARKER')
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

    // With the highlighter armed the selection belongs to it: no "Create note".
    await textTools.highlight.click()
    await textTools.dragSelect(body, 'Second')
    await expect(textTools.createNote).toHaveCount(0)
    await expectStoreCount(page, 'workspaceItems', 1)
  })
})
