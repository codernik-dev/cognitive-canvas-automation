/**
 * Regression: the crash screen (components/shared/AppErrorBoundary.tsx, wired in
 * bootstrap.tsx; the staged report is opened by App.tsx in Settings › Support).
 *
 * A render crash is caused on purpose: an init script wraps
 * Date.prototype.toLocaleDateString so it throws while `window.__e2eCrash` is
 * set. The Home project card formats its date with it (ProjectCard.tsx), so
 * coming back to Home with the flag set crashes that render, exactly as a real
 * component bug would. Nothing in the app is changed; the flag lives only in
 * the test's page.
 */
import { supportTest as test, expect } from '../../fixtures/content.js'
import { SupportPanel } from '../../pages/ContentSupport.js'
import type { Page } from '@playwright/test'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

const CRASH = 'e2e render crash'

async function armCrash(page: Page) {
  await page.addInitScript((message) => {
    const original = Date.prototype.toLocaleDateString
    Date.prototype.toLocaleDateString = function (this: Date, ...args: Parameters<Date['toLocaleDateString']>) {
      if ((window as unknown as { __e2eCrash?: boolean }).__e2eCrash) throw new Error(message)
      return original.apply(this, args)
    }
  }, CRASH)
}

const setCrash = (page: Page, on: boolean) => page.evaluate((v) => { (window as unknown as { __e2eCrash?: boolean }).__e2eCrash = v }, on)

/** A project on Home, then back to Home with the crash armed: the project card's render throws. */
async function crashOnHome(app: CognitiveCanvas, page: Page) {
  await app.home.createProject('Crash Test')
  await setCrash(page, true)
  await app.header.home.click()
}

function crashScreen(page: Page) {
  const alert = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Something went wrong' }) })
  return {
    alert,
    heading: alert.getByRole('heading', { name: 'Something went wrong', level: 1 }),
    error: alert.locator('pre'),
    reload: alert.getByRole('button', { name: 'Reload', exact: true }),
    tryAgain: alert.getByRole('button', { name: 'Try again', exact: true }),
    copy: alert.getByRole('button', { name: /^(Copy diagnostics|Copied)$/ }),
    report: alert.getByRole('button', { name: 'Report to support', exact: true }),
  }
}

test.describe('Crash screen', { tag: ['@regression', '@shell'] }, () => {
  test.beforeEach(async ({ page }) => { await armCrash(page) })

  test.describe('clipboard', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

    test('REG-943 a render crash shows "Something went wrong" with the error, copies full diagnostics, and Try again recovers once the fault is gone', { tag: '@P2' }, async ({ signedIn: app, page }) => {
      await crashOnHome(app, page)
      const screen = crashScreen(page)
      await expect(screen.heading).toBeVisible()
      await expect(screen.alert).toContainText('The screen hit an error it couldn\'t recover from. Your work is saved as you go, so reloading is safe. If it keeps happening, copy the diagnostics and send them to support.')
      await expect(screen.error).toHaveText(`Error: ${CRASH}`)
      await expect(screen.alert).toContainText(/Build \S+/)
      await expect(screen.report).toHaveAttribute('title', 'Reloads, then opens a support ticket with these diagnostics filled in')
      await expect(app.home.card('Crash Test')).toHaveCount(0) // the crashed screen is gone, not drawn behind

      await screen.copy.click()
      await expect(screen.copy).toHaveText('Copied')
      const report = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n') // the OS clipboard may store CRLF
      const lines = report.split('\n')
      expect(lines[0]).toBe('Cognitive Canvas crash report')
      expect(lines[1]).toMatch(/^build: \S+/)
      expect(lines[2]).toMatch(/^time: \d{4}-\d\d-\d\dT/)
      expect(lines[3]).toMatch(/^url: http:\/\/127\.0\.0\.1:\d+\//)
      expect(lines).toContain(`error: Error: ${CRASH}`)
      expect(report).toMatch(/^stack:\nError: e2e render crash/m)
      expect(report).toMatch(/^component stack:\s*\n\s+at \S+/m) // names are minified in the production build
      expect(report).toMatch(/^--- last \d+ log lines ---$/m)
      expect(report).toContain('[KEEP-LOG][crash] render error')

      // Try again re-renders the same screen: with the fault still there it crashes again, honestly.
      await screen.tryAgain.click()
      await expect(screen.heading).toBeVisible()
      await expect(screen.copy).toHaveText('Copy diagnostics') // a fresh crash, not the old "Copied"

      // Fault gone: Try again brings the app back, with the project still there.
      await setCrash(page, false)
      await screen.tryAgain.click()
      await expect(screen.alert).toBeHidden()
      await app.home.reach()
      await expect(app.home.card('Crash Test')).toBeVisible()
    })
  })

  test('REG-944 Report to support reloads, then opens Settings › Support with the crash filled in as a new ticket, once', { tag: '@P2' }, async ({ signedIn: app, page, support: _support }) => {
    await crashOnHome(app, page)
    const screen = crashScreen(page)
    await expect(screen.heading).toBeVisible()
    await Promise.all([page.waitForEvent('load'), screen.report.click()]) // reloads: the init script stays, the flag does not
    const panel = new SupportPanel(page)
    await expect(panel.subject).toHaveValue(`Crash: Error: ${CRASH}`, { timeout: 30_000 })
    const description = await panel.description.inputValue()
    expect(description.split(/\r?\n/)[0].trimEnd()).toBe('Cognitive Canvas crash report')
    expect(description).toContain(`error: Error: ${CRASH}`)
    expect(description).toMatch(/^component stack:\s*\n\s+at \S+/m)
    expect(await page.evaluate(() => sessionStorage.getItem('cc2_crash_report')), 'one shot: the staged report is cleared').toBeNull()

    // Not offered again on the next load.
    await page.keyboard.press('Escape')
    await app.reload()
    await app.home.reach()
    await expect(app.home.card('Crash Test')).toBeVisible()
    await expect(panel.subject).toHaveCount(0)
  })
})
