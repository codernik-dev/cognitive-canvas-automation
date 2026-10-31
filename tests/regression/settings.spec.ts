/** Regression: settings that persist, language, shortcuts, print guard. */
import { test, expect } from '../../fixtures/test.js'

test.describe('Settings', { tag: ['@regression', '@settings'] }, () => {
  test('REG-082 Dark mode survives a reload', { tag: ['@P2', '@sanity'] }, async ({ signedIn: app, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Appearance')
    await app.settings.mode('Dark').click()
    await expect.poll(() => app.settings.isDark()).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('cc-theme'))).toBe('dark')
    await app.reload()
    await expect.poll(() => app.settings.isDark()).toBe(true)
    await app.settings.mode('Light').click()
    await expect.poll(() => app.settings.isDark()).toBe(false)
  })

  test('REG-083 switching the language to French translates the app after its reload', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Language')
    await page.getByRole('button', { name: /Français/ }).click()
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Switch language' }).click()])
    await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('cc2_locale'))).toBe('fr')
  })

  test('REG-084 the Shortcuts tab lists the keyboard shortcuts', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Shortcuts')
    await expect(page.getByText(/Ctrl|⌘/).first()).toBeVisible()
  })

  test('REG-085 Ctrl+P is blocked with "Printing is not allowed"', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    await page.keyboard.press('Control+p')
    await app.toasts.expectShown('Printing is not allowed')
  })

  test('REG-086 the browser Back button asks before leaving and "Stay here" keeps the document', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    await page.goBack({ waitUntil: 'commit' })
    const dialog = page.getByRole('dialog', { name: 'Leave Cognitive Canvas?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Stay here' }).click()
    await expect(dialog).toBeHidden()
    await app.viewer.pageRendered(1)
  })
})
