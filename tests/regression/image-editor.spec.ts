/**
 * Regression: images on the canvas and the image editor (items/ImageItem.tsx,
 * items/ImageEditorModal.tsx, imagetools/*). Images come from the PDF's
 * Extract Image tool, the app's only way to put a picture on the canvas.
 *
 * The editor applies every change live (there is no Cancel): each tool is
 * checked in storage (IndexedDB), in the editor's preview and on the card.
 * Styles are read from the elements' inline style, which is what the app
 * writes, so the check does not depend on how the browser re-serialises them.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { FIND_PDF } from '../../data/files.js'
import type { Locator, Page } from '@playwright/test'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

interface ImageData {
  name: string; blobId: string; source: string; sourcePageNumber: number
  rotation?: number; invert?: boolean; opacity?: number; brightness?: number; contrast?: number
  borderColor?: string | null; borderWidth?: number; caption?: string; cropRect?: { x: number; y: number; width: number; height: number } | null
}
const image = async (page: Page, id: string) => (await readStore<ItemRow<ImageData>>(page, 'workspaceItems')).find((r) => r.id === id)!

/** [top, right, bottom, left] of an inline clip-path inset(), CSS shorthand expanded; null when none. */
async function insetOf(img: Locator): Promise<number[] | null> {
  const v = await img.evaluate((el) => (el as HTMLElement).style.clipPath)
  if (!v) return null
  const n = (v.match(/-?[\d.]+/g) ?? []).map(Number)
  const [t, r = t, b = t, l = r] = n
  return [t, r, b, l]
}
const inline = (img: Locator, prop: 'transform' | 'filter' | 'opacity') => img.evaluate((el, p) => (el as HTMLElement).style[p], prop)

/** Extract a region of `pageNo` onto the canvas and return the new image item's id. */
async function extractImage(app: CognitiveCanvas, page: Page, pageNo = 1) {
  // Pages are virtualised: bring the page into view before drawing on it.
  if (pageNo !== 1) { await app.viewer.jumpTo(pageNo); await app.viewer.expectPage(pageNo, FIND_PDF.pageCount) }
  await app.viewer.tool('extract-image').click()
  await app.viewer.dragOnPage(pageNo, [0.1, 0.08], [0.6, 0.22])
  await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'image')
  return (await readStore<ItemRow>(page, 'workspaceItems')).find((r) => r.type === 'image')!.id
}

function editorTools(dialog: Locator) {
  // The three sliders carry no label; their order in the Adjustments section is the hook.
  const sliders = dialog.locator('input[type=range]')
  return {
    rotate: dialog.getByTitle(/^Rotate \(\d+°\)$/),
    invert: dialog.getByTitle('Invert colors', { exact: true }),
    opacity: sliders.nth(0),
    brightness: sliders.nth(1),
    contrast: sliders.nth(2),
    border: (title: string) => dialog.getByTitle(title, { exact: true }),
    width: (px: number) => dialog.getByRole('button', { name: `${px}px`, exact: true }),
    caption: dialog.getByPlaceholder('Caption…'),
    crop: (label: string) => dialog.getByRole('button', { name: label, exact: true }),
    preview: dialog.locator('img'),
    done: dialog.getByRole('button', { name: 'Done', exact: true }),
    close: dialog.getByRole('button', { name: 'Close', exact: true }),
  }
}

async function openEditor(app: CognitiveCanvas, id: string) {
  await app.canvas.item(id).locator('img').dblclick()
  const dialog = app.page.getByRole('dialog', { name: 'Edit Image' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('img')).toHaveAttribute('src', /^blob:/)
  return dialog
}

test.describe('Image editor', { tag: ['@regression', '@canvas', '@images'] }, () => {
  test('REG-097 an extracted image can be rotated and cropped; the card shows it and it is kept after a reload', { tag: ['@P2', '@sanity'] }, async ({ pdfOpen: app, ws, page }) => {
    const id = await extractImage(app, page)
    const before = await image(page, id)
    const dialog = await openEditor(app, id)
    const t = editorTools(dialog)
    await t.rotate.click()
    await t.crop('1:1').click()
    await t.done.click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => { const r = await image(page, id); return { rot: r.data.rotation, crop: r.data.cropRect, w: r.width, h: r.height } })
      .toEqual({ rot: 90, crop: { x: 12.5, y: 0, width: 75, height: 75 }, w: before.height, h: before.width })
    const card = ws.item(id).locator('img')
    expect(await insetOf(card)).toEqual([0, 12.5, 25, 12.5])
    expect(await inline(card, 'transform')).toBe('rotate(90deg) scale(0.85)')

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(ws.item(id).locator('img')).toHaveAttribute('src', /^blob:/)
    expect(await insetOf(ws.item(id).locator('img'))).toEqual([0, 12.5, 25, 12.5])
    expect(await inline(ws.item(id).locator('img'), 'transform')).toBe('rotate(90deg) scale(0.85)')
  })

  test('REG-351 Rotate steps through 0, 90, 180 and 270 degrees back to 0, swapping the card size only when it turns sideways', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const id = await extractImage(app, page)
    const start = await image(page, id)
    const t = editorTools(await openEditor(app, id))
    await expect(t.rotate).toHaveAttribute('title', 'Rotate (0°)')
    for (const angle of [90, 180, 270, 0]) {
      await t.rotate.click()
      await expect(t.rotate).toHaveAttribute('title', `Rotate (${angle}°)`)
      await expect(t.rotate).toHaveText(`${angle}°`)
      const sideways = angle === 90 || angle === 270
      await expect.poll(async () => { const r = await image(page, id); return [r.data.rotation, r.width, r.height] })
        .toEqual([angle, sideways ? start.height : start.width, sideways ? start.width : start.height])
      expect(await inline(t.preview, 'transform')).toBe(angle === 0 ? '' : `rotate(${angle}deg)${sideways ? ' scale(0.85)' : ''}`)
    }
  })

  test('REG-352 Invert, Opacity, Brightness and Contrast are saved and applied to the preview and the card', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    const id = await extractImage(app, page)
    const dialog = await openEditor(app, id)
    const t = editorTools(dialog)
    await t.invert.click()
    await t.opacity.fill('0.5')
    await t.brightness.fill('150')
    await t.contrast.fill('50')
    await expect(dialog.getByText('50%', { exact: true })).toHaveCount(2) // opacity and contrast read-outs
    await expect(dialog.getByText('150%', { exact: true })).toBeVisible()
    await expect.poll(async () => { const d = (await image(page, id)).data; return [d.invert, d.opacity, d.brightness, d.contrast] }).toEqual([true, 0.5, 150, 50])
    for (const img of [t.preview, ws.item(id).locator('img')]) {
      await expect.poll(() => inline(img, 'filter')).toBe('brightness(150%) contrast(50%) invert(1)')
      expect(await inline(img, 'opacity')).toBe('0.5')
    }
    // Invert is a toggle.
    await t.invert.click()
    await expect.poll(async () => (await image(page, id)).data.invert).toBe(false)
    await expect.poll(() => inline(t.preview, 'filter')).toBe('brightness(150%) contrast(50%)')
  })

  test('REG-353 a border colour and width are saved and drawn on the card; "No border" removes it', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    const id = await extractImage(app, page)
    const dialog = await openEditor(app, id)
    const t = editorTools(dialog)
    await expect(t.width(2)).toHaveCount(0) // widths appear only once a colour is chosen
    await t.border('#ef4444').click()
    await expect.poll(async () => { const d = (await image(page, id)).data; return [d.borderColor, d.borderWidth] }).toEqual(['#ef4444', 2])
    await t.width(5).click()
    await expect.poll(async () => (await image(page, id)).data.borderWidth).toBe(5)
    const frame = ws.item(id).locator(':scope > div').first()
    await expect(frame).toHaveCSS('border-top', '5px solid rgb(239, 68, 68)')
    await t.border('No border').click()
    await expect.poll(async () => { const d = (await image(page, id)).data; return [d.borderColor, d.borderWidth] }).toEqual([null, 0])
    await expect(frame).toHaveCSS('border-top-width', '1px')
    await expect(t.width(5)).toHaveCount(0)
  })

  test('REG-354 a caption is trimmed, saved and shown under the picture; clearing it removes it', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    const id = await extractImage(app, page)
    const dialog = await openEditor(app, id)
    const t = editorTools(dialog)
    await t.caption.fill('  Figure one  ')
    await t.caption.press('Enter')
    await expect.poll(async () => (await image(page, id)).data.caption).toBe('Figure one')
    await expect(ws.item(id).getByText('Figure one', { exact: true })).toBeVisible()
    await t.caption.fill('')
    await t.done.click() // leaving the field saves it too
    await expect.poll(async () => (await image(page, id)).data.caption).toBe('')
    await expect(ws.item(id).getByText('Figure one')).toHaveCount(0)
  })

  test('REG-355 every crop preset stores its own rectangle, marks itself active, and None removes the crop', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const id = await extractImage(app, page)
    const t = editorTools(await openEditor(app, id))
    const presets: Array<[string, ImageData['cropRect']]> = [
      ['4:3', { x: 0, y: 6.25, width: 100, height: 75 }],
      ['16:9', { x: 0, y: 15.625, width: 100, height: 56.25 }],
      ['1:1', { x: 12.5, y: 0, width: 75, height: 75 }],
      ['Top ½', { x: 0, y: 0, width: 100, height: 50 }],
      ['Bot ½', { x: 0, y: 50, width: 100, height: 50 }],
      ['None', null],
    ]
    for (const [label, rect] of presets) {
      await t.crop(label).click()
      await expect.poll(async () => (await image(page, id)).data.cropRect ?? null).toEqual(rect)
      await expect(t.crop(label)).toHaveClass(/bg-primary-500\/15/)
      await expect.poll(() => insetOf(t.preview)).toEqual(rect ? [rect.y, 100 - rect.x - rect.width, 100 - rect.y - rect.height, rect.x] : null)
    }
  })

  test('REG-356 the editor names the excerpt, and closes with Done, the close button or Escape, keeping the edits', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const id = await extractImage(app, page)
    let dialog = await openEditor(app, id)
    await expect(dialog.getByRole('heading', { name: 'Page 1 excerpt' })).toBeVisible()
    await expect(dialog.getByText('Page 1 excerpt', { exact: true })).toHaveCount(2) // the title and the footer
    const t = editorTools(dialog)
    await t.rotate.click()
    await t.close.click()
    await expect(dialog).toBeHidden()
    dialog = await openEditor(app, id)
    await editorTools(dialog).invert.click()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect.poll(async () => { const d = (await image(page, id)).data; return [d.rotation, d.invert] }).toEqual([90, true])
  })

  test('REG-357 the image card shows its name and page, can be resized, and its badge jumps the PDF to the linked area', { tag: '@P2' }, async ({ pdfOpen: app, ws, page }) => {
    const id = await extractImage(app, page, 2)
    await expect(ws.item(id)).toContainText('Page 2 excerpt')
    await expect(ws.item(id)).toContainText('p.2')
    const row = await image(page, id)
    expect(row.data).toMatchObject({ name: 'Page 2 excerpt', source: 'select-area', sourcePageNumber: 2 })
    await ws.expectSelected(id) // a new image is selected and has the eight handles
    const se = (await ws.handle(id, 'se').boundingBox())!
    const { scale } = await ws.transform()
    await ws.drag({ x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x + se.width / 2 + 40, y: se.y + se.height / 2 }, { steps: 6 })
    await expect.poll(async () => (await image(page, id)).width - row.width).toBeCloseTo(40 / scale, 0)

    await app.viewer.jumpTo(4)
    await app.viewer.expectPage(4, FIND_PDF.pageCount)
    // Deselect first: on a selected image the corner resize handle sits over the badge's centre.
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    await ws.item(id).getByRole('button', { name: 'Go to linked area on page 2' }).click()
    await app.viewer.expectPage(2, FIND_PDF.pageCount)
  })

  test('REG-358 with a note selected, an image offers "Link to selected note", which links them once', { tag: '@P3' }, async ({ pdfOpen: app, ws, page }) => {
    const img = await extractImage(app, page)
    const noteId = (await ws.place('note', 0.25, 0.8))!
    await ws.select(noteId)
    await ws.item(img).hover()
    await ws.item(img).getByRole('button', { name: 'Link to selected note' }).click()
    await expectStoreCount(page, 'itemLinks', 1)
    const [link] = await readStore<{ fromItemId: string; toItemId: string }>(page, 'itemLinks')
    expect(link).toMatchObject({ fromItemId: noteId, toItemId: img })
    const already = ws.item(img).getByRole('button', { name: 'Already linked to selected note' })
    await expect(already).toBeVisible()
    await already.click()
    // Sentinel: a second, deliberate link from another note makes exactly two.
    const other = (await ws.place('note', 0.75, 0.85))!
    await ws.linkItems(other, noteId)
    await expectStoreCount(page, 'itemLinks', 2)
  })
})
