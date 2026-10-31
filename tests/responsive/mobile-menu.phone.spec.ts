/**
 * Phone Menu sheet (MobileMenuSheet.tsx), opened from the header's Menu: the
 * account header, every row, the ways the sheet closes, the phone Install
 * flow (InstallHintModal + the captured `beforeinstallprompt`), the
 * touch-device "mobile view" notice, and the phone Settings section dropdown.
 *
 * The desktop install hint, global bar and profile menu are covered in
 * tests/regression/shell.spec.ts and shell-account.spec.ts.
 */
import type { Page } from '@playwright/test'
import { test, backupTest, expect } from '../../fixtures/mobile.js'
import { knownDefect } from '../../helpers/defects.js'
import { fingerDrag } from '../../helpers/mobileInput.js'
import { ShellBanners, TourCard } from '../../pages/ShellPages.js'

const ROWS_ON_HOME = ['Sign in', 'Product catalog', 'Sharing', 'Backup & Restore', 'Settings', 'Appearance', 'Language', 'Tool guide', 'Guided tour', 'Fullscreen', 'Install app', 'Help & support', 'Change PIN', 'Lock']

/**
 * Emulate the browser's install offer. Chromium fires `beforeinstallprompt`
 * only for an installable, engaged site, which Playwright cannot produce, so
 * the event is built here with the two members the app uses; prompt() is
 * counted and userChoice answers `outcome`.
 */
async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed') {
  return page.evaluate((outcome) => {
    const w = window as unknown as { __e2ePromptCalls: number; __e2eInstallEvent: Event; __pwaInstallPrompt?: unknown }
    w.__e2ePromptCalls = 0
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> }
    e.prompt = async () => { w.__e2ePromptCalls++ }
    e.userChoice = Promise.resolve({ outcome, platform: 'web' })
    w.__e2eInstallEvent = e
    window.dispatchEvent(e)
    return { defaultPrevented: e.defaultPrevented, stored: w.__pwaInstallPrompt === e }
  }, outcome)
}
const promptCalls = (page: Page) => page.evaluate(() => (window as unknown as { __e2ePromptCalls: number }).__e2ePromptCalls)

test.describe('Phone Menu sheet', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-813 the Menu sheet lists every destination in sections; Backup & Restore is offered on the library only; backdrop tap and a downward swipe close it, a short tug does not', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await mobile.menu.expectClosed()
    await mobile.menu.open()
    await expect(mobile.menu.rows).toHaveText(ROWS_ON_HOME)
    for (const s of ['Library', 'Your data', 'App', 'Help & session'] as const) await expect(mobile.menu.section(s)).toBeVisible()
    await expect(mobile.menu.row('Sign out')).toHaveCount(0) // signed out

    await mobile.menu.backdrop.click({ position: { x: 20, y: 20 } })
    await mobile.menu.expectClosed()

    // The grip: a short tug snaps back, a pull past 70 px dismisses.
    await mobile.menu.open()
    const grip = (await mobile.menu.grip.boundingBox())!
    const at: [number, number] = [grip.x + grip.width / 2, grip.y + grip.height / 2]
    await fingerDrag(page, at, [at[0], at[1] + 40], 6)
    await mobile.menu.expectOpen()
    await expect(mobile.menu.row('Product catalog')).toBeInViewport()
    await fingerDrag(page, at, [at[0], at[1] + 160], 8)
    await mobile.menu.expectClosed()

    // Inside a project the backup row (a library-level action) is not offered.
    await app.home.createProject('Inside Project')
    await app.documents.expectOpen('Inside Project')
    await mobile.menu.open()
    await expect(mobile.menu.row('Backup & Restore')).toHaveCount(0)
    await expect(mobile.menu.section('Your data')).toHaveCount(0)
  })

  test('REG-814 each Menu row goes where it says and closes the sheet, also when opened from the Settings screen', { tag: '@P2' }, async ({ signedIn: _app, mobile, page }) => {
    // Settings rows first: each later catalog visit is a failed request, and the second one raises the offline banner (REG-848).
    for (const [row, section] of [['Settings', 'Permissions'], ['Appearance', 'Appearance'], ['Language', 'Language'], ['Tool guide', 'Tool Guide'], ['Help & support', 'Support']] as const) {
      await mobile.menu.choose(row)
      await mobile.menu.expectClosed()
      await expect(mobile.settings.heading).toBeVisible()
      await expect(mobile.settings.sectionPicker).toContainText(section)
    }
    // From Settings, a screen row still navigates (Settings outranks the catalog in the screen chain).
    await mobile.menu.choose('Product catalog')
    await mobile.menu.expectClosed()
    await expect(mobile.settings.heading).toBeHidden()
    await expect(page.getByText('Failed to load content')).toBeVisible()

    await mobile.menu.choose('Sharing')
    await expect(page.getByText('Sign in to share your documents and receive what others share with you.')).toBeVisible()
    await mobile.menu.choose('Backup & Restore')
    await expect(page.getByRole('dialog').getByText('Data Center', { exact: true })).toBeVisible()
  })

  test('REG-848 while the "Can\'t reach MuulOrigin" banner shows, the open Menu sheet\'s bottom rows can still be tapped', { tag: '@P3' }, async ({ signedIn: _app, mobile, page }) => {
    knownDefect('DEF-803')
    // The first-run catalog load failed once already; a second failure raises the banner.
    await mobile.nav.tab('Catalog').click()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    const banner = page.getByRole('status').filter({ hasText: "Can't reach MuulOrigin" })
    await expect(banner).toBeVisible()
    await mobile.menu.open()
    for (const name of ['Help & support', 'Change PIN', 'Lock'] as const) {
      const row = mobile.menu.row(name)
      await row.scrollIntoViewIfNeeded()
      const box = (await row.boundingBox())!
      // What a finger at the row's centre would touch (a hit test only; nothing is clicked here).
      const onRow = await page.evaluate(([x, y, label]) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim() === label, [box.x + box.width / 2, box.y + box.height / 2, name] as const)
      expect(onRow, `${name} is reachable`).toBe(true)
    }
  })

  test('REG-815 Change PIN, Guided tour and Fullscreen work from the Menu sheet', { tag: '@P3' }, async ({ signedIn: app, mobile, page }) => {
    await mobile.menu.choose('Change PIN')
    await expect(app.changePin.dialog).toBeVisible()
    await app.changePin.dialog.getByRole('button', { name: 'Cancel', exact: true }).click() // persistent: no Escape
    await expect(app.changePin.dialog).toBeHidden()

    const tour = new TourCard(page)
    await mobile.menu.choose('Guided tour')
    await tour.expectStep(1, 6, 'Welcome to Cognitive Canvas')
    await tour.close.click()
    await expect(tour.card).toBeHidden()

    const fullscreen = () => page.evaluate(() => document.fullscreenElement === document.documentElement)
    await mobile.menu.choose('Fullscreen')
    await expect.poll(fullscreen).toBe(true)
    await mobile.menu.choose('Fullscreen')
    await expect.poll(fullscreen).toBe(false)
  })

  test('REG-816 signed out, the sheet\'s Sign in row goes to MuulOrigin sign-in with this page as the return address', { tag: '@P2' }, async ({ signedIn: _app, mobile, page, blockedRequests }) => {
    const href = page.url()
    const signin = page.waitForRequest((r) => r.url().startsWith('https://www.muulorigin.com/signin'))
    await mobile.menu.choose('Sign in')
    const url = new URL((await signin).url())
    expect(url.origin + url.pathname).toBe('https://www.muulorigin.com/signin')
    expect(url.searchParams.get('returnUrl')).toBe(href)
    expect(blockedRequests.some((r) => r.startsWith('GET https://www.muulorigin.com/signin?returnUrl='))).toBe(true)
  })
})

test.describe('Phone install (PWA)', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-817 without a browser install offer, Install app explains the benefits and the Android / Chrome steps, and its close button works', { tag: '@P3' }, async ({ signedIn: _app, mobile, page }) => {
    const banners = new ShellBanners(page)
    await mobile.menu.choose('Install app')
    await mobile.menu.expectClosed()
    await expect(banners.install).toBeVisible()
    for (const benefit of ['Its own window', 'Works offline', 'Starts instantly', 'Always up to date']) await expect(banners.install).toContainText(benefit)
    await expect(banners.install).toContainText('To install Cognitive Canvas as an app:')
    await expect(banners.install).toContainText('Firefox (Android): menu → Install.')
    await expect(banners.install).not.toContainText('Add to Home Screen" in the top-right') // not the iOS steps
    // Rendered outside the closed (pointer-events-none) sheet, so the tap reaches it.
    await banners.install.getByRole('button', { name: 'Close' }).click()
    await expect(banners.install).toBeHidden()
  })

  test('REG-818 the browser\'s install offer is caught as it arrives: its own banner is suppressed and the offer is kept for the Install row, nothing is prompted by itself', { tag: ['@P2'] }, async ({ signedIn: _app, mobile, page }) => {
    const banners = new ShellBanners(page)
    const offered = await offerInstall(page, 'accepted')
    expect(offered).toEqual({ defaultPrevented: true, stored: true })
    expect(await promptCalls(page)).toBe(0)
    await expect(banners.install).toBeHidden()
    await mobile.menu.open()
    await expect(mobile.menu.row('Install app')).toBeEnabled()
  })

  test('REG-819 with the install offer available, the phone\'s Install app shows why first and its single Install app button prompts the browser once, as on the desktop', { tag: '@P3' }, async ({ signedIn: _app, mobile, page }) => {
    knownDefect('DEF-802')
    const banners = new ShellBanners(page)
    await offerInstall(page, 'accepted')
    await mobile.menu.choose('Install app')
    await expect(banners.install).toContainText('Your browser will ask once to confirm. Takes a few seconds; nothing to download separately.')
    expect(await promptCalls(page)).toBe(0)
    await banners.install.getByRole('button', { name: 'Install app' }).click()
    await expect(banners.install).toBeHidden()
    expect(await promptCalls(page)).toBe(1)
  })
})

test.describe('Phone view notice', { tag: ['@regression', '@mobile'] }, () => {
  test.use({ viewNoticeSeen: false })

  test('REG-820 a phone is told it is in mobile view (no desktop-gesture warning); dismissing it is remembered across reloads', { tag: '@P3' }, async ({ app, page }) => {
    const banners = new ShellBanners(page)
    await app.open()
    await expect(banners.viewMode).toHaveText("You're viewing in mobile view.")
    await expect(banners.viewMode).not.toContainText('Some touch gestures may behave differently.')
    await banners.viewModeDismiss.click()
    await expect(banners.viewMode).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('cc2_view_alerted_at'))).toBe('mobile-view')
    await app.reload()
    await app.pinSetup.expectVisible()
    await expect(banners.viewMode).toBeHidden()
  })
})

test.describe('Phone Settings', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-821 Settings on a phone uses a section dropdown: it lists the sections, switches and remembers the one chosen, and an outside tap closes it unchanged', { tag: '@P3' }, async ({ signedIn: _app, mobile, page }) => {
    await mobile.menu.choose('Settings')
    await expect(mobile.settings.heading).toBeVisible()
    await expect(page.locator('nav').filter({ hasText: 'Appearance' })).toHaveCount(0) // no desktop rail
    await expect(mobile.settings.sectionPicker).toHaveAttribute('aria-expanded', 'false')
    await mobile.settings.sectionPicker.click()
    await expect(mobile.settings.sectionPicker).toHaveAttribute('aria-expanded', 'true')
    for (const label of ['Appearance', 'Language', 'Plan', 'Permissions', 'Shortcuts', 'Tool Guide', 'Support', 'Tutorials']) {
      await expect(mobile.settings.option(label)).toBeVisible()
    }
    await expect(mobile.settings.option('Team Members')).toHaveCount(0) // signed out
    await mobile.settings.option('Shortcuts').click()
    await expect(mobile.settings.sectionPicker).toHaveAttribute('aria-expanded', 'false')
    await expect(mobile.settings.sectionPicker).toContainText('Shortcuts')
    expect(await page.evaluate(() => sessionStorage.getItem('cc2_settings_tab'))).toBe('shortcuts')

    await mobile.settings.sectionPicker.click()
    await mobile.settings.listBackdrop.click({ position: { x: 10, y: 700 } })
    await expect(mobile.settings.sectionPicker).toHaveAttribute('aria-expanded', 'false')
    await expect(mobile.settings.sectionPicker).toContainText('Shortcuts')
  })

  test('REG-822 the Tool guide tells a phone user where the tools are (the dials) for the document and workspace sections only', { tag: '@P3' }, async ({ signedIn: _app, mobile, page }) => {
    await mobile.menu.choose('Tool guide')
    await page.getByRole('button', { name: /^Document Tools / }).click()
    await expect(page.getByText('On a phone the document tools are in the dial at the bottom-right of the Document tab. Entries marked "Desktop & tablet" describe controls the phone does not have.')).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).last().click()
    await page.getByRole('button', { name: /^Workspace Tools / }).click()
    await expect(page.getByText('On a phone the workspace tools are in the dial at the bottom-right of the Canvas tab; right-click and keyboard shortcuts need a mouse and keyboard.')).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).last().click()
    await page.getByRole('button', { name: /^Linking & Connections / }).click()
    await expect(page.getByRole('button', { name: 'Take the tour' })).toBeVisible()
    await expect(page.getByText(/^On a phone the/)).toHaveCount(0)
  })
})

backupTest.describe('Phone Menu sheet, signed in', { tag: ['@regression', '@mobile', '@api'] }, () => {
  backupTest.describe('on Pro', () => {
    backupTest.use({ muulPlan: 'pro' })
    backupTest('REG-823 signed in, the sheet opens on who you are (name, email, plan) as plain text, and Sign out asks first; Cancel keeps you signed in', { tag: '@P2' }, async ({ signedIn: _app, mobile, page, muul }) => {
      await mobile.menu.open()
      await expect(mobile.menu.root.getByText('Automation User', { exact: true })).toBeVisible()
      await expect(mobile.menu.root.getByText('automation.user@example.invalid', { exact: true })).toBeVisible()
      await expect(mobile.menu.root.getByText('Pro', { exact: true })).toHaveAttribute('title', "You're on the Pro plan")
      await expect(mobile.menu.row('Sign in')).toHaveCount(0)
      // The identity block is plain text, not a button that would navigate away.
      await expect(mobile.menu.root.getByRole('button', { name: /Automation User/ })).toHaveCount(0)
      await expect(mobile.menu.rows.last()).toHaveText('Sign out')

      await mobile.menu.row('Sign out').click()
      const confirm = page.getByRole('dialog', { name: 'Sign out?' })
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirm).toBeHidden()
      expect(await page.evaluate(() => localStorage.getItem('mo_token'))).toBe(muul.token)
      expect(muul.callsTo('POST', '/api/iam/auth/logout')).toHaveLength(0)
    })
  })

  backupTest.describe('on the free plan', () => {
    backupTest.use({ muulPlan: 'free' })
    backupTest('REG-824 a free account is badged Free in the sheet, never Pro', { tag: '@P3' }, async ({ signedIn: _app, mobile }) => {
      await mobile.menu.open()
      await expect(mobile.menu.root.getByText('Free', { exact: true })).toHaveAttribute('title', "You're on the free plan")
      await expect(mobile.menu.root.getByText('Pro', { exact: true })).toHaveCount(0)
    })
  })
})
