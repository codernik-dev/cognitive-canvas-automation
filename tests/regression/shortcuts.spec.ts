/**
 * Regression: the shortcuts Settings › Shortcuts promises (shortcutsData.ts),
 * each triggered where it lives. Already covered elsewhere and not repeated:
 * Ctrl+F / Escape on the find bar (REG-023), Enter / Shift+Enter between
 * matches (REG-021), Ctrl+D (REG-058), Delete (REG-059/060), Shift+click
 * linking (REG-067), drag-to-pan (REG-064), Ctrl+K (REG-676), Ctrl+P (REG-085).
 */
import { test, expect } from '../../fixtures/shell.js'
import { expectStoreCount, readStore } from '../../helpers/idb.js'
import { SECOND_PDF, FIND_PDF } from '../../data/files.js'
import { selectionHandles } from '../../pages/ShellPages.js'

test.describe('Keyboard and mouse shortcuts', { tag: ['@regression', '@shortcuts'] }, () => {
  test('REG-656 Escape closes an open dialog, menu or panel: System Check, the profile menu, the install hint, a tutorial and quick search', { tag: '@P3' }, async ({ pdfOpen: app, shell, page }) => {
    await app.header.settings.click()
    await app.settings.diagnostics.click()
    await expect(shell.systemCheck.dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(shell.systemCheck.dialog).toBeHidden()

    await app.header.profile.click()
    await expect(app.profileMenu.menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(app.profileMenu.menu).toBeHidden()

    await page.getByRole('button', { name: 'Install app' }).click()
    await expect(shell.banners.install).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(shell.banners.install).toBeHidden()

    await page.getByRole('button', { name: /^Watch tutorial:/ }).click()
    await expect(page.getByRole('dialog', { name: 'PDF document tools: extract, highlight & OCR' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await expect(shell.quickSearch.input).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(shell.quickSearch.input).toBeHidden()
  })

  test('REG-657 Escape switches off the armed document tool, and cancels a pending item link', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const selectArea = app.viewer.tool('select-area')
    await selectArea.click()
    await expect(selectArea).toHaveClass(/bg-primary-500/)
    await page.keyboard.press('Escape')
    await expect(selectArea).not.toHaveClass(/bg-primary-500/)

    const a = (await app.canvas.place('note', 0.3, 0.3))!
    const b = (await app.canvas.place('note', 0.7, 0.6))!
    await app.canvas.tool('pan').click()
    await app.canvas.select(a)
    await app.canvas.item(a).getByRole('button', { name: 'Link to another item' }).click()
    await expect(app.canvas.pendingLinkHint).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(app.canvas.pendingLinkHint).toBeHidden()
    await app.canvas.select(b) // a plain click after cancelling must not finish the link
    await expect(app.canvas.itemLinks).toHaveCount(0)
    expect(await readStore(page, 'itemLinks')).toEqual([])
  })

  test('REG-658 Ctrl+A selects every item of the open document only', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await app.documents.openDocument(SECOND_PDF.displayName)
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    await app.canvas.place('note', 0.5, 0.5)
    await app.viewer.backToDocuments.click()
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const ids = [(await app.canvas.place('note', 0.25, 0.3))!, (await app.canvas.place('note', 0.6, 0.4))!, (await app.canvas.place('text', 0.4, 0.7))!]
    await expectStoreCount(page, 'workspaceItems', 4)
    await app.canvas.tool('pan').click()
    const [x, y] = await app.canvas.pointAt(0.9, 0.15)
    await page.mouse.click(x, y) // the canvas owns the keyboard after a press in it

    await page.keyboard.press('Control+a')
    for (const id of ids.slice(0, 2)) await expect(selectionHandles(app.canvas.item(id)).first()).toBeVisible()
    // Proof by effect: Delete removes the three items of this document, never the other document's note.
    await page.keyboard.press('Delete')
    await expectStoreCount(page, 'workspaceItems', 1)
    const [left] = await readStore<{ documentId: string }>(page, 'workspaceItems')
    const docs = await readStore<{ id: string; name: string }>(page, 'documents')
    expect(docs.find((d) => d.id === left.documentId)?.name).toBe(SECOND_PDF.displayName)
  })

  test('REG-659 the wheel zooms the canvas at the pointer, Shift+wheel pans sideways, Ctrl+wheel zooms finely, middle-drag pans with any tool', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    const note = (await app.canvas.place('note', 0.5, 0.5))!
    const [cx, cy] = await app.canvas.pointAt(0.5, 0.5)
    await page.mouse.move(cx, cy)
    const t0 = await app.canvas.transform()

    await page.mouse.wheel(0, -100) // wheel up: zoom in by 8 %
    await app.canvas.settled()
    const t1 = await app.canvas.transform()
    expect(t1.scale / t0.scale).toBeCloseTo(1.08, 3)
    await page.mouse.wheel(0, 100) // wheel down: zoom out by 8 %
    await app.canvas.settled()
    expect((await app.canvas.transform()).scale / t1.scale).toBeCloseTo(0.92, 3)

    const t2 = await app.canvas.transform()
    await page.keyboard.down('Shift')
    await page.mouse.wheel(0, 120)
    await page.keyboard.up('Shift')
    await app.canvas.settled()
    const t3 = await app.canvas.transform()
    expect(t3.scale).toBe(t2.scale)
    expect(t3.x).toBeCloseTo(t2.x - 120, 0)

    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -10) // Ctrl+wheel: factor 1 - deltaY * 0.01 = 1.1
    await page.keyboard.up('Control')
    await app.canvas.settled()
    expect((await app.canvas.transform()).scale / t3.scale).toBeCloseTo(1.1, 3)

    // Middle-button drag pans even with the Note tool armed, and places no note.
    await app.canvas.tool('note').click()
    const t4 = await app.canvas.transform()
    const [mx, my] = await app.canvas.pointAt(0.2, 0.8)
    await page.mouse.move(mx, my)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(mx + 90, my - 60, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await app.canvas.settled()
    const t5 = await app.canvas.transform()
    expect(t5.x - t4.x).toBeCloseTo(90, 0)
    expect(t5.y - t4.y).toBeCloseTo(-60, 0)
    await expectStoreCount(page, 'workspaceItems', 1)
    expect((await readStore<{ id: string }>(page, 'workspaceItems'))[0].id).toBe(note)
  })

  test('REG-695 right-click opens the context menu: on empty canvas Select All and Reset View, on a selected item duplicate, order and align', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    const a = (await app.canvas.place('note', 0.3, 0.3))!
    const b = (await app.canvas.place('note', 0.65, 0.55))!
    await app.canvas.tool('pan').click()
    await app.canvas.panBy(-120, 80)
    const [x, y] = await app.canvas.pointAt(0.85, 0.2)
    await page.mouse.click(x, y, { button: 'right' })
    await expect(page.getByRole('button', { name: 'Select All', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Select All', exact: true }).click()
    for (const id of [a, b]) await expect(selectionHandles(app.canvas.item(id)).first()).toBeVisible()

    const box = (await app.canvas.item(b).boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + 10, { button: 'right' })
    for (const label of ['Duplicate', 'Delete (2)', 'Bring to Front', 'Send to Back', 'Align Left', 'Align Top']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Distribute H', exact: true })).toHaveCount(0) // needs three
    await expect(page.getByRole('button', { name: 'Select All', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expectStoreCount(page, 'workspaceItems', 4)

    // Reset View puts the world origin at the centre of the canvas at 80 % (ContextMenu.tsx).
    await page.mouse.click(x, y, { button: 'right' })
    await page.getByRole('button', { name: 'Reset View', exact: true }).click()
    await app.canvas.settled()
    const surface = (await app.canvas.surface.boundingBox())!
    const t = await app.canvas.transform()
    expect(t.scale).toBe(0.8)
    expect(Math.abs(t.x - surface.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(t.y - surface.height / 2)).toBeLessThanOrEqual(1)
  })
})
