/**
 * Persistence sweep: a project holding every kind of content the app stores
 * (helpers/platformContent.ts, the same set REG-488 backs up) must come back
 * whole after each way a session can end:
 *
 *   a reload                                  PST-016
 *   closing every page and opening a new one  PST-017
 *   quitting the browser and starting it again (a real profile on disk)  PST-018
 *
 * "Whole" is proved twice: on screen (every kind visible again) and in
 * IndexedDB (every store, row by row, binary fields by SHA-256, compared with
 * the snapshot taken before; only reading-position stamps may move).
 *
 * Also: settings kept in localStorage survive a restart (PST-019), and
 * deleting a project leaves no row behind in any store (PST-020).
 */
import { test, expect } from '../../fixtures/test.js'
import { snapshotDb, expectSameLibrary, PROJECT_STORES, ofProject } from '../../helpers/backupState.js'
import { readStore } from '../../helpers/idb.js'
import { buildEveryKind, expectEveryKindOnScreen } from '../../helpers/platformContent.js'
import { browserProfile } from '../../helpers/platformBrowser.js'
import { snapshotAll } from '../../helpers/platformDb.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { LayoutSwitch, LAW_NAME } from '../../pages/ContentLaw.js'
import { LanguageSettings } from '../../pages/ShellPages.js'
import { tr } from '../../helpers/shell.js'
import { FIND_PDF } from '../../data/files.js'
import { ENV } from '../../config/env.js'
import { projectWithPdf } from '../../workflows/backup.js'

/** Building every kind, then reopening and checking it, is a long journey; the budget is for its length. */
const SWEEP_TIMEOUT = 300_000

test.describe('Persistence sweep', { tag: ['@regression', '@persistence'] }, () => {
  test('PST-016 every kind of content comes back after a reload, on screen and row for row', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, project }) => {
    test.setTimeout(SWEEP_TIMEOUT)
    const built = await buildEveryKind(app, page, project.name)
    expect(built.types).toEqual(['audio', 'image', 'line', 'note', 'text', 'video'])
    const before = await snapshotDb(page, PROJECT_STORES)
    await app.reload()
    await expectEveryKindOnScreen(app, page, built, project.name)
    expectSameLibrary(await snapshotDb(page, PROJECT_STORES), before, 'after a reload')
  })

  test('PST-017 every kind of content comes back after every page of the browser is closed and a new one is opened', { tag: '@P1' }, async ({ pdfOpen: app, page, project, context }) => {
    test.setTimeout(SWEEP_TIMEOUT)
    const built = await buildEveryKind(app, page, project.name)
    const before = await snapshotDb(page, PROJECT_STORES)
    await page.close()
    expect(context.pages()).toEqual([])

    const fresh = new CognitiveCanvas(await context.newPage())
    await fresh.open()
    // The unlock ended with the last page (PST-003); the data did not.
    await fresh.login.unlockWith(ENV.testPin)
    await expectEveryKindOnScreen(fresh, fresh.page, built, project.name)
    expectSameLibrary(await snapshotDb(fresh.page, PROJECT_STORES), before, 'after closing every page')
  })

  test('PST-018 every kind of content comes back after the browser is quit and started again on the same profile', { tag: ['@P1', '@sanity'] }, async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'launchPersistentContext is driven with Chromium here')
    test.setTimeout(SWEEP_TIMEOUT)
    const profile = browserProfile()
    try {
      const first = await profile.launch()
      const app = new CognitiveCanvas(first.page)
      await app.open()
      await app.pinSetup.createPin()
      await app.firstRunCatalogShown()
      await app.home.reach()
      await app.home.createProject('Restart Project')
      await app.documents.expectOpen('Restart Project')
      await app.documents.uploadFiles(FIND_PDF.payload())
      await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
      const built = await buildEveryKind(app, first.page, 'Restart Project')
      const before = await snapshotDb(first.page, PROJECT_STORES)
      await first.context.close()

      const second = await profile.launch()
      const again = new CognitiveCanvas(second.page)
      await again.open()
      await again.login.unlockWith(ENV.testPin)
      await expectEveryKindOnScreen(again, second.page, built, 'Restart Project')
      expectSameLibrary(await snapshotDb(second.page, PROJECT_STORES), before, 'after a browser restart')
      await second.context.close()
      expect(profile.errors, 'uncaught page errors').toEqual([])
    } finally {
      await profile.dispose()
    }
  })

  test('PST-019 theme, language, layout and tours already seen are all still set after the browser is quit and started again', { tag: '@P2' }, async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'launchPersistentContext is driven with Chromium here')
    test.setTimeout(SWEEP_TIMEOUT)
    const profile = browserProfile()
    try {
      const first = await profile.launch()
      const page = first.page
      const app = new CognitiveCanvas(page)
      await app.open()
      await app.pinSetup.createPin()
      await app.firstRunCatalogShown()
      await app.home.reach()
      await app.home.createProject('Settings Project')
      await app.documents.backToProjects.click()

      // Layout: the Legal layout (the switch reloads the app).
      const layout = new LayoutSwitch(page)
      await layout.open()
      await layout.switchTo('law')
      await expect(layout.headerName).toHaveText(LAW_NAME)
      // Theme: dark.
      await app.header.settings.click()
      await app.settings.openTab('Appearance')
      await app.settings.mode('Dark').click()
      await expect.poll(() => app.settings.isDark()).toBe(true)
      // A tour already seen: the guided tour's entry stops inviting a click.
      await app.header.home.click()
      await expect(app.header.guidedTour).toHaveClass(/tour-entry-pulse/)
      await app.header.guidedTour.click()
      await page.getByRole('button', { name: 'Close tour' }).click()
      await expect(app.header.guidedTour).not.toHaveClass(/tour-entry-pulse/)
      // Language last (it reloads into French).
      await app.header.settings.click()
      await app.settings.openTab('Language')
      await new LanguageSettings(page).tile('Français').click()
      await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Switch language' }).click()])
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('fr')
      const stored = await page.evaluate(() => ({
        locale: localStorage.getItem('cc2_locale'),
        theme: localStorage.getItem('cc-theme'),
        variant: localStorage.getItem('cc2_app_variant'),
        tour: localStorage.getItem('cc2_tour_global-tour_clicked'),
      }))
      expect(stored).toEqual({ locale: 'fr', theme: 'dark', variant: 'law', tour: '1' })
      await first.context.close()

      const second = await profile.launch()
      const p2 = second.page
      await p2.goto('/', { waitUntil: 'domcontentloaded' })
      // The unlock screen already speaks French, in the dark theme.
      await expect(p2.getByText(tr('fr', 'Enter your PIN to continue'))).toBeVisible({ timeout: 30_000 })
      expect(await p2.evaluate(() => ({ lang: document.documentElement.lang, dark: document.documentElement.classList.contains('dark') }))).toEqual({ lang: 'fr', dark: true })
      await p2.keyboard.type(ENV.testPin)
      await p2.getByRole('button', { name: tr('fr', 'Unlock'), exact: true }).click()
      const home = p2.getByRole('button', { name: tr('fr', 'Go to home') })
      await expect(home).toHaveText(LAW_NAME)
      await expect(p2.getByRole('button', { name: tr('fr', 'Start guided tour') })).not.toHaveClass(/tour-entry-pulse/)
      expect(await p2.evaluate(() => ({
        locale: localStorage.getItem('cc2_locale'),
        theme: localStorage.getItem('cc-theme'),
        variant: localStorage.getItem('cc2_app_variant'),
        tour: localStorage.getItem('cc2_tour_global-tour_clicked'),
      }))).toEqual(stored)
      await expect(p2.getByText('Settings Project', { exact: true })).toBeVisible()
      await second.context.close()
      expect(profile.errors, 'uncaught page errors').toEqual([])
    } finally {
      await profile.dispose()
    }
  })

  test('PST-020 deleting a project removes every row that belongs to it from every store, and leaves the other project exactly as it was', { tag: ['@P1'] }, async ({ pdfOpen: app, page, project }) => {
    test.setTimeout(SWEEP_TIMEOUT)
    const built = await buildEveryKind(app, page, project.name)
    await app.header.home.click()
    const keeper = await projectWithPdf(app, page, 'Keeper Project')
    const all = await snapshotAll(page)
    const keeperBefore = ofProject(await snapshotDb(page, PROJECT_STORES), keeper.projectId)

    // Every id that belongs to the doomed project, in any store.
    const doomedIds = new Set<string>([built.projectId])
    for (const [store, rows] of Object.entries(all.rows)) {
      if (['users', 'lawEvents'].includes(store)) continue
      for (const r of rows) if (r.projectId === built.projectId) doomedIds.add(String(r.id ?? r.key))
    }
    expect(doomedIds.size, 'the project really holds content').toBeGreaterThan(25)
    expect(all.rows.binaryIndex!.filter((r) => r.projectId === built.projectId).length, 'its files are indexed').toBeGreaterThanOrEqual(6)

    await app.home.deleteProject(project.name)
    await expect(app.home.card(project.name)).toHaveCount(0)
    await expect(app.home.card('Keeper Project')).toBeVisible()

    await expect.poll(async () => {
      const after = await snapshotAll(page)
      const left: string[] = []
      for (const [store, rows] of Object.entries(after.rows)) {
        for (const r of rows) {
          const text = JSON.stringify(r)
          for (const id of doomedIds) if (text.includes(id)) left.push(`${store}: ${text.slice(0, 160)}`)
        }
      }
      return [...new Set(left)]
    }, { message: 'rows still naming the deleted project or its records', timeout: 15_000 }).toEqual([])

    // The other project is untouched, row for row.
    const keeperAfter = ofProject(await snapshotDb(page, PROJECT_STORES), keeper.projectId)
    expectSameLibrary(keeperAfter, keeperBefore, 'the project that was kept')
    expect((await readStore<{ id: string }>(page, 'projects')).map((p) => p.id)).toEqual([keeper.projectId])
  })
})
