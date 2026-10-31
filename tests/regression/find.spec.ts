/** Regression: find in document (FindBar.tsx, PdfViewer.tsx text index). */
import { test, expect } from '../../fixtures/test.js'
import { FIND_PDF } from '../../data/files.js'
import { knownDefect } from '../../helpers/defects.js'
import { currentMatchBox } from '../../helpers/documents.js'
import { HINDI_PDF } from '../../data/documents-files.js'
import type { Page } from '@playwright/test'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

/** "canvas" is on pages 1, 2 and 3 once each, so match n of 3 is on page n. */
async function onCanvasMatch(app: CognitiveCanvas, page: Page, n: number) {
  await app.find.expectCount(n, FIND_PDF.canvasMatches)
  await expect.poll(async () => (await currentMatchBox(page)).page, { message: `match ${n} is marked on page ${n}` }).toBe(n)
  await app.viewer.expectPage(n, FIND_PDF.pageCount)
}

test.describe('Find in document', { tag: ['@regression', '@find'] }, () => {
  test('REG-020 find moves the view to a match on a page not yet viewed', { tag: '@P1' }, async ({ pdfOpen: app }) => {
    knownDefect('DEF-001')
    await app.viewer.tool('find').click()
    await app.find.search('ZULUFOUR')
    await app.find.expectCount(1, 1)
    await app.viewer.expectPage(FIND_PDF.uniqueWords.ZULUFOUR, FIND_PDF.pageCount)
  })

  test('REG-021 Enter and Shift+Enter step through the matches and wrap around', { tag: ['@P2', '@sanity'] }, async ({ pdfOpen: app, page }) => {
    await app.viewer.tool('find').click()
    await app.find.search('canvas')
    await onCanvasMatch(app, page, 1)
    await app.find.input.press('Enter')
    await onCanvasMatch(app, page, 2)
    await app.find.input.press('Enter')
    await onCanvasMatch(app, page, 3)
    await app.find.input.press('Enter')
    await onCanvasMatch(app, page, 1)
    await app.find.input.press('Shift+Enter')
    await onCanvasMatch(app, page, 3)
  })

  test('REG-022 a word that is not in the document says "No results"', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    await app.viewer.tool('find').click()
    await app.find.search('XYLOPHONEQUARTZ')
    await expect(app.find.noResults).toHaveText('No results', { timeout: 20_000 })
    await expect(app.find.currentMatch).toHaveCount(0)
  })

  test('REG-023 Ctrl+F opens the find bar and Escape closes it', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.canvasOf(1).click()
    await page.keyboard.press('Control+f')
    await expect(app.find.input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(app.find.input).toBeHidden()
  })

  test('REG-024 find is case-insensitive', { tag: '@P3' }, async ({ pdfOpen: app }) => {
    await app.viewer.tool('find').click()
    await app.find.search('automationalpha')
    await app.find.expectCount(1, 1)
  })
})

test.describe('Find bar controls', { tag: ['@regression', '@find'] }, () => {
  test('REG-250 the Next and Previous match buttons are off without matches, then step through and wrap', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.tool('find').click()
    await expect(app.find.nextMatch).toBeDisabled()
    await expect(app.find.prevMatch).toBeDisabled()
    await app.find.search('canvas')
    await onCanvasMatch(app, page, 1)
    await app.find.nextMatch.click()
    await onCanvasMatch(app, page, 2)
    await app.find.prevMatch.click()
    await onCanvasMatch(app, page, 1)
    await app.find.prevMatch.click()
    await onCanvasMatch(app, page, 3)
    await expect(app.find.currentMatch).toHaveCount(1)
  })

  test('REG-251 the arrow keys step through matches when there are some, and move the caret when there are none', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.tool('find').click()
    await app.find.search('canvas')
    await onCanvasMatch(app, page, 1)
    await app.find.input.press('ArrowRight')
    await onCanvasMatch(app, page, 2)
    await app.find.input.press('ArrowLeft')
    await onCanvasMatch(app, page, 1)
    await app.find.search('XYLOPHONEQUARTZ')
    await expect(app.find.noResults).toHaveText('No results', { timeout: 20_000 })
    await app.find.input.press('ArrowLeft')
    expect(await app.find.input.evaluate((i: HTMLInputElement) => i.selectionStart)).toBe('XYLOPHONEQUARTZ'.length - 1)
  })

  test('REG-252 Clear search empties the box and its marks; the find tool and the close button hide the bar', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    await app.viewer.tool('find').click()
    await app.find.search('canvas')
    await app.find.expectCount(1, 3)
    // One mark per match, on pages 1-3.
    await expect(app.find.marks).toHaveCount(3)
    await app.find.clear.click()
    await expect(app.find.input).toHaveValue('')
    await expect(app.find.input).toBeFocused()
    await expect(app.find.counter).toHaveCount(0)
    await expect(app.find.currentMatch).toHaveCount(0)
    await expect(app.find.marks).toHaveCount(0)
    await expect(app.find.clear).toHaveCount(0)
    await app.find.close.click()
    await expect(app.find.input).toBeHidden()
    await app.viewer.tool('find').click()
    await expect(app.find.input).toBeVisible()
    // Reopened empty: closing threw the old search away.
    await expect(app.find.input).toHaveValue('')
    await app.viewer.tool('find').click()
    await expect(app.find.input).toBeHidden()
  })

  test('REG-253 the current match is drawn over the matched word, on its line', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.tool('find').click()
    await app.find.search('AUTOMATIONALPHA')
    await app.find.expectCount(1, 1)
    const match = await currentMatchBox(page)
    // Page 1, line 2 of the body: baseline 146 pt from the top of a 792 pt page, 12 pt Helvetica (builders/pdf.ts).
    expect(match.page).toBe(1)
    expect(match.y).toBeCloseTo((146 - 0.8 * 12) / 792, 2)
    expect(match.height).toBeCloseTo(12 / 792, 2)
    // Starts after "Alpha marker " and is that one word wide. Helvetica widths: "Alpha marker " is 74.7 pt
    // after the 72 pt margin, "AUTOMATIONALPHA" is 119.4 pt; the page is 612 pt wide.
    expect(Math.abs(match.x - (72 + 74.7) / 612), `match starts at ${match.x}`).toBeLessThanOrEqual(0.01)
    expect(Math.abs(match.width - 119.4 / 612), `match is ${match.width} wide`).toBeLessThanOrEqual(0.015)
  })

  test('REG-254 a phrase is found across the spaces between words', { tag: '@P3' }, async ({ pdfOpen: app }) => {
    await app.viewer.tool('find').click()
    await app.find.search('quick brown fox')
    await app.find.expectCount(1, 1)
    await app.find.search('brown  fox jumps')
    await app.find.expectCount(1, 1)
  })

  test('REG-255 "Why no results?" explains what the search looked at', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    await app.viewer.tool('find').click()
    await app.find.search('XYLOPHONEQUARTZ')
    await expect(app.find.noResults).toHaveText('No results', { timeout: 20_000 })
    const why = page.getByRole('button', { name: 'Why no results?' })
    await expect(why).toHaveAttribute('aria-expanded', 'false')
    await why.click()
    await expect(why).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('status').filter({ hasText: 'text layer on' })).toHaveText(/^4 pages · text layer on 4 · OCR text on 4 · build .+$/)
    await why.click()
    await expect(page.getByRole('status').filter({ hasText: 'text layer on' })).toHaveCount(0)
  })

  test('REG-256 find in Markdown and text documents marks every match; in a text file Enter and Shift+Enter move the current mark', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles({ name: 'automation-find.md', mimeType: 'text/markdown', buffer: Buffer.from('# Finder\n\nAlpha beta FINDWORD gamma.\n\nAnother FINDWORD here, and findword once more.\n') })
    const marks = page.locator('mark.cc2-find-mark')
    await page.locator('.markdown-body').click()
    await page.keyboard.press('Control+f')
    await app.find.search('findword')
    await app.find.expectCount(1, 3)
    await expect(marks).toHaveText(['FINDWORD', 'FINDWORD', 'findword'])
    await app.find.close.click()
    await expect(marks).toHaveCount(0)

    await app.viewer.backToDocuments.click()
    await app.documents.uploadFiles({ name: 'automation-find.txt', mimeType: 'text/plain', buffer: Buffer.from('plain PLAINFIND text\nand PLAINFIND again\n') })
    await page.locator('pre.text-doc-body').click()
    await page.keyboard.press('Control+f')
    await app.find.search('plainfind')
    await app.find.expectCount(1, 2)
    await expect(marks).toHaveText(['PLAINFIND', 'PLAINFIND'])
    await app.find.input.press('Enter')
    await app.find.expectCount(2, 2)
    await expect(marks.nth(1)).toHaveAttribute('data-find-current', '')
    await expect(page.locator('mark.cc2-find-mark[data-find-current]')).toHaveCount(1)
    await app.find.input.press('Shift+Enter')
    await app.find.expectCount(1, 2)
    await expect(marks.nth(0)).toHaveAttribute('data-find-current', '')
    await expect(marks).toHaveCount(2)
  })
})

test.describe('Find in text documents', { tag: ['@regression', '@find'] }, () => {
  test('REG-249 stepping to the next match in a Markdown document keeps every match highlighted and marks the new one', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    knownDefect('DEF-209')
    await app.documents.uploadFiles({ name: 'automation-step.md', mimeType: 'text/markdown', buffer: Buffer.from('# Step\n\nOne STEPWORD, two STEPWORD, three STEPWORD.\n') })
    const marks = page.locator('mark.cc2-find-mark')
    await page.locator('.markdown-body').click()
    await page.keyboard.press('Control+f')
    await app.find.search('stepword')
    await app.find.expectCount(1, 3)
    await expect(marks).toHaveCount(3)
    await app.find.input.press('Enter')
    await app.find.expectCount(2, 3)
    await expect(marks).toHaveCount(3)
    await expect(marks.nth(1)).toHaveAttribute('data-find-current', '')
  })

  test('REG-247 the first match of a search in a Markdown document is marked as the current one', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    knownDefect('DEF-206')
    await app.documents.uploadFiles({ name: 'automation-first.md', mimeType: 'text/markdown', buffer: Buffer.from('# First\n\nOne FIRSTMATCH here and FIRSTMATCH there.\n') })
    await page.locator('.markdown-body').click()
    await page.keyboard.press('Control+f')
    await app.find.search('firstmatch')
    await app.find.expectCount(1, 2)
    await expect(page.locator('mark.cc2-find-mark').first()).toHaveAttribute('data-find-current', '')
  })
})

test.describe('Virtual keyboard for non-Latin documents', { tag: ['@regression', '@find'] }, () => {
  test('REG-258 on a Hindi PDF the find bar offers a Hindi keyboard whose keys type into the search', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(HINDI_PDF.payload())
    await app.viewer.expectDocumentOpen(HINDI_PDF.displayName, 1)
    const banner = page.getByText('Use Hindi virtual keyboard to search in this document')
    await expect(banner).toBeVisible()
    await app.viewer.tool('find').click()
    // The banner gives way to the find bar's own keyboard button.
    await expect(banner).toBeHidden()
    const toggle = page.getByRole('button', { name: 'Virtual keyboard' })
    await toggle.click()
    const keyboard = page.getByRole('button', { name: 'Close keyboard' })
    await expect(keyboard).toBeVisible()
    for (const k of HINDI_PDF.keys) await page.getByRole('button', { name: k, exact: true }).first().click()
    await expect(app.find.input).toHaveValue(HINDI_PDF.word)
    await app.find.expectCount(1, 2)
    await page.getByRole('button', { name: 'Backspace' }).click()
    await expect(app.find.input).toHaveValue(HINDI_PDF.word.slice(0, -1))
    await keyboard.click()
    await expect(keyboard).toBeHidden()
    // A Latin document offers no keyboard.
    await app.viewer.backToDocuments.click()
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(banner).toHaveCount(0)
    await app.viewer.tool('find').click()
    await expect(toggle).toHaveCount(0)
  })

  test('REG-257 the "Open" button of the Hindi keyboard suggestion opens the keyboard', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    knownDefect('DEF-205')
    await app.documents.uploadFiles(HINDI_PDF.payload())
    await app.viewer.expectDocumentOpen(HINDI_PDF.displayName, 1)
    const banner = page.getByText('Use Hindi virtual keyboard to search in this document').locator('..')
    await banner.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Close keyboard' })).toBeVisible()
    await expect(app.find.input).toBeVisible()
  })

  test('REG-259 the keyboard suggestion can be dismissed', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(HINDI_PDF.payload())
    await app.viewer.expectDocumentOpen(HINDI_PDF.displayName, 1)
    const text = page.getByText('Use Hindi virtual keyboard to search in this document')
    await text.locator('..').getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(text).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close keyboard' })).toHaveCount(0)
  })
})
