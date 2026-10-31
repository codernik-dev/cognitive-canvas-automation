/**
 * A phone turned sideways (Pixel 5 in landscape, project "phone"): the window
 * is 851 px wide, past every width tier, but useIsPhone also reads the
 * device's narrow screen edge (393 px), which neither rotation nor the
 * on-screen keyboard moves, so the phone layout must stay
 * (hooks/useIsPhone.ts). The desktop side of the same width is covered by
 * REG-870 (a wide window on a large screen is not a phone).
 */
import { test, expect } from '../../fixtures/mobile.js'
import { openPdfOnPhone } from '../../helpers/mobileFlows.js'

test.describe('Phone in landscape', { tag: ['@regression', '@mobile'] }, () => {
  test.use({ viewport: { width: 851, height: 393 } })

  test('REG-873 a phone in landscape keeps the phone layout: Menu, bottom bar, the Document / Split / Canvas switch and the tool dial', { tag: '@P2' }, async ({ signedIn: app, mobile, ws, page }) => {
    expect(await page.evaluate(() => [innerWidth, Math.min(screen.width, screen.height)])).toEqual([851, 393])
    await expect(mobile.header.menu).toBeVisible()
    await expect(mobile.nav.bar).toBeVisible()
    await expect(app.header.settings).toHaveCount(0)
    await mobile.home.createProject('Sideways')
    await app.documents.expectOpen('Sideways')
    await openPdfOnPhone(app, ws)
    await expect(ws.modes).toBeVisible()
    await expect(ws.docDial.fab).toBeVisible()
    await expect(app.viewer.nav).toHaveCount(0)
  })
})
