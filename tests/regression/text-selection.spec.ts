/**
 * Regression: selecting text in a PDF and acting on it. With no tool armed
 * the pdf.js text layer is selectable; dragging the selection onto the canvas
 * creates a note holding the excerpt and its page (PdfTextDragHandler.tsx,
 * WorkspaceDropHandler.tsx).
 *
 * The long-press selection menu (TextSelectionMenu / PdfTextSelectionUI) is
 * switched off in this build (PdfPageView.tsx needLongPressOcr = false), so
 * no user can reach it; see the report.
 */
import { test, expect } from '../../fixtures/documents.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { documentByName } from '../../helpers/documents.js'
import { FIND_PDF } from '../../data/files.js'
import { knownDefect } from '../../helpers/defects.js'

interface NoteRow { id: string; type: string; documentId: string; data: { content: string; sourceExcerpt: string; sourcePageNumber: number } }

test.describe('PDF text selection', { tag: ['@regression', '@text-selection'] }, () => {
  test('REG-290 text selected on a PDF page and dragged onto the canvas becomes a note with the excerpt and its page', { tag: '@P2' }, async ({ pdfOpen: app, page, textTools }) => {
    knownDefect('DEF-207')
    await app.viewer.pageRendered(1)
    const layer = app.viewer.pageEl(1).locator('.pdf-text-layer')
    await expect(layer).toContainText('quick brown fox')
    await textTools.dragSelect(layer, 'quick brown fox')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe('quick brown fox')

    // Drag the selection itself onto the canvas: press inside the selected words, release on empty canvas.
    const word = await layer.evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = walker.nextNode())) {
        const i = n.textContent!.indexOf('brown')
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 5)
        const b = r.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
      return null
    })
    const [tx, ty] = await app.canvas.pointAt(0.5, 0.45)
    await page.mouse.move(word!.x, word!.y)
    await page.mouse.down()
    await page.mouse.move(word!.x + 20, word!.y + 5, { steps: 4 })
    await page.mouse.move(tx, ty, { steps: 12 })
    await page.mouse.up()

    await expectStoreCount(page, 'workspaceItems', 1)
    const [note] = await readStore<NoteRow>(page, 'workspaceItems')
    const doc = await documentByName(page, FIND_PDF.displayName)
    expect(note).toMatchObject({ type: 'note', documentId: doc.id, data: { content: 'quick brown fox', sourceExcerpt: 'quick brown fox', sourcePageNumber: 1 } })
    await expect(app.canvas.item(note.id)).toContainText('quick brown fox')
    // A dropped excerpt is a plain note: no region on the page is linked.
    expect(await readStore(page, 'areaLinks')).toEqual([])
  })
})
