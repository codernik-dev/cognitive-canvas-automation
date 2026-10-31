/**
 * Tablet-sized Chromium with a touchscreen (project "tablet"). Proves the
 * touch code paths the browser can emulate; Apple Pencil, palm rejection
 * and Safari on iPad need a real device (08-DEFECTS-AND-LIMITATIONS.md).
 */
import { test, expect } from '../../fixtures/test.js'
import { expectStoreCount } from '../../helpers/idb.js'
import { openPdfOnTablet } from '../../helpers/mobileFlows.js'

test.describe('Tablet (touch)', { tag: ['@regression', '@responsive', '@tablet'] }, () => {
  test('REG-089 on a touch device the PDF toolbar offers Pan, and a tap with the Note tool places a note', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app, null)
    await expect(app.viewer.tool('pan')).toBeVisible()
    await app.canvas.tool('note').tap()
    const [x, y] = await app.canvas.pointAt(0.5, 0.4)
    await page.touchscreen.tap(x, y)
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'note')
  })
})
