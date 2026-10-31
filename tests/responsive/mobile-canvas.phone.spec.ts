/**
 * The phone canvas (Pixel 5, project "phone"): MobileCanvasToolBox, the
 * canvas tool dial, and what a finger does with each tool. The desktop
 * palette and the tools themselves are covered in
 * tests/regression/canvas-*.spec.ts; here: the dial drives the same engine,
 * a finger can place, draw, erase and pan, and a double-TAP (650 ms window
 * for touch) opens a note.
 */
import { test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { fingerDrag } from '../../helpers/mobileInput.js'
import { openPdfOnPhone } from '../../helpers/mobileFlows.js'
import { CanvasDialogs } from '../../components/CanvasWorkbench.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { MobileWorkspace } from '../../components/MobileWorkspace.js'

interface StrokeRow { id: string; color: string; points: { x: number; y: number }[] }
interface ItemRow { id: string; type: string; data: { content?: string } }

async function canvasOnPhone(app: CognitiveCanvas, ws: MobileWorkspace) {
  await openPdfOnPhone(app, ws)
  await ws.mode('Canvas').click()
  await expect(app.canvas.surface).toBeVisible()
}

test.describe('Phone canvas', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-835 the Canvas tools dial lists every canvas tool; Note places a note where the finger taps and a double-tap opens its editor', { tag: ['@P1'] }, async ({ project: _p, app, ws, page }) => {
    await canvasOnPhone(app, ws)
    const dial = ws.canvasDial
    await dial.open()
    expect(await dial.tileLabels()).toEqual(['Pan', 'Note', 'Text', 'Draw', 'Eraser', 'Line', 'Audio', 'Video', 'Document', 'Tour'])
    await expect(dial.tileFace('pan')).toHaveClass(/bg-primary-500/)
    await dial.tile('note').click()
    await dial.expectClosed()
    await expect(dial.fab).toHaveClass(/bg-primary-500/)

    const [x, y] = await app.canvas.pointAt(0.5, 0.4)
    await page.touchscreen.tap(x, y)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'note')
    const [note] = await readStore<ItemRow>(page, 'workspaceItems')
    await expect(app.canvas.item(note.id)).toBeVisible()

    // A double TAP (two taps inside the 650 ms touch window) opens the editor.
    const box = (await app.canvas.item(note.id).boundingBox())!
    await dial.pick('pan')
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    const editor = page.getByRole('dialog', { name: 'Edit Note' })
    await expect(editor).toBeVisible()
    await editor.locator('[contenteditable="true"]').first().click()
    await page.keyboard.type('Tapped in')
    await editor.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(editor).toBeHidden()
    await expect.poll(async () => (await readStore<ItemRow>(page, 'workspaceItems'))[0].data.content ?? '').toContain('Tapped in')
  })

  test('REG-836 a finger draws with Draw in the colour picked from the drawer, the Eraser tile rubs a stroke out, and with Pan the finger moves the canvas', { tag: ['@P1'] }, async ({ project: _p, app, ws, page }) => {
    await canvasOnPhone(app, ws)
    const dial = ws.canvasDial
    await dial.pick('ink')
    const drawer = dial.drawer('Ink colour')
    await drawer.click()
    await expect(drawer).toHaveAttribute('aria-expanded', 'true')
    for (const c of ['Amber', 'Teal', 'Red', 'Green', 'Pink', 'Violet', 'Black', 'White']) await expect(page.getByTitle(c, { exact: true })).toBeVisible()

    await fingerDrag(page, await app.canvas.pointAt(0.2, 0.3), await app.canvas.pointAt(0.8, 0.3), 12)
    await expectStoreCount(page, 'canvasStrokes', 1)
    await page.getByTitle('Teal', { exact: true }).click()
    await fingerDrag(page, await app.canvas.pointAt(0.2, 0.6), await app.canvas.pointAt(0.8, 0.6), 12)
    await expectStoreCount(page, 'canvasStrokes', 2)
    const strokes = await readStore<StrokeRow>(page, 'canvasStrokes')
    expect(strokes.map((s) => s.color).sort()).toEqual(['#14b8a6', '#f59e0b'])
    const amber = strokes.find((s) => s.color === '#f59e0b')!
    const teal = strokes.find((s) => s.color === '#14b8a6')!
    await drawer.click()
    await expect(drawer).toHaveAttribute('aria-expanded', 'false')

    await dial.pick('eraser')
    await expect(dial.drawer('Eraser size')).toHaveAttribute('aria-expanded', 'false') // closed by default
    await dial.drawer('Eraser size').click()
    for (const s of ['Small', 'Medium', 'Large', 'Extra Large']) await expect(page.getByTitle(s, { exact: true })).toBeVisible()
    await page.getByTitle('Extra Large', { exact: true }).click()
    await fingerDrag(page, await app.canvas.pointAt(0.5, 0.2), await app.canvas.pointAt(0.5, 0.4), 12)
    // The amber stroke is cut in two; the teal one, off the eraser's path, keeps its id.
    await expect.poll(async () => (await readStore<StrokeRow>(page, 'canvasStrokes')).some((s) => s.id === amber.id)).toBe(false)
    const after = await readStore<StrokeRow>(page, 'canvasStrokes')
    expect(after.filter((s) => s.color === '#f59e0b')).toHaveLength(2)
    expect(after.filter((s) => s.id === teal.id)).toHaveLength(1)

    // Re-tapping the armed tool returns to Pan; then a finger pans instead of drawing.
    await dial.open()
    await dial.tile('eraser').click()
    await expect(dial.fab).not.toHaveClass(/bg-primary-500/)
    const before = await app.canvas.transform()
    await fingerDrag(page, await app.canvas.pointAt(0.3, 0.85), await app.canvas.pointAt(0.6, 0.75), 10)
    await app.canvas.settled()
    const moved = await app.canvas.transform()
    expect(moved.x - before.x).toBeGreaterThan(50)
    expect(moved.y - before.y).toBeLessThan(-15)
    await expectStoreCount(page, 'canvasStrokes', 3)
  })

  test('REG-837 the Audio, Video and Document tiles open their dialogs where the finger taps, and Cancel creates nothing', { tag: '@P3' }, async ({ project: _p, app, ws, page }) => {
    await canvasOnPhone(app, ws)
    const dialogs = new CanvasDialogs(page)
    const tapCanvas = async () => {
      const [x, y] = await app.canvas.pointAt(0.5, 0.5)
      await page.touchscreen.tap(x, y)
    }
    await ws.canvasDial.pick('audio')
    await tapCanvas()
    await expect(dialogs.audio).toBeVisible()
    await dialogs.media(dialogs.audio, 'Audio').cancel.click()
    await expect(dialogs.audio).toBeHidden()

    await ws.canvasDial.pick('video')
    await expect(page.getByText('Tap where you want the video note.')).toBeVisible()
    await tapCanvas()
    await expect(dialogs.video).toBeVisible()
    await dialogs.media(dialogs.video, 'Video').cancel.click()
    await expect(dialogs.video).toBeHidden()

    await ws.canvasDial.pick('document')
    await tapCanvas()
    await expect(dialogs.documentPicker).toBeVisible()
    await dialogs.documentPicker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialogs.documentPicker).toBeHidden()
    await expectStoreCount(page, 'workspaceItems', 0)
    await expectStoreCount(page, 'mediaBlobs', 0)
  })
})
