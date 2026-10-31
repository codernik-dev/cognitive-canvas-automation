/**
 * Accessibility: axe-core scans of the main screens (WCAG 2.1 A/AA rules)
 * plus targeted checks for issues axe cannot see. The gate is "no CRITICAL
 * violations"; every violation found is attached to the report so serious
 * and moderate ones are tracked, not hidden. See 03-TEST-STRATEGY.md.
 */
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '../../fixtures/test.js'
import { knownDefect } from '../../helpers/defects.js'
import type { Page, TestInfo } from '@playwright/test'

async function scan(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = results.violations.map((v) => `${v.impact}\t${v.id}\t${v.nodes.length} node(s)\t${v.help}`).join('\n')
  await testInfo.attach(`axe-${name}.txt`, { body: summary || 'no violations', contentType: 'text/plain' })
  return results.violations
}

test.describe('Accessibility', { tag: ['@a11y'] }, () => {
  test('A11Y-001 PIN setup has no critical accessibility violations', { tag: '@P2' }, async ({ app, page }, testInfo) => {
    await app.open()
    await app.pinSetup.expectVisible()
    const critical = (await scan(page, testInfo, 'pin-setup')).filter((v) => v.impact === 'critical')
    expect(critical.map((v) => v.id)).toEqual([])
  })

  test('A11Y-002 the projects screen has no critical accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    await app.home.createProject('Accessible Project')
    await app.documents.backToProjects.click()
    const critical = (await scan(page, testInfo, 'home')).filter((v) => v.impact === 'critical')
    expect(critical.map((v) => v.id)).toEqual([])
  })

  test('A11Y-003 the workspace with a PDF open has no critical accessibility violations', { tag: '@P2' }, async ({ pdfOpen: _app, page }, testInfo) => {
    const critical = (await scan(page, testInfo, 'workspace')).filter((v) => v.impact === 'critical')
    expect(critical.map((v) => v.id)).toEqual([])
  })

  test('A11Y-004 toast messages are announced to screen readers', { tag: '@P2' }, async ({ pdfOpen: app }) => {
    knownDefect('DEF-003')
    // A toast just appeared ("… uploaded"). It must sit in a live region.
    const live = app.toasts.container.locator('xpath=ancestor-or-self::*[@role="status" or @role="alert" or @aria-live]')
    await expect(live).not.toHaveCount(0)
  })

  test('A11Y-005 the Change PIN fields have accessible names', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-005')
    await app.profileMenu.choose('Change PIN')
    await expect(page.getByRole('dialog', { name: 'Change PIN' }).getByLabel('Current PIN')).toBeVisible()
  })

  test('A11Y-006 the PIN screen can be completed with the keyboard alone', { tag: '@P2' }, async ({ app }) => {
    await app.open()
    await app.pinSetup.expectVisible()
    await app.pinSetup.enter('135790', 'keyboard')
    await app.page.keyboard.press('Enter')
    await expect(app.pinSetup.confirmStep).toBeVisible()
    await app.pinSetup.enter('135790', 'keyboard')
    await app.page.keyboard.press('Enter')
    await expect(app.header.home).toBeVisible()
  })
})
