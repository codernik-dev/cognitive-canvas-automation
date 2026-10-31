/**
 * Regression: the interface language (src/i18n, Settings › Language,
 * LanguageMenuButton on the PIN screens, LanguageSuggestion).
 *
 * Every expected string is read from the catalog the build ships
 * (helpers/shell.ts `tr`), so "translated" means the screen shows the real
 * translation, not just "not English". Choosing a language saves
 * localStorage `cc2_locale` and reloads; `<html lang dir>` follow. None of
 * the six languages is right-to-left, so `dir` must stay "ltr" everywhere.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/shell.js'
import { LOCALES, SCRIPT_SAMPLES, type LocaleCode } from '../../data/shell-files.js'
import { tr } from '../../helpers/shell.js'
import { ENV } from '../../config/env.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { LanguageSettings } from '../../pages/ShellPages.js'

const RAIL = ['Appearance', 'Language', 'Plan', 'Permissions', 'Shortcuts', 'Tool Guide', 'Support', 'Tutorials']
const nativeName = (code: LocaleCode) => LOCALES.find((l) => l.code === code)!.nativeName
const intl = (code: LocaleCode) => LOCALES.find((l) => l.code === code)!.intl
const savedLocale = (page: Page) => page.evaluate(() => localStorage.getItem('cc2_locale'))
const documentLanguage = (page: Page) => page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }))
/** Two animation frames: long enough for a state change made in an input handler to paint. */
const twoFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

/** Settings › Language › <language> › Switch language, waiting for the reload. */
async function chooseLanguage(app: CognitiveCanvas, code: LocaleCode) {
  const page = app.page
  await app.header.settings.click()
  await app.settings.openTab('Language')
  await new LanguageSettings(page).tile(nativeName(code)).click()
  await expect(page.getByText(`Switch to ${nativeName(code)}? The app reloads to apply it; your work is saved.`)).toBeVisible()
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Switch language' }).click()])
}

/** One project, back on Home: an empty library reopens the Catalog after every reload (OBS-009). */
async function withAProject(app: CognitiveCanvas) {
  await app.home.createProject('Language Project')
  await app.documents.backToProjects.click()
  await expect(app.home.card('Language Project')).toBeVisible()
}

/** First-run PIN setup read in `code` (the shared fixture expects English). */
async function createPinIn(app: CognitiveCanvas, code: LocaleCode) {
  const page = app.page
  await expect(page.getByRole('heading', { name: tr(code, 'Welcome'), level: 1 })).toBeVisible()
  await expect(page.getByText(tr(code, 'Create a 6-digit PIN to lock the app on this device'))).toBeVisible()
  await page.keyboard.type(ENV.testPin)
  await page.getByRole('button', { name: tr(code, 'Next'), exact: true }).click()
  await expect(page.getByText(tr(code, 'Confirm your PIN'))).toBeVisible()
  await page.keyboard.type(ENV.testPin)
  await page.getByRole('button', { name: tr(code, 'Create Account') }).click()
  await expect(page.getByText(tr(code, 'Failed to load content'))).toBeVisible({ timeout: 30_000 })
}

test.describe('Interface languages', { tag: ['@regression', '@language'] }, () => {
  const cases: [string, LocaleCode][] = [['REG-660', 'hi'], ['REG-661', 'pa'], ['REG-662', 'fr'], ['REG-663', 'de'], ['REG-664', 'ja']]
  for (const [id, code] of cases) {
    test(`${id} choosing ${LOCALES.find((l) => l.code === code)!.englishName} translates Settings, Home and the unlock screen, and the choice survives a reload`, { tag: code === 'hi' ? ['@P2', '@sanity'] : '@P2' }, async ({ signedIn: app, shell, page }) => {
      await withAProject(app)
      await chooseLanguage(app, code)
      expect(await savedLocale(page)).toBe(code)
      await expect.poll(() => documentLanguage(page)).toEqual({ lang: intl(code), dir: 'ltr' })

      // Settings, where the switch happened (the reload keeps the screen and tab).
      await expect(page.getByRole('heading', { name: tr(code, 'Settings'), level: 1 })).toBeVisible()
      await expect(page.getByRole('navigation').getByRole('button')).toHaveText(RAIL.map((s) => tr(code, s)))
      await expect(page.getByRole('button', { name: tr(code, 'Diagnostics') })).toBeVisible()
      // The tile now carries the check mark: it is the pinned choice.
      await expect(shell.language.selected).toHaveCount(1)
      await expect(shell.language.selected).toContainText(nativeName(code))

      // Home and the global bar. Product names stay English by design.
      await page.getByRole('button', { name: tr(code, 'Go to home') }).click()
      await expect(page.getByPlaceholder(tr(code, 'New project name...'))).toBeVisible()
      await expect(page.getByRole('button', { name: tr(code, 'Create'), exact: true })).toBeDisabled()
      await expect(page.getByRole('heading', { name: tr(code, 'Projects ({count})', { count: 1 }) })).toBeVisible()
      await expect(page.getByRole('searchbox', { name: tr(code, 'Search projects') })).toBeVisible()
      await expect(page.getByText('Language Project', { exact: true })).toBeVisible() // user content is never translated
      await expect(page.getByRole('button', { name: tr(code, 'Start guided tour') })).toBeVisible()
      await expect(page.getByRole('button', { name: tr(code, 'Go to home') })).toContainText('Cognitive Canvas')

      // The choice is kept across a reload and on the unlock screen.
      await app.reload()
      await expect(page.getByPlaceholder(tr(code, 'New project name...'))).toBeVisible()
      await page.getByRole('button', { name: tr(code, 'Sign in') }).click()
      await page.getByRole('menuitem', { name: tr(code, 'Lock'), exact: true }).click()
      await expect(page.getByText(tr(code, 'Enter your PIN to continue'))).toBeVisible()
      await expect(page.getByRole('button', { name: tr(code, 'Forgot PIN?') })).toBeVisible()
      await page.keyboard.type('000000')
      await page.getByRole('button', { name: tr(code, 'Unlock'), exact: true }).click()
      await expect(app.login.message).toHaveText(tr(code, 'Incorrect PIN. {count} of {total} attempts left.', { count: 4, total: 5 }))
      await page.keyboard.type(ENV.testPin)
      await page.getByRole('button', { name: tr(code, 'Unlock'), exact: true }).click()
      await expect(page.getByPlaceholder(tr(code, 'New project name...'))).toBeVisible()
    })
  }

  test('REG-665 picking a language asks before reloading; Cancel keeps the current one and saves nothing', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Language')
    await expect(shell.language.selected).toHaveCount(1)
    await expect(shell.language.selected).toContainText('Device language')
    await expect(shell.language.selected).toContainText('Follows this device — currently English')
    // Choosing the option already in force needs no confirmation.
    await shell.language.deviceLanguage.click()
    await expect(page.getByRole('button', { name: 'Switch language' })).toBeHidden()

    await shell.language.tile('Deutsch').click()
    await expect(page.getByText('Switch to Deutsch? The app reloads to apply it; your work is saved.')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Switch language' })).toBeHidden()
    expect(await savedLocale(page)).toBeNull()
    await expect(app.settings.heading).toHaveText('Settings')

    // English while on "Device language" still pins English when confirmed.
    await shell.language.tile('English').click()
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Switch language' }).click()])
    expect(await savedLocale(page)).toBe('en')
    await expect(shell.language.selected).toContainText('English')
    await expect(shell.language.selected).not.toContainText('Device language')
  })

  test('REG-666 the language menu on the PIN setup screen lists every language and switches the setup screen', { tag: '@P2' }, async ({ app, shell, page }) => {
    await app.open()
    await app.pinSetup.expectVisible()
    await expect(shell.languageMenu.button).toHaveAccessibleName('Language: English')
    await shell.languageMenu.button.click()
    await expect(shell.languageMenu.menu.getByRole('menuitemradio')).toHaveText(['English', 'हिन्दीHindi', 'ਪੰਜਾਬੀPunjabi', 'FrançaisFrench', 'DeutschGerman', '日本語Japanese'])
    await expect(shell.languageMenu.option('English')).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(shell.languageMenu.menu).toBeHidden()
    await shell.languageMenu.button.click()
    await page.mouse.click(683, 760)
    await expect(shell.languageMenu.menu).toBeHidden()

    await shell.languageMenu.button.click()
    await Promise.all([page.waitForEvent('load'), shell.languageMenu.option('日本語').click()])
    expect(await savedLocale(page)).toBe('ja')
    await expect.poll(() => documentLanguage(page)).toEqual({ lang: 'ja', dir: 'ltr' })
    await expect(shell.languageMenu.button).toHaveAccessibleName(tr('ja', 'Language: {language}', { language: '日本語' }))
    await createPinIn(app, 'ja')
  })

  test('REG-667 the unlock screen has the same language menu and keeps the choice through the unlock', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    await shell.languageMenu.button.click()
    await Promise.all([page.waitForEvent('load'), shell.languageMenu.option('Français').click()])
    await expect(page.getByText(tr('fr', 'Enter your PIN to continue'))).toBeVisible()
    await page.keyboard.type(ENV.testPin)
    await page.getByRole('button', { name: tr('fr', 'Unlock'), exact: true }).click()
    await expect(page.getByRole('button', { name: tr('fr', 'Start guided tour') })).toBeVisible()
    expect(await savedLocale(page)).toBe('fr')
  })
})

test.describe('Device language', { tag: ['@regression', '@language'] }, () => {
  test.use({ locale: 'de-DE' })

  test('REG-668 a device set to German opens in German, Settings shows Device language, and pinning English then Device language switches back and forth', { tag: '@P2' }, async ({ app, shell, page }) => {
    await app.open()
    await expect.poll(() => documentLanguage(page)).toEqual({ lang: 'de', dir: 'ltr' })
    await createPinIn(app, 'de')
    expect(await savedLocale(page)).toBeNull()
    await page.getByRole('button', { name: tr('de', 'Settings'), exact: true }).click()
    await page.getByRole('navigation').getByRole('button', { name: tr('de', 'Language') }).click()
    const pressed = shell.language.selected
    await expect(pressed).toContainText(tr('de', 'Device language'))
    await expect(pressed).toContainText(tr('de', 'Follows this device — currently {language}', { language: 'Deutsch' }))
    // The language showing (but not pinned) is marked Active.
    await expect(shell.language.tile('Deutsch')).toHaveAttribute('aria-pressed', 'false')
    await expect(shell.language.tile('Deutsch')).toContainText(tr('de', 'Active'))

    await shell.language.tile('English').click()
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: tr('de', 'Switch language') }).click()])
    expect(await savedLocale(page)).toBe('en')
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await expect(shell.language.deviceLanguage).toContainText('Follows this device — currently Deutsch')

    await shell.language.deviceLanguage.click()
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Switch language' }).click()])
    expect(await savedLocale(page)).toBe('auto')
    await expect(page.getByRole('heading', { name: tr('de', 'Settings'), level: 1 })).toBeVisible()
  })
})

test.describe('Language suggestion', { tag: ['@regression', '@language'] }, () => {
  test('REG-669 typing Hindi offers a Hindi interface in Hindi; "not now" is remembered while other scripts are still offered', { tag: '@P2' }, async ({ signedIn: app, shell, page }) => {
    await withAProject(app)
    await app.home.newProjectName.fill(SCRIPT_SAMPLES.hindi)
    await expect(shell.languageOffer.dialog).toContainText('आप हिन्दी में लिख रहे हैं। क्या ऐप को हिन्दी में बदलें?')
    await expect(shell.languageOffer.dialog).toContainText('Switch the app to हिन्दी?')
    await expect(shell.languageOffer.dialog).toHaveAttribute('lang', 'hi-IN')
    await shell.languageOffer.dialog.getByRole('button', { name: 'अभी नहीं' }).click()
    await expect(shell.languageOffer.dialog).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('cc2_locale_suggest_dismissed'))).toBe('["hi"]')
    expect(await savedLocale(page)).toBeNull()

    await app.reload()
    await app.home.newProjectName.fill(SCRIPT_SAMPLES.hindi)
    await twoFrames(page)
    await expect(shell.languageOffer.dialog).toBeHidden()
    // The detector is still listening: Punjabi, never dismissed, is offered.
    await app.home.newProjectName.fill(SCRIPT_SAMPLES.punjabi)
    await expect(shell.languageOffer.dialog).toContainText('ਤੁਸੀਂ ਪੰਜਾਬੀ ਵਿੱਚ ਲਿਖ ਰਹੇ ਹੋ। ਕੀ ਐਪ ਨੂੰ ਪੰਜਾਬੀ ਵਿੱਚ ਬਦਲੀਏ?')
  })

  test('REG-670 accepting the offer waits until typing is finished, then reloads in Hindi', { tag: '@P2' }, async ({ signedIn: app, shell, page }) => {
    // The switch is applied by a 600 ms poll that waits for "nothing is being edited".
    // A paused clock makes the wait observable: time is advanced only when the test says so.
    await withAProject(app)
    await page.clock.install()
    await app.home.newProjectName.fill(SCRIPT_SAMPLES.hindi)
    await page.clock.pauseAt(Date.now() + 60_000)
    await shell.languageOffer.dialog.getByRole('button', { name: 'हिन्दी में बदलें' }).click()
    await app.home.newProjectName.focus() // still typing
    await expect(shell.languageOffer.dialog).toContainText('लिखना पूरा होते ही ऐप हिन्दी में बदल जाएगा…')
    await page.clock.runFor(3_000)
    expect(await savedLocale(page), 'no reload while the field is being edited').toBeNull()
    await expect(app.home.newProjectName).toHaveValue(SCRIPT_SAMPLES.hindi)

    await app.home.newProjectName.blur()
    await Promise.all([page.waitForEvent('load'), page.clock.runFor(1_000)])
    await page.clock.resume()
    expect(await savedLocale(page)).toBe('hi')
    await expect(page.getByPlaceholder(tr('hi', 'New project name...'))).toBeVisible()
  })

  test('REG-671 no offer for kanji without kana, for a few words inside English, or once a language is pinned; Japanese with kana is offered', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await withAProject(app)
    for (const text of [SCRIPT_SAMPLES.kanjiOnly, SCRIPT_SAMPLES.mostlyEnglish]) {
      await app.home.newProjectName.fill(text)
      await twoFrames(page)
      await expect(shell.languageOffer.dialog).toBeHidden()
    }
    await app.home.newProjectName.fill(SCRIPT_SAMPLES.japanese)
    await expect(shell.languageOffer.dialog).toContainText('日本語で入力しています。アプリの表示を日本語に切り替えますか？')
    await shell.languageOffer.dialog.getByRole('button', { name: '今はしない' }).click()

    await chooseLanguage(app, 'en') // pin English: the person has decided
    await page.getByRole('button', { name: 'Go to home' }).click()
    await app.home.newProjectName.fill(SCRIPT_SAMPLES.punjabi)
    await twoFrames(page)
    await expect(shell.languageOffer.dialog).toBeHidden()
  })
})
