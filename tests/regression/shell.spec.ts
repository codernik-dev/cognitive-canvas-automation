/**
 * Regression: the app shell around every screen: the global bar
 * (GlobalSettingsBar.tsx), the install hint, the "Can't reach MuulOrigin"
 * banner (ApiOfflineBanner), the touch-device view notice
 * (ViewModeNotification), the Esc hint (EscHint), toasts, the browser Back
 * guard (BackNavigationGuard) and the same-device tab mirror (CrossTabMirror).
 */
import { test, expect } from '../../fixtures/shell.js'
import { FIND_PDF } from '../../data/files.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { knownDefect } from '../../helpers/defects.js'
import { ShellBanners } from '../../pages/ShellPages.js'
import { SCRIPT_SAMPLES } from '../../data/shell-files.js'

test.describe('Global bar', { tag: ['@regression', '@shell'] }, () => {
  test('REG-689 the bar\'s buttons reach Catalog, Data Center, Storage and Settings, Backup & Restore is on the project list only, and the logo goes home from anywhere', { tag: ['@P2', '@sanity'] }, async ({ signedIn: app, shell, page }) => {
    await expect(app.header.home).toHaveText('Cognitive Canvas')
    await expect(shell.banners.viewMode).toBeHidden() // not a touch device

    await app.header.exploreContent.click()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    await expect(app.header.exploreContent).toHaveClass(/bg-primary-500\/15/) // shown as the current screen
    await app.header.home.click()
    await expect(app.home.newProjectName).toBeVisible()

    await app.header.backupRestore.click()
    await expect(app.dataCenter.modeToggle('Backup')).toBeVisible()
    await app.dataCenter.dialog.getByRole('button', { name: 'Close' }).click() // persistent: Escape does not close it
    await expect(app.dataCenter.modeToggle('Backup')).toBeHidden()

    await app.header.storage.click()
    const storage = page.getByRole('dialog', { name: 'Storage' })
    await expect(storage).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(storage).toBeHidden()

    await app.home.createProject('Bar Project')
    await app.documents.expectOpen('Bar Project')
    await expect(app.header.backupRestore).toBeHidden() // a library-level action, not inside a project
    await expect(app.header.exploreContent).toBeHidden()
    await app.header.settings.click()
    await app.settings.expectOpen()
    await app.header.home.click()
    await expect(app.settings.heading).toBeHidden()
    await expect(app.home.card('Bar Project')).toBeVisible()
  })

  test('REG-690 Toggle fullscreen enters and leaves fullscreen', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    const fullscreen = () => page.evaluate(() => document.fullscreenElement === document.documentElement)
    await page.getByRole('button', { name: 'Toggle fullscreen' }).click()
    await expect.poll(fullscreen).toBe(true)
    await page.getByRole('button', { name: 'Toggle fullscreen' }).click()
    await expect.poll(fullscreen).toBe(false)
  })

  test('REG-691 Install app explains why and how to install; with the browser\'s own prompt available it offers a single Install button', { tag: '@P3' }, async ({ signedIn: _app, shell, page }) => {
    const install = page.getByRole('button', { name: 'Install app' })
    await expect(install).toHaveAttribute('title', 'Install as app')
    await install.click()
    for (const benefit of ['Its own window', 'Works offline', 'Starts instantly', 'Always up to date']) await expect(shell.banners.install).toContainText(benefit)
    await expect(shell.banners.install).toContainText('To install Cognitive Canvas as an app:')
    await expect(shell.banners.install).toContainText('Chrome / Edge: click the install icon in the address bar.')
    await shell.banners.install.getByRole('button', { name: 'Close' }).click()
    await expect(shell.banners.install).toBeHidden()

    // Chromium fires `beforeinstallprompt` only for an installable, engaged site; Playwright
    // cannot produce it, so the event is emulated with the two members the app uses.
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => void; userChoice: Promise<unknown> }
      ;(window as unknown as { __promptCalls: number }).__promptCalls = 0
      e.prompt = () => { (window as unknown as { __promptCalls: number }).__promptCalls++ }
      e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })
      window.dispatchEvent(e)
    })
    await install.click()
    await expect(shell.banners.install).toContainText('Your browser will ask once to confirm. Takes a few seconds; nothing to download separately.')
    await expect(shell.banners.install).not.toContainText('To install Cognitive Canvas as an app:')
    await shell.banners.install.getByRole('button', { name: 'Install app' }).click()
    await expect(shell.banners.install).toBeHidden()
    expect(await page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls)).toBe(1)
  })
})

test.describe('Banners, hints and toasts', { tag: ['@regression', '@shell'] }, () => {
  test('REG-692 the "Can\'t reach MuulOrigin" banner appears after the second failed request, says the local work is safe, and can be dismissed', { tag: '@P2' }, async ({ signedIn: app, shell, page }) => {
    // So far one request has failed (the first-run Catalog load): a blip, and the banner stays quiet.
    await expect(app.home.newProjectName).toBeVisible()
    await expect(shell.banners.apiOffline).toBeHidden()
    await app.header.exploreContent.click()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    await expect(shell.banners.apiOffline).toBeVisible()
    await expect(shell.banners.apiOffline).toContainText('Sharing, cloud backup and team members are unavailable until the connection is back. Everything on this device is safe — keep working, and it will catch up on its own.')
    await shell.banners.apiOffline.getByRole('button', { name: 'Dismiss' }).click()
    await expect(shell.banners.apiOffline).toBeHidden()
    await page.getByRole('button', { name: 'Try Again' }).click()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    await expect(shell.banners.apiOffline).toBeHidden() // dismissed for this outage
  })

  test('REG-694 the note editor shows "Esc to close" when it opens and the hint goes away by itself', { tag: '@P3' }, async ({ pdfOpen: app, shell, page }) => {
    const note = (await app.canvas.place('note', 0.5, 0.4))!
    await app.canvas.openNoteEditor(note)
    await expect(shell.banners.escHint).toBeVisible()
    await expect(shell.banners.escHint).toHaveText('Esc to close')
    await expect(shell.banners.escHint).toBeHidden({ timeout: 10_000 }) // 2.4 s on screen + 0.5 s fade
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Edit Note' })).toBeHidden()
  })
})

test.describe('Touch device notice', { tag: ['@regression', '@shell'] }, () => {
  test.use({ hasTouch: true })

  test('REG-693 a touch screen on the desktop site is told it is in desktop view; dismissing is remembered, and it hides by itself after 7 s', { tag: '@P3' }, async ({ app, shell, page }) => {
    await page.clock.install()
    await app.open()
    await expect(shell.banners.viewMode).toHaveText("You're viewing in desktop view. Some touch gestures may behave differently.")
    await page.clock.runFor(7_500)
    await expect(shell.banners.viewMode).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('cc2_view_alerted_at'))).toBeNull() // hiding is not dismissing

    await app.reload()
    await expect(shell.banners.viewMode).toBeVisible()
    await shell.banners.viewModeDismiss.click()
    await expect(shell.banners.viewMode).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('cc2_view_alerted_at'))).toBe('desktop-view')
    await app.reload()
    await app.pinSetup.expectVisible()
    await expect(shell.banners.viewMode).toBeHidden()
  })
})

test.describe('Browser Back', { tag: ['@regression', '@shell'] }, () => {
  test('REG-696 "Go back" in the leave dialog returns to the page the app was opened from', { tag: '@P2' }, async ({ app, shell, page }) => {
    await page.goto('data:text/html,<title>Previous page</title><h1>Previous page</h1>')
    await app.open()
    await app.pinSetup.createPin()
    await app.firstRunCatalogShown()
    await page.goBack({ waitUntil: 'commit' })
    await expect(shell.banners.leave).toContainText('Are you sure you want to go back? This closes Cognitive Canvas and returns you to the previous page. Your work is saved on this device.')
    await shell.banners.leave.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Previous page' })).toBeVisible()
    expect(page.url()).toMatch(/^data:text\/html/)
  })

  test('REG-697 with nothing behind the app, Go back says to press Back once more; with the note editor open Back closes and saves the note instead of asking', { tag: '@P3' }, async ({ pdfOpen: app, shell, page, context }) => {
    // A tab opened straight onto the app has nothing behind it. A Playwright page
    // always starts on about:blank, so the fresh tab is opened the way a link would.
    const [tab] = await Promise.all([context.waitForEvent('page'), page.evaluate(() => { window.open('/') })])
    const fresh = new CognitiveCanvas(tab)
    await expect(fresh.header.home).toBeVisible()
    await tab.goBack({ waitUntil: 'commit' })
    await new ShellBanners(tab).leave.getByRole('button', { name: 'Go back' }).click()
    await fresh.toasts.expectShown('Press Back once more to leave Cognitive Canvas')
    await fresh.toasts.withText('Press Back once more to leave Cognitive Canvas').click() // a toast closes on click
    await expect(fresh.toasts.withText('Press Back once more to leave Cognitive Canvas')).toBeHidden()
    await expect(fresh.header.home).toBeVisible() // still in the app
    await tab.close()

    const note = (await app.canvas.place('note', 0.5, 0.4))!
    const editor = await app.canvas.openNoteEditor(note)
    await editor.locator('[contenteditable="true"]').first().click()
    await page.keyboard.type('Saved by Back')
    await page.goBack({ waitUntil: 'commit' })
    await expect(editor).toBeHidden()
    await expect(shell.banners.leave).toBeHidden()
    await expect.poll(async () => JSON.stringify((await readStore(page, 'workspaceItems')).find((i) => i.id === note))).toContain('Saved by Back')
  })
})

test.describe('Tabs of the same browser', { tag: ['@regression', '@shell', '@persistence'] }, () => {
  test('REG-698 projects created, renamed or deleted in one tab are mirrored in the other; a project deleted while open elsewhere closes there with a notice', { tag: '@P2' }, async ({ signedIn: app, context }) => {
    await app.home.createProject('Mirror Seed')
    await app.documents.backToProjects.click()
    const other = new CognitiveCanvas(await context.newPage())
    await other.open()
    await other.home.reach()
    await expect(other.home.card('Mirror Seed')).toBeVisible()

    await app.home.createProject('Made In Tab One')
    await app.documents.backToProjects.click()
    await expect(other.home.card('Made In Tab One')).toBeVisible()
    await app.home.renameProject('Made In Tab One', 'Renamed In Tab One')
    await expect(other.home.card('Renamed In Tab One')).toBeVisible()
    await expect(other.home.card('Made In Tab One')).toHaveCount(0)

    await other.home.openProject('Mirror Seed')
    await other.documents.expectOpen('Mirror Seed')
    await app.home.deleteProject('Mirror Seed')
    await other.toasts.expectShown('This project was deleted in another tab')
    await expect(other.home.newProjectName).toBeVisible()
    await expect(other.home.card('Mirror Seed')).toHaveCount(0)
    await expect(other.home.card('Renamed In Tab One')).toBeVisible()
  })

  test('REG-699 a note placed in one tab appears on the same document\'s canvas in the other', { tag: '@P2' }, async ({ pdfOpen: app, context, page }) => {
    const other = new CognitiveCanvas(await context.newPage())
    await other.open()
    await other.home.reach()
    await other.home.openProject('Automation Project')
    await other.documents.openDocument(FIND_PDF.displayName)
    await other.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)

    const note = (await app.canvas.place('note', 0.5, 0.4))!
    await app.canvas.writeNote(note, 'Mirrored note text')
    await expectStoreCount(page, 'workspaceItems', 1)
    await expect(other.canvas.item(note)).toBeVisible()
    await expect(other.canvas.item(note)).toContainText('Mirrored note text')
  })
})

test.describe('Pop-up accessibility', { tag: ['@regression', '@shell', '@a11y'] }, () => {
  test('REG-614 the Install app dialog and the language offer are announced by name, like every other dialog', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    knownDefect('DEF-602')
    await page.getByRole('button', { name: 'Install app' }).click()
    await expect(shell.banners.install).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Install Cognitive Canvas' })).toBeVisible()
    await page.keyboard.press('Escape')

    await app.home.newProjectName.fill(SCRIPT_SAMPLES.hindi)
    await expect(shell.languageOffer.dialog).toBeVisible()
    await expect(shell.languageOffer.dialog).toHaveAccessibleName(/हिन्दी/)
  })
})
