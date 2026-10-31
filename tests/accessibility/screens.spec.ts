/**
 * Accessibility, screen by screen: axe-core (WCAG 2.0/2.1 A + AA) on every
 * major screen and dialog that A11Y-001..006 do not scan. The gate here is
 * stricter than a11y.spec.ts: no CRITICAL and no SERIOUS violations. Every
 * violation of any impact is attached to the report (helpers/platformA11y.ts).
 *
 * Dialogs are scanned on their own (the page behind them is scanned by its
 * own test), so a finding is attributed to the screen that has it.
 *
 * A screen with a genuine violation keeps asserting "none" and names the
 * defect: one DEF per axe rule, listing every screen it affects
 * (helpers/defects.ts), not one per element.
 *
 * Signed-in screens (Sharing, Support) use fixtures/platform.ts, which mocks
 * the MuulOrigin account and every service; the rest run signed out.
 */
import { devices } from '@playwright/test'
import { test, expect } from '../../fixtures/platform.js'
import { knownDefect, type DefectId } from '../../helpers/defects.js'
import { seriousViolations, markForScan } from '../../helpers/platformA11y.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { CatalogApi, always } from '../../helpers/mocks/contentCatalog.js'
import { CATALOG_ITEMS } from '../../data/content-files.js'
import { CatalogScreen } from '../../pages/ContentCatalog.js'
import { LawCalendarDialog } from '../../pages/ContentLaw.js'
import { SharingScreen, ShareComposerDialog } from '../../pages/SharingScreen.js'
import { SupportPanel } from '../../pages/ContentSupport.js'
import { ScannerModal } from '../../pages/DocumentsScanner.js'
import { TourCard, SystemCheck, QuickSearch, ShellBanners } from '../../pages/ShellPages.js'
import { OcrDialog } from '../../components/DocumentsOcr.js'
import { CanvasDialogs } from '../../components/CanvasWorkbench.js'
import { StorageScreens } from '../../pages/BackupScreens.js'
import { FIND_PDF, TEXT_FILES } from '../../data/files.js'
import { ENV } from '../../config/env.js'
import type { SettingsTab } from '../../pages/SettingsPage.js'
import type { Page, TestInfo } from '@playwright/test'

/** Scan, then assert nothing critical or serious was found. */
async function expectClean(page: Page, testInfo: TestInfo, name: string, opts: { include?: string; exclude?: string } = {}) {
  const ids = await seriousViolations(page, testInfo, name, opts)
  testInfo.annotations.push({ type: 'axe', description: `${name}: ${ids.join(', ') || 'clean'}` })
  expect(ids, `critical/serious axe rules on ${name}`).toEqual([])
}

test.describe('Screens, signed out', { tag: ['@regression', '@a11y'] }, () => {
  test.use({ muulPlan: null })

  test('A11Y-008 the unlock screen has no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    await page.evaluate(() => sessionStorage.clear())
    await app.reload()
    await app.login.expectVisible()
    await expectClean(page, testInfo, 'unlock')
  })

  const TABS: [string, SettingsTab][] = [
    ['A11Y-009', 'Appearance'], ['A11Y-010', 'Language'], ['A11Y-011', 'Plan'], ['A11Y-012', 'Permissions'],
    ['A11Y-013', 'Shortcuts'], ['A11Y-014', 'Tool Guide'], ['A11Y-015', 'Support'], ['A11Y-016', 'Tutorials'],
  ]
  // Settings tabs with a known finding (A11Y-009, 010, 012, 015 low contrast; 013 a scroll area keyboard users cannot reach).
  const TAB_DEFECTS: Partial<Record<SettingsTab, DefectId[]>> = {
    Appearance: ['DEF-910'], Language: ['DEF-910'], Permissions: ['DEF-910'], Support: ['DEF-910'], Shortcuts: ['DEF-913'],
  }
  for (const [id, tab] of TABS) {
    test(`${id} Settings › ${tab} has no critical or serious accessibility violations`, { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
      for (const d of TAB_DEFECTS[tab] ?? []) knownDefect(d)
      await app.header.settings.click()
      await app.settings.expectOpen()
      await app.settings.openTab(tab)
      await expect(app.settings.tab(tab)).toBeVisible()
      await expectClean(page, testInfo, `settings-${tab.toLowerCase().replace(' ', '-')}`)
    })
  }

  test('A11Y-017 the Data Center destination chooser has no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.dataCenter.openFromHeader()
    await expect(app.dataCenter.chooserHeading).toBeVisible()
    await expectClean(page, testInfo, 'data-center-chooser', { include: await markForScan(app.dataCenter.dialog, 'dc') })
  })

  test('A11Y-018 the Data Center Local export view has no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.home.createProject('Scanned Project')
    await app.documents.backToProjects.click()
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Backup', 'Local')
    await expect(app.dataCenter.exportHeading).toBeVisible()
    await expectClean(page, testInfo, 'data-center-local-export', { include: await markForScan(app.dataCenter.dialog, 'dc') })
  })

  test('A11Y-019 the Data Center Local restore view has no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Restore', 'Local')
    await expect(app.dataCenter.restoreHeading).toBeVisible()
    await expectClean(page, testInfo, 'data-center-local-restore', { include: await markForScan(app.dataCenter.dialog, 'dc') })
  })

  test('A11Y-020 the Data Center Cloud and GitHub sign-in gates have no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Backup', 'Cloud')
    await expect(app.dataCenter.gateHeading).toBeVisible()
    const dc = await markForScan(app.dataCenter.dialog, 'dc')
    const cloud = await seriousViolations(page, testInfo, 'data-center-cloud-gate', { include: dc })
    await app.dataCenter.sidebarSource('GitHub').click()
    await expect(app.dataCenter.gateHeading.or(app.dataCenter.openInMoBrowser)).toBeVisible()
    const github = await seriousViolations(page, testInfo, 'data-center-github', { include: dc })
    expect({ cloud, github }).toEqual({ cloud: [], github: [] })
  })

  test('A11Y-021 the Data Center Auto Backup page has no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.dataCenter.openFromHeader()
    await app.dataCenter.choose('Backup', 'Auto Backup')
    await expect(app.dataCenter.autoChild('Cloud')).toBeVisible()
    await expectClean(page, testInfo, 'data-center-auto-backup', { include: await markForScan(app.dataCenter.dialog, 'dc') })
  })

  test('A11Y-022 the Catalog listing and a category have no critical or serious accessibility violations', { tag: '@P2' }, async ({ app, page }, testInfo) => {
    knownDefect('DEF-910')
    await CatalogApi.install(page, always(CATALOG_ITEMS))
    const catalog = new CatalogScreen(page)
    await app.open()
    await app.pinSetup.createPin()
    await catalog.expectSettled()
    await expect(catalog.hero).toBeVisible()
    const listing = await seriousViolations(page, testInfo, 'catalog')
    await catalog.openCategory('Science')
    const category = await seriousViolations(page, testInfo, 'catalog-science')
    expect({ listing, category }).toEqual({ listing: [], category: [] })
  })

  test('A11Y-023 the Legal layout calendar and its day dialog have no critical or serious accessibility violations', { tag: '@P2' }, async ({ app, page }, testInfo) => {
    knownDefect('DEF-910')
    knownDefect('DEF-911')
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__a11y_law')) return
      sessionStorage.setItem('__a11y_law', '1')
      localStorage.setItem('cc2_app_variant', 'law')
    })
    await app.open()
    await app.pinSetup.createPin()
    await app.firstRunCatalogShown()
    await app.home.reach()
    const cal = new LawCalendarDialog(page)
    await cal.openIt()
    const calendar = await seriousViolations(page, testInfo, 'law-calendar', { include: await markForScan(cal.dialog, 'cal') })
    await cal.day(15).click()
    const day = page.getByRole('dialog').filter({ has: page.getByPlaceholder('e.g. Hearing — Sharma v. State') })
    await expect(day).toBeVisible()
    const dayIds = await seriousViolations(page, testInfo, 'law-day', { include: await markForScan(day, 'day') })
    expect({ calendar, day: dayIds }).toEqual({ calendar: [], day: [] })
  })

  test('A11Y-024 the note editor has no critical or serious accessibility violations', { tag: '@P2' }, async ({ pdfOpen: app, page }, testInfo) => {
    knownDefect('DEF-910')
    const note = (await app.canvas.place('note', 0.5, 0.4))!
    const editor = await app.canvas.openNoteEditor(note)
    await expectClean(page, testInfo, 'note-editor', { include: await markForScan(editor, 'editor') })
  })

  test('A11Y-025 the OCR dialog has no critical or serious accessibility violations', { tag: '@P2' }, async ({ pdfOpen: app, page }, testInfo) => {
    knownDefect('DEF-910')
    knownDefect('DEF-912')
    const ocr = new OcrDialog(page)
    await app.viewer.tool('ocr').click()
    await ocr.expectOpen()
    await expectClean(page, testInfo, 'ocr-dialog', { include: await markForScan(ocr.root, 'ocr') })
  })

  test('A11Y-026 the image editor has no critical or serious accessibility violations', { tag: '@P2' }, async ({ pdfOpen: app, page }, testInfo) => {
    knownDefect('DEF-910')
    knownDefect('DEF-911')
    await app.viewer.tool('extract-image').click()
    await app.viewer.dragOnPage(1, [0.1, 0.1], [0.6, 0.3])
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'image')
    const image = (await readStore<{ id: string; type: string }>(page, 'workspaceItems')).find((r) => r.type === 'image')!
    await app.canvas.item(image.id).locator('img').dblclick()
    const editor = new CanvasDialogs(page).imageEditor
    await expect(editor).toBeVisible()
    await expectClean(page, testInfo, 'image-editor', { include: await markForScan(editor, 'img') })
  })

  test('A11Y-027 the guided tour card has no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    const tour = new TourCard(page)
    await app.header.guidedTour.click()
    await expect(tour.card).toBeVisible()
    await expectClean(page, testInfo, 'tour', { include: await markForScan(tour.card, 'tour') })
  })

  test('A11Y-028 the document scanner has no critical or serious accessibility violations', { tag: '@P2' }, async ({ project: _p, app, page }, testInfo) => {
    const scanner = new ScannerModal(page)
    await scanner.open(app.documents.scan)
    await scanner.cameraLive()
    await expectClean(page, testInfo, 'scanner', { include: await markForScan(scanner.dialog, 'scan') })
  })

  test('A11Y-029 the new audio note and new video note dialogs have no critical or serious accessibility violations', { tag: '@P2' }, async ({ pdfOpen: app, page }, testInfo) => {
    knownDefect('DEF-910')
    const dialogs = new CanvasDialogs(page)
    await app.canvas.place('audio', 0.5, 0.5)
    await expect(dialogs.audio).toBeVisible()
    const audio = await seriousViolations(page, testInfo, 'audio-dialog', { include: await markForScan(dialogs.audio, 'audio') })
    await dialogs.media(dialogs.audio, 'Audio').cancel.click()
    await expect(dialogs.audio).toBeHidden()
    await app.canvas.place('video', 0.5, 0.5)
    await expect(dialogs.video).toBeVisible()
    const video = await seriousViolations(page, testInfo, 'video-dialog', { include: await markForScan(dialogs.video, 'video') })
    expect({ audio, video }).toEqual({ audio: [], video: [] })
  })

  test('A11Y-030 the Storage dialog has no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    const storage = new StorageScreens(page)
    await app.header.storage.click()
    await expect(storage.dialog).toBeVisible()
    await expectClean(page, testInfo, 'storage', { include: await markForScan(storage.dialog, 'storage') })
  })

  test('A11Y-031 a project\'s document list, a Markdown document and the find bar have no critical or serious accessibility violations', { tag: '@P2' }, async ({ project: _p, app, page }, testInfo) => {
    knownDefect('DEF-910')
    knownDefect('DEF-911')
    knownDefect('DEF-913')
    await app.documents.uploadMany([FIND_PDF.payload(), TEXT_FILES.markdown()])
    const list = await seriousViolations(page, testInfo, 'document-list')
    await app.documents.openDocument(TEXT_FILES.markdown().name)
    await expect(page.locator('.markdown-body')).toContainText('MARKDOWNMARKER')
    const markdown = await seriousViolations(page, testInfo, 'markdown-document')
    await app.viewer.backToDocuments.click()
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.viewer.tool('find').click()
    await app.find.search('canvas')
    await app.find.expectCount(1, FIND_PDF.canvasMatches)
    const find = await seriousViolations(page, testInfo, 'find-bar')
    expect({ list, markdown, find }).toEqual({ list: [], markdown: [], find: [] })
  })

  test('A11Y-032 the Delete Project confirmation and quick search have no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.home.createProject('Doomed Project')
    await app.documents.expectOpen('Doomed Project')
    await page.keyboard.press('Control+k')
    const quick = new QuickSearch(page)
    await expect(quick.input).toBeFocused()
    const search = await seriousViolations(page, testInfo, 'quick-search', { include: await markForScan(quick.panel, 'qs') })
    await page.keyboard.press('Escape')
    await app.documents.backToProjects.click()
    await app.home.cardAction('Doomed Project', 'Delete')
    const del = page.getByRole('dialog', { name: 'Delete Project' })
    await expect(del).toBeVisible()
    const confirm = await seriousViolations(page, testInfo, 'delete-project', { include: await markForScan(del, 'del') })
    expect({ search, confirm }).toEqual({ search: [], confirm: [] })
  })

  test('A11Y-033 the Reset PIN and Change PIN dialogs have no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.profileMenu.choose('Change PIN')
    await expect(app.changePin.dialog).toBeVisible()
    const change = await seriousViolations(page, testInfo, 'change-pin', { include: await markForScan(app.changePin.dialog, 'cp') })
    await page.keyboard.press('Escape')
    await page.evaluate(() => sessionStorage.clear())
    await app.reload()
    await app.login.forgotPin.click()
    await expect(app.forgotPin.dialog).toBeVisible()
    const reset = await seriousViolations(page, testInfo, 'reset-pin', { include: await markForScan(app.forgotPin.dialog, 'rp') })
    expect({ change, reset }).toEqual({ change: [], reset: [] })
  })

  test('A11Y-034 System Check and the Install app dialog have no critical or serious accessibility violations', { tag: '@P3' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.header.settings.click()
    await app.settings.diagnostics.click()
    const check = new SystemCheck(page)
    await expect(check.dialog).toBeVisible()
    const system = await seriousViolations(page, testInfo, 'system-check', { include: await markForScan(check.dialog, 'sc') })
    await page.keyboard.press('Escape')
    await expect(check.dialog).toBeHidden()
    await page.getByRole('button', { name: 'Install app' }).click()
    const install = new ShellBanners(page).install
    await expect(install).toBeVisible()
    const installIds = await seriousViolations(page, testInfo, 'install-dialog', { include: await markForScan(install, 'inst') })
    expect({ system, install: installIds }).toEqual({ system: [], install: [] })
  })
})

test.describe('Screens, signed in', { tag: ['@regression', '@a11y', '@api'] }, () => {
  test('A11Y-035 the Sharing screen and the Share dialog have no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: app, page }, testInfo) => {
    knownDefect('DEF-910')
    await app.home.createProject('Shared Project')
    await app.documents.backToProjects.click()
    const screen = new SharingScreen(page)
    await screen.open()
    await expect(screen.tab('Shares')).toBeVisible()
    const board = await seriousViolations(page, testInfo, 'sharing')
    await screen.share.click()
    const composer = new ShareComposerDialog(page)
    await composer.expectOpen()
    const dialog = await seriousViolations(page, testInfo, 'share-dialog', { include: await markForScan(composer.dialog, 'share') })
    expect({ board, dialog }).toEqual({ board: [], dialog: [] })
  })

  test('A11Y-036 Settings › Support signed in, its new ticket form and ticket list, have no critical or serious accessibility violations', { tag: '@P2' }, async ({ signedIn: _app, page }, testInfo) => {
    const panel = new SupportPanel(page)
    await panel.open()
    await expect(panel.newTicketTab).toBeVisible()
    await panel.newTicketTab.click()
    await expect(panel.subject).toBeVisible()
    const form = await seriousViolations(page, testInfo, 'support-new-ticket')
    await panel.myTicketsTab.click()
    await panel.expectList()
    const list = await seriousViolations(page, testInfo, 'support-tickets')
    expect({ form, list }).toEqual({ form: [], list: [] })
  })
})

const { defaultBrowserType: _phoneBrowser, ...pixel5 } = devices['Pixel 5']

test.describe('Phone layout', { tag: ['@regression', '@a11y'] }, () => {
  test.use({ ...pixel5, muulPlan: null })

  test('A11Y-037 on a phone, Home and an open PDF have no critical or serious accessibility violations', { tag: '@P2' }, async ({ app, page }, testInfo) => {
    knownDefect('DEF-914')
    knownDefect('DEF-910')
    knownDefect('DEF-913')
    await app.open()
    await app.pinSetup.createPin(ENV.testPin, 'keypad')
    await app.firstRunCatalogShown()
    await app.home.reach()
    await app.home.createProject('Phone Project')
    await app.documents.expectOpen('Phone Project')
    await app.documents.backToProjects.click()
    await expect(app.home.card('Phone Project')).toBeVisible()
    const home = await seriousViolations(page, testInfo, 'phone-home')
    await app.home.openProject('Phone Project')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await expect(page.locator('[data-page="1"]:not([data-placeholder="true"])')).toBeAttached({ timeout: 30_000 })
    const workspace = await seriousViolations(page, testInfo, 'phone-workspace')
    expect({ home, workspace }).toEqual({ home: [], workspace: [] })
  })
})
