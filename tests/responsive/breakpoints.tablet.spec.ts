/**
 * The width tiers on both sides of each line (utils/breakpoints.ts,
 * hooks/useBreakpoint.ts, hooks/useIsPhone.ts), on the touch-tablet Chromium
 * (project "tablet", whose screen stays 1920x1080, so only the window width
 * moves):
 *
 *   sm 640   < 640 the phone layout (useIsPhone: a narrow window counts)
 *   md 768   < 768 the PDF toolbar is always pinned (no Unpin) and the
 *            Assistant's edge tab is hidden (`max-md:hidden`)
 *   lg 1024  < 1024 the header storage chip drops its figures (`hidden lg:inline`)
 *
 * The window is resized mid-test (page.setViewportSize), the way a split-screen
 * or a rotated tablet changes it, so each test also proves the switch happens
 * live, both ways.
 */
import { test, expect } from '../../fixtures/mobile.js'
import { openPdfOnTablet } from '../../helpers/mobileFlows.js'
import { AssistantPanel } from '../../components/ContentAssistant.js'

test.describe('Breakpoints', { tag: ['@regression', '@mobile'] }, () => {
  test.describe('sm (640)', () => {
    test.use({ viewport: { width: 639, height: 1000 } })
    test('REG-870 at 639 px the phone layout (Menu, bottom bar), at 640 px the tablet header, and back again', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
      await expect(mobile.header.menu).toBeVisible()
      await expect(mobile.nav.bar).toBeVisible()
      await expect(app.header.settings).toHaveCount(0)
      await page.setViewportSize({ width: 640, height: 1000 })
      await expect(mobile.header.menu).toHaveCount(0)
      await expect(mobile.nav.bar).toHaveCount(0)
      await expect(app.header.settings).toBeVisible()
      await expect(app.header.profile).toBeVisible()
      await expect(app.home.newProjectName).toBeVisible()
      await page.setViewportSize({ width: 639, height: 1000 })
      await expect(mobile.header.menu).toBeVisible()
      await expect(mobile.home.search).toBeVisible() // the phone list's own search
    })
  })

  test.describe('md (768)', () => {
    test.use({ viewport: { width: 768, height: 1024 } })
    test('REG-871 at 768 px the PDF toolbar can be unpinned and the Assistant tab shows; at 767 px the toolbar is pinned for good and the tab hides', { tag: '@P3' }, async ({ project: _p, app, page }) => {
      await openPdfOnTablet(app, null)
      const pin = page.locator('[data-tour="toolbar-pin"]')
      const bot = new AssistantPanel(page)
      await expect(pin).toHaveAccessibleName('Unpin toolbar')
      await expect(bot.tab).toBeVisible()
      await page.setViewportSize({ width: 767, height: 1024 })
      await expect(pin).toHaveCount(0)
      await expect(app.viewer.tool('highlight')).toBeVisible() // still the pinned toolbar, not the phone dial
      await expect(page.locator('button[aria-expanded][title="Document tools"]')).toHaveCount(0)
      await expect(bot.tab).toBeHidden()
      await page.setViewportSize({ width: 768, height: 1024 })
      await expect(pin).toBeVisible()
      await expect(bot.tab).toBeVisible()
    })
  })

  test.describe('lg (1024)', () => {
    test.use({ viewport: { width: 1024, height: 1366 } })
    test('REG-872 at 1024 px the header storage chip shows "used / total"; at 1023 px only the icon, with the figures kept in its tooltip', { tag: '@P3' }, async ({ signedIn: app, page }) => {
      const figures = app.header.storage.getByText(/^\d+(\.\d+)? (B|KB|MB|GB) \/ \d+(\.\d+)? (B|KB|MB|GB)$/)
      await expect(figures).toBeVisible()
      await page.setViewportSize({ width: 1023, height: 1366 })
      await expect(figures).toBeHidden()
      await expect(app.header.storage).toBeVisible()
      await expect(app.header.storage).toHaveAttribute('title', /^\d+(\.\d+)? (B|KB|MB|GB) of \d+(\.\d+)? (B|KB|MB|GB) used — click for details$/)
      await page.setViewportSize({ width: 1024, height: 1366 })
      await expect(figures).toBeVisible()
    })
  })
})
