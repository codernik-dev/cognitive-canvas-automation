/**
 * Regression: tutorial videos (config/tutorialVideos.ts, TutorialVideoButton,
 * TutorialVideoModal, Settings › Tutorials).
 *
 * The videos stream from YouTube, which the network guard refuses, so what
 * is proved is what the app controls: which videos are listed, that each
 * opens a player titled with that video, that the player loads the right
 * embed URL (and the browser really asked youtube.com for it), the per-screen
 * header buttons, their first-use pulse, and what the player says offline.
 */
import { test, expect } from '../../fixtures/shell.js'
import { TUTORIAL_LIBRARY, SCREEN_TUTORIALS, embedSrc } from '../../data/shell-files.js'
import { blockedTo } from '../../helpers/shell.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF } from '../../data/files.js'

test.describe('Tutorial videos', { tag: ['@regression', '@tutorials'] }, () => {
  test('REG-672 Settings › Tutorials lists all sixteen videos in their groups and each opens its own YouTube player', { tag: ['@P2', '@sanity'] }, async ({ signedIn: app, shell, page, blockedRequests }) => {
    await app.header.settings.click()
    await app.settings.openTab('Tutorials')
    await expect(page.getByRole('heading', { name: 'Tutorial videos', level: 3 })).toBeVisible()
    await expect(page.getByText('Short how-to videos for each part of the app. More are on the way.')).toBeVisible()
    await expect(shell.tutorial.libraryGroups).toHaveText(TUTORIAL_LIBRARY.map((g) => g.group))
    const entries = TUTORIAL_LIBRARY.flatMap((g) => g.entries)
    const buttons = shell.tutorial.libraryEntries
    await expect(buttons).toHaveText(entries.map((e) => `${e.label}${e.title}`))

    for (const [i, e] of entries.entries()) {
      await buttons.nth(i).click()
      await expect(shell.tutorial.dialog(e.title)).toBeVisible()
      await expect(shell.tutorial.frame(e.title)).toHaveAttribute('src', embedSrc(e.youtubeId))
      await expect.poll(() => blockedTo(blockedRequests, 'www.youtube.com')).toContain(`GET ${embedSrc(e.youtubeId)}`)
      await page.keyboard.press('Escape')
      await expect(shell.tutorial.dialog(e.title)).toBeHidden()
    }
  })

  test('REG-673 the Home header button plays the home-screen video, pulses until first used, and remembers that per screen', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    // A project in the library: an empty one reopens the Catalog after a reload (OBS-009).
    await app.home.createProject('Tutorial Project')
    await app.documents.backToProjects.click()
    const home = SCREEN_TUTORIALS.home
    const button = shell.tutorial.button(home.title)
    await expect(button).toHaveAttribute('title', `Watch: ${home.title}`)
    await expect(button).toHaveClass(/tour-entry-pulse/)
    await button.click()
    await expect(shell.tutorial.frame(home.title)).toHaveAttribute('src', embedSrc(home.youtubeId))
    await shell.tutorial.dialog(home.title).getByRole('button', { name: 'Close' }).click()
    await expect(shell.tutorial.dialog(home.title)).toBeHidden()
    await expect(button).not.toHaveClass(/tour-entry-pulse/)
    expect(await page.evaluate(() => localStorage.getItem('cc2_tour_tutorial-home_clicked'))).toBe('1')
    await app.reload()
    await expect(button).not.toHaveClass(/tour-entry-pulse/)

    // The same header slot serves the Catalog with its own video, still unwatched there.
    await app.header.exploreContent.click()
    const catalog = shell.tutorial.button(SCREEN_TUTORIALS.catalog.title)
    await expect(catalog).toBeVisible()
    await expect(button).toBeHidden()
    await expect(catalog).toHaveClass(/tour-entry-pulse/)
  })

  test('REG-674 the PIN setup screen and the project screens have their own video; the unlock screen and Settings have none', { tag: '@P3' }, async ({ app, shell, page }) => {
    await app.open()
    const pin = SCREEN_TUTORIALS.pin
    await shell.tutorial.button(pin.title).click()
    await expect(shell.tutorial.frame(pin.title)).toHaveAttribute('src', embedSrc(pin.youtubeId))
    await page.keyboard.press('Escape')
    await app.pinSetup.createPin()
    await app.firstRunCatalogShown()
    await app.home.reach()

    await app.home.createProject('Video Project')
    const ws = SCREEN_TUTORIALS.workspace
    await expect(shell.tutorial.button(ws.title)).toBeVisible() // the document list
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await shell.tutorial.button(ws.title).click()
    await expect(shell.tutorial.frame(ws.title)).toHaveAttribute('src', embedSrc(ws.youtubeId))
    await page.keyboard.press('Escape')

    await app.header.settings.click()
    await app.settings.expectOpen()
    await expect(page.getByRole('button', { name: /^Watch tutorial:/ })).toHaveCount(0)
    await app.settings.back.click()
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    await expect(page.getByRole('button', { name: /^Watch tutorial:/ })).toHaveCount(0)
  })

  test('REG-675 offline, a tutorial says it did not load and offers the YouTube link instead of a black player', { tag: '@P2' }, async ({ signedIn: _app, shell, page }) => {
    knownDefect('DEF-601')
    const home = SCREEN_TUTORIALS.home
    await page.clock.install()
    await shell.tutorial.button(home.title).click()
    await expect(shell.tutorial.dialog(home.title)).toBeVisible()
    // TutorialVideoModal gives a blocked/offline embed 12 s before saying so.
    await page.clock.runFor(12_500)
    await expect(shell.tutorial.failed(home.title)).toBeVisible()
    await expect(shell.tutorial.dialog(home.title)).toContainText("The tutorials stream from YouTube, so they need a connection — and they won't play at all offline. Nothing else in Cognitive Canvas is affected.")
    await expect(shell.tutorial.openOnYouTube(home.title)).toHaveAttribute('href', `https://youtu.be/${home.youtubeId}`)
  })
})
