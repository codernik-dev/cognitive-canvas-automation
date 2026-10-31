/**
 * Regression: the note card and its rich-text editor (items/NoteItem.tsx,
 * items/NoteEditorModal.tsx). Formatting is checked three ways: the HTML the
 * editor saved to IndexedDB, what the card renders, and (where it matters)
 * what comes back after a reload.
 *
 * The toolbar buttons are named by their visible glyph ("B", "H1"), so they
 * are found by their title, which is the label the app gives them.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF, IMAGES } from '../../data/files.js'
import type { Locator, Page } from '@playwright/test'

type NoteData = { content: string; color: string; private?: boolean }
/** The note's stored row, once the debounced save has written it. */
async function note(page: Page, id: string) {
  let row: ItemRow<NoteData> | undefined
  await expect.poll(async () => !!(row = (await readStore<ItemRow<NoteData>>(page, 'workspaceItems')).find((r) => r.id === id)), { message: `note ${id} saved` }).toBe(true)
  return row!
}

function editorParts(dialog: Locator) {
  return {
    text: dialog.locator('[contenteditable="true"]'),
    tool: (title: string) => dialog.getByTitle(title, { exact: true }),
    done: dialog.getByRole('button', { name: 'Done', exact: true }),
    close: dialog.getByRole('button', { name: 'Close', exact: true }),
    footer: dialog.locator('div.border-t').last(),
  }
}

/** Select the current line (caret at its end) with Shift+Home. */
async function selectLine(page: Page) {
  await page.keyboard.press('Shift+Home')
}

test.describe('Note editor', { tag: ['@regression', '@canvas', '@notes'] }, () => {
  // DEF-311: the toolbar's selection listener intermittently throws React error 185
  // ("Maximum update depth exceeded") while text is selected and formatted. It is an
  // app defect, not reproducible on demand, so it cannot be a knownDefect; tolerated
  // here (and only here) so the formatting outcomes below keep being asserted.
  test.use({ allowedPageErrors: [/Minified React error #185/] })

  test('REG-336 bold, italic, underline and strikethrough are saved as formatting and shown on the card after a reload', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    const ed = editorParts(dialog)
    const lines: Array<[string, string]> = [['Heavy', 'Bold'], ['Slanted', 'Italic'], ['Under', 'Underline'], ['Struck', 'Strikethrough']]
    for (const [i, [word]] of lines.entries()) {
      if (i > 0) await page.keyboard.press('Enter')
      await page.keyboard.type(word)
    }
    // Format each paragraph after typing, so one line's style cannot carry into the next.
    for (const [word, title] of lines) {
      await ed.text.locator('p', { hasText: word }).click({ clickCount: 3 })
      await ed.tool(title).click()
    }
    await ed.done.click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await note(page, id)).data.content).toMatch(/<b>Heavy<\/b>[\s\S]*<i>Slanted<\/i>[\s\S]*<u>Under<\/u>[\s\S]*<strike>Struck<\/strike>/)

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const card = ws.item(id).locator('.note-content-preview')
    await expect(card.locator('b')).toHaveText('Heavy')
    await expect(card.locator('i')).toHaveText('Slanted')
    await expect(card.locator('u')).toHaveText('Under')
    await expect(card.locator('strike')).toHaveText('Struck')
  })

  test('REG-337 headings 1-3 and a bullet list are saved and rendered on the card', { tag: '@P2' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const ed = editorParts(await ws.openNoteEditor(id))
    for (const [i, [word, title]] of ([['Title', 'Heading 1'], ['Sub', 'Heading 2'], ['Minor', 'Heading 3'], ['Item one', 'Bullet list']] as const).entries()) {
      if (i > 0) await page.keyboard.press('Enter')
      await page.keyboard.type(word)
      await ed.tool(title).click()
    }
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Item two')
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toMatch(/<h1>Title<\/h1>[\s\S]*<h2>Sub<\/h2>[\s\S]*<h3>Minor<\/h3>[\s\S]*<ul>[\s\S]*Item one[\s\S]*Item two[\s\S]*<\/ul>/)
    const card = ws.item(id).locator('.note-content-preview')
    await expect(card.locator('h1')).toHaveText('Title')
    await expect(card.locator('h3')).toHaveText('Minor')
    await expect(card.locator('ul > li')).toHaveText(['Item one', 'Item two'])
  })

  test('REG-338 Paragraph turns a heading back into text, and Backspace at the start of a numbered item leaves the list', { tag: '@P3' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const ed = editorParts(await ws.openNoteEditor(id))
    await page.keyboard.type('Was a heading')
    await ed.tool('Heading 1').click()
    await expect(ed.text.locator('h1')).toHaveText('Was a heading')
    await ed.tool('Paragraph').click()
    await expect(ed.text.locator('h1')).toHaveCount(0)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Step')
    await ed.tool('Numbered list').click()
    await expect(ed.text.locator('ol > li')).toHaveText('Step')
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    await expect(ed.text.locator('ol')).toHaveCount(0)
    await expect(ed.text).toContainText('Step')
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toMatch(/Was a heading[\s\S]*Step/)
    const saved = (await note(page, id)).data.content
    expect(saved).not.toMatch(/<h1|<ol/)
  })

  test('REG-339 the alignment buttons set the paragraph alignment and show which one is active', { tag: '@P3' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const ed = editorParts(await ws.openNoteEditor(id))
    await page.keyboard.type('Centred line')
    await ed.tool('Align center').click()
    await expect(ed.tool('Align center')).toHaveClass(/bg-primary-500\/15/)
    await expect(ed.tool('Align left')).not.toHaveClass(/bg-primary-500\/15/)
    await ed.tool('Align right').click()
    await expect(ed.tool('Align right')).toHaveClass(/bg-primary-500\/15/)
    await expect(ed.tool('Align center')).not.toHaveClass(/bg-primary-500\/15/)
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toMatch(/text-align:\s*right/)
    await expect(ws.item(id).locator('.note-content-preview').getByText('Centred line')).toHaveCSS('text-align', 'right')
  })

  test('REG-340 Text color recolours the selected words (saved), and Default takes the colour off again', { tag: '@P2' }, async ({ ws, page }) => {
    knownDefect('DEF-306')
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    const ed = editorParts(dialog)
    await page.keyboard.type('Red words')
    await selectLine(page)
    await ed.tool('Text color').click()
    for (const c of ['Default', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink']) await expect(ed.tool(c)).toBeVisible()
    await ed.tool('Red').click()
    await expect(ed.text.locator('span', { hasText: 'Red words' })).toHaveCSS('color', 'rgb(239, 68, 68)')
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toMatch(/color:\s*(#ef4444|rgb\(239, 68, 68\))[^>]*>Red words/)
    await expect(ws.item(id).locator('.note-content-preview span', { hasText: 'Red words' })).toHaveCSS('color', 'rgb(239, 68, 68)')

    await ws.openNoteEditor(id)
    await ed.text.click()
    await page.keyboard.press('Control+a')
    await ed.tool('Text color').click()
    await ed.tool('Default').click()
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).not.toMatch(/color:/)
    expect((await note(page, id)).data.content).toContain('Red words')
  })

  test('REG-341 the note colour is saved as soon as it is picked and repaints the card', { tag: '@P2' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    await dialog.getByTitle('Note color', { exact: true }).click()
    // The current colour (yellow) is not offered again.
    for (const c of ['red', 'green', 'blue', 'purple', 'orange']) await expect(dialog.getByTitle(c, { exact: true })).toBeVisible()
    await expect(dialog.getByTitle('yellow', { exact: true })).toHaveCount(0)
    await dialog.getByTitle('green', { exact: true }).click()
    await expect.poll(async () => (await note(page, id)).data.color).toBe('green')
    await expect(dialog).toBeVisible() // picked without closing the editor
    await editorParts(dialog).close.click()
    await expect(dialog).toBeHidden()
    // The card's top bar takes the colour's accent (#22c55e).
    await expect(ws.item(id).locator('div.h-1').first()).toHaveCSS('background-image', /rgb\(34, 197, 94\)/)
  })

  test('REG-342 Insert link adds a clickable https link; with words selected it links those words; Cancel adds nothing', { tag: '@P2' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    const ed = editorParts(dialog)
    const url = dialog.getByPlaceholder('Enter URL — e.g. google.com')
    await page.keyboard.type('Read this ')
    await ed.tool('Insert link').click()
    await url.fill('example.org/page')
    await dialog.getByRole('button', { name: 'Add link', exact: true }).click()
    await expect(ed.text.locator('a')).toHaveAttribute('href', 'https://example.org/page')
    await expect(ed.text.locator('a')).toHaveText('example.org/page')

    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Docs')
    await selectLine(page)
    await ed.tool('Insert link').click()
    await url.fill('https://example.com/docs')
    await url.press('Enter')
    await expect(ed.text.locator('a', { hasText: 'Docs' })).toHaveAttribute('href', 'https://example.com/docs')

    await ed.tool('Insert link').click()
    await url.fill('https://never.example')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(url).toHaveCount(0)
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toContain('href="https://example.com/docs"')
    const saved = (await note(page, id)).data.content
    expect(saved).toContain('href="https://example.org/page"')
    expect(saved).not.toContain('never.example')
    await expect(ws.item(id).locator('.note-content-preview a')).toHaveCount(2)
  })

  test('REG-343 clicking a link in the editor shows its host with Open and Remove; Remove keeps the words, Open opens a new tab', { tag: '@P3' }, async ({ ws, page, context, blockedRequests }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    const ed = editorParts(dialog)
    for (const word of ['First', 'Second']) {
      if (word === 'Second') { await page.keyboard.press('End'); await page.keyboard.press('Enter') }
      await page.keyboard.type(word)
      await selectLine(page)
      await ed.tool('Insert link').click()
      await dialog.getByPlaceholder('Enter URL — e.g. google.com').fill(`https://www.example.com/${word.toLowerCase()}`)
      await dialog.getByRole('button', { name: 'Add link', exact: true }).click()
    }
    await ed.text.locator('a', { hasText: 'First' }).click()
    const tip = dialog.locator('a[target="_blank"]')
    await expect(tip).toHaveText('example.com')
    await expect(tip).toHaveAttribute('title', 'https://www.example.com/first')
    const popup = context.waitForEvent('page')
    await dialog.getByRole('button', { name: 'Open', exact: true }).click()
    await popup
    // A new tab asked for the link's address; the network guard kept it on the machine.
    await expect.poll(() => blockedRequests.some((r) => r.endsWith('https://www.example.com/first'))).toBe(true)

    await ed.text.locator('a', { hasText: 'Second' }).click()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(ed.text.locator('a', { hasText: 'Second' })).toHaveCount(0)
    await expect(ed.text).toContainText('Second')
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toContain('href="https://www.example.com/first"')
    expect((await note(page, id)).data.content).not.toContain('/second')
  })

  test('REG-344 pasting a web address offers "Make this a link?": Link it links it, Keep as text leaves it plain', { tag: '@P3' }, async ({ ws, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    const ed = editorParts(dialog)
    const paste = async (text: string) => {
      await page.evaluate((t) => navigator.clipboard.writeText(t), text)
      await page.keyboard.press('Control+v')
    }
    await paste('https://example.com/linked')
    await expect(dialog.getByText('Make this a link?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Link it', exact: true }).click()
    await expect(ed.text.locator('a')).toHaveAttribute('href', 'https://example.com/linked')

    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await paste('example.net')
    await expect(dialog.getByText('Make this a link?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Keep as text', exact: true }).click()
    await expect(dialog.getByText('Make this a link?')).toBeHidden()
    await expect(ed.text.locator('a')).toHaveCount(1)
    await expect(ed.text).toContainText('example.net')
    await ed.done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toContain('href="https://example.com/linked"')
    expect((await note(page, id)).data.content).not.toContain('href="https://example.net')
  })

  test('REG-345 the footer counts words, characters and reading time as you type', { tag: '@P3' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    await page.keyboard.type('one two three')
    await expect(dialog).toContainText('3 words·13 chars·~1 min read')
    await page.keyboard.type(' four')
    await expect(dialog).toContainText('4 words·18 chars·~1 min read')
    await page.keyboard.press('Backspace')
    await expect(dialog).toContainText('4 words·17 chars')
  })

  test('REG-390 an empty note\'s editor counts 0 words and 0 characters', { tag: '@P3' }, async ({ ws }) => {
    knownDefect('DEF-308')
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    await expect(dialog).toContainText('0 words·0 chars·~1 min read')
  })

  test('REG-346 Escape and the close button both save and close; closing an untouched note writes nothing', { tag: '@P2' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    await expectStoreCount(page, 'workspaceItems', 1)
    const untouched = (await note(page, id)).updatedAt
    let dialog = await ws.openNoteEditor(id)
    await editorParts(dialog).close.click()
    await expect(dialog).toBeHidden()

    dialog = await ws.openNoteEditor(id)
    await page.keyboard.type(' Escaped')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await note(page, id)).data.content).toContain('Escaped')
    // The first open-and-close saved nothing: the first save came from the Escape edit.
    const firstSave = (await note(page, id)).updatedAt
    expect(firstSave).toBeGreaterThan(untouched)

    dialog = await ws.openNoteEditor(id)
    await page.keyboard.type(' Closed')
    await editorParts(dialog).close.click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await note(page, id)).data.content).toMatch(/Escaped[\s\S]*Closed/)
    await expect(ws.item(id)).toContainText('Escaped Closed')
  })

  test('REG-380 Ctrl+Enter pressed while typing in a note saves it and closes the editor', { tag: '@P3' }, async ({ ws, page }) => {
    knownDefect('DEF-307')
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    await page.keyboard.type('Committed')
    await page.keyboard.press('Control+Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await note(page, id)).data.content).toContain('Committed')
  })

  test('REG-347 an inserted picture is stored as media and shown on the card; a third picture is refused', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    const picker = dialog.getByLabel('Select image')
    await page.keyboard.type('Pictures')
    for (let i = 1; i <= 2; i++) {
      await picker.setInputFiles(IMAGES.png())
      await expect(editorParts(dialog).text.locator('img')).toHaveCount(i)
    }
    await picker.setInputFiles(IMAGES.png())
    await app.toasts.expectShown('A note holds up to 2 images — add more on the canvas instead')
    await expect(editorParts(dialog).text.locator('img')).toHaveCount(2)
    await editorParts(dialog).done.click()

    // The note keeps references, never the bytes; the bytes are media blobs.
    await expect.poll(async () => ((await note(page, id)).data.content.match(/src="ccimg:[^"]+"/g) ?? []).length).toBe(2)
    expect((await note(page, id)).data.content).not.toContain('data:image')
    const blobs = await readStore<{ id: string; projectId: string; mimeType: string; size: number; data: { __bytes: number } }>(page, 'mediaBlobs')
    expect(blobs).toHaveLength(2)
    // A 64 px picture is stored as it came (no downscale): the PNG's own bytes, in this note's project.
    const projectId = (await note(page, id)).projectId
    for (const b of blobs) {
      expect(b).toMatchObject({ projectId, mimeType: 'image/png', size: IMAGES.png().buffer.length, data: { __bytes: IMAGES.png().buffer.length } })
    }
    // The note points at exactly those two blobs.
    const refs = [...(await note(page, id)).data.content.matchAll(/src="ccimg:([^"]+)"/g)].map((m) => m[1]).sort()
    expect(refs).toEqual(blobs.map((b) => b.id).sort())
    const imgs = ws.item(id).locator('.note-content-preview img')
    await expect(imgs).toHaveCount(2)
    await expect.poll(() => imgs.first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    await expect(imgs.first()).toHaveAttribute('src', /^blob:/)
  })

  test('REG-348 on the free plan the Private toggle explains which plan it needs and leaves the note shareable', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    const priv = dialog.getByRole('button', { name: /^Private/ })
    await expect(priv).toHaveAttribute('aria-pressed', 'false')
    await expect(priv).toHaveAttribute('title', 'Private notes need the Economy plan')
    await priv.click()
    await app.toasts.expectShown('Private notes need the Economy plan — upgrade to keep a note out of your shares.')
    await expect(priv).toHaveAttribute('aria-pressed', 'false')
    await editorParts(dialog).text.click() // the toggle took the focus; type in the note again
    await page.keyboard.type('Still shared')
    await editorParts(dialog).done.click()
    await expect.poll(async () => (await note(page, id)).data.content).toContain('Still shared')
    expect((await note(page, id)).data.private).toBeFalsy()
    await expect(ws.item(id).getByText('PRIVATE')).toHaveCount(0)
  })

  test('REG-349 Delete and Backspace pressed while the editor is open never delete the note being edited', { tag: '@P1' }, async ({ ws, page }) => {
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    await page.keyboard.type('Keep me')
    await page.keyboard.press('Backspace') // deletes a character, not the note
    // Focus on a toolbar control, then on the page body after a colour swatch closes its popover.
    await dialog.getByTitle('Note color', { exact: true }).click()
    await page.keyboard.press('Delete')
    await dialog.getByTitle('red', { exact: true }).click()
    await page.keyboard.press('Delete')
    await editorParts(dialog).done.click()
    await expect.poll(async () => (await note(page, id))?.data.content).toContain('Keep m')
    await expectStoreCount(page, 'workspaceItems', 1)
    await expect(ws.item(id)).toBeVisible()
  })

  test('REG-350 a note holds at most 50,000 characters: a longer paste is cut and the limit is announced', { tag: '@P3' }, async ({ pdfOpen: app, ws, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const id = (await ws.place('note', 0.45, 0.35))!
    const dialog = await ws.openNoteEditor(id)
    await page.evaluate(() => navigator.clipboard.writeText('x'.repeat(50_010)))
    await page.keyboard.press('Control+v')
    await app.toasts.expectShown('Note limit reached (50,000 characters).')
    // The empty note's own line break counts toward the cap, so the paste lands at 49,999 or 50,000.
    const chars = dialog.getByText(/^[\d,]+ chars$/)
    await expect(chars).toHaveText(/^(49999|50000) chars$/) // the footer prints the count without separators
    // Typing stops at the cap: at most one more character fits, never the whole word.
    await page.keyboard.type('more')
    await expect(chars).toHaveText('50000 chars')
    await editorParts(dialog).done.click()
    await expect.poll(async () => (await note(page, id)).data.content.replace(/<[^>]+>/g, '').length).toBeGreaterThanOrEqual(49_999)
    expect((await note(page, id)).data.content.replace(/<[^>]+>/g, '').length).toBeLessThanOrEqual(50_000)
  })
})
