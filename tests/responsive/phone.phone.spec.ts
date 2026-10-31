/**
 * Phone layout (Pixel 5 emulation, project "phone"). Emulation proves the
 * responsive layout and touch-sized flows in Chromium; it does not prove
 * behaviour on a real phone or in mobile Safari (08-DEFECTS-AND-LIMITATIONS.md).
 */
import { test, expect } from '../../fixtures/test.js'
import { FIND_PDF } from '../../data/files.js'

test.describe('Phone', { tag: ['@regression', '@responsive', '@phone'] }, () => {
  test('REG-087 the header collapses into a Menu sheet whose Lock locks the app', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await expect(app.header.settings).toBeHidden()
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    const lock = page.getByRole('button', { name: 'Lock', exact: true }).filter({ visible: true })
    await expect(lock).toBeVisible()
    await lock.click()
    await app.login.expectVisible()
  })

  test('REG-088 a PDF opens on a phone and the Document/Canvas switch swaps the panes', { tag: '@P1' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.pageRendered(1)
    const modes = page.locator('[data-tour="mobile-mode-switch"]')
    await expect(modes).toBeVisible()
    await modes.getByRole('button', { name: /Canvas/ }).click()
    await expect(app.canvas.surface).toBeVisible()
    await modes.getByRole('button', { name: /Document/ }).click()
    await expect(app.viewer.canvasOf(1)).toBeVisible()
  })
})
