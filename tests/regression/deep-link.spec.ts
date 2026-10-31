/**
 * Regression: deep links (services/deepLink, hooks/useDeepLink.ts) against a
 * MOCKED catalog. Three URL forms reach the same flow:
 *   /download/<slug>   /?download=<slug>   /#download/<slug>
 * The slug is matched against the item id, zip file name and title (case and
 * separators ignored, then a fuzzy word-order fallback). The action waits for
 * the PIN and for the catalog, runs once, and the URL is cleaned at once.
 * serve-dist answers /download/<slug> with index.html (the SPA fallback).
 */
import { test, expect } from '../../fixtures/content.js'
import { CatalogScreen, DeepLinkPickerDialog } from '../../pages/ContentCatalog.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { failing } from '../../helpers/mocks/contentCatalog.js'
import { baseURL } from '../../config/env.js'
import { CATALOG, PROJECT_NAME, CELL_BIOLOGY_ZIP, singlePdfZip } from '../../data/content-files.js'

const PENDING_KEY = 'cc2_pending_deep_link'
interface ProjectRow { name: string; catalogItemId?: string }

const pending = (page: import('@playwright/test').Page) => page.evaluate((k) => sessionStorage.getItem(k), PENDING_KEY)

test.describe('Deep links (mocked catalog)', { tag: ['@regression', '@deeplink', '@api'] }, () => {
  test('REG-106 /download/<slug> waits for the PIN, cleans the address bar and imports the matching item once', { tag: ['@P2', '@sanity'] }, async ({ app, page, zips }) => {
    await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
    await app.open('/download/cell-biology')
    await app.pinSetup.expectVisible()
    // Captured and cleaned before anyone has signed in.
    await expect(page).toHaveURL(`${baseURL}/`)
    expect(JSON.parse((await pending(page)) ?? 'null')).toEqual({ action: 'download', rawSlug: 'cell-biology' })
    expect(zips.requests, 'nothing is downloaded before the PIN').toEqual([])

    await app.pinSetup.createPin()
    await app.toasts.expectShown(`"${CATALOG.cellBiology.title}" added to your projects`, 30_000)
    await expectStoreCount(page, 'projects', 1)
    const [project] = await readStore<ProjectRow>(page, 'projects')
    expect(project).toMatchObject({ name: PROJECT_NAME.cellBiology, catalogItemId: CATALOG.cellBiology.id })
    expect(await pending(page)).toBeNull()

    // It fires once: a reload does not import it again.
    await app.reload()
    await expect(app.home.card(PROJECT_NAME.cellBiology)).toBeVisible({ timeout: 30_000 })
    expect(await readStore(page, 'projects')).toHaveLength(1)
    expect(zips.requests).toEqual([`/${CATALOG.cellBiology.zipUrl}`])
  })

  test('REG-730 the ?download= form matches the title whatever its case and separators', { tag: '@P2' }, async ({ app, page, zips }) => {
    await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
    await app.open('/?download=CELL_biology')
    await expect(page).toHaveURL(`${baseURL}/`)
    await app.pinSetup.createPin()
    await app.toasts.expectShown(`"${CATALOG.cellBiology.title}" added to your projects`, 30_000)
    const rows = await readStore<ProjectRow>(page, 'projects')
    expect(rows.map((p) => p.catalogItemId)).toEqual([CATALOG.cellBiology.id])
  })

  test('REG-731 the #download/ form matches the catalog id', { tag: '@P3' }, async ({ app, page, zips }) => {
    await zips.serve(CATALOG.genetics.zipUrl, singlePdfZip('Inheritance', 'GENETICSMARKER'))
    await app.open(`/#download/${CATALOG.genetics.id}`)
    await expect(page).toHaveURL(`${baseURL}/`)
    await app.pinSetup.createPin()
    await app.toasts.expectShown(`"${CATALOG.genetics.title}" added to your projects`, 30_000)
    const rows = await readStore<ProjectRow>(page, 'projects')
    expect(rows.map((p) => [p.catalogItemId, p.name])).toEqual([[CATALOG.genetics.id, PROJECT_NAME.genetics]])
  })

  test('REG-732 a slug with the right words in another form still finds the one item they describe', { tag: '@P3' }, async ({ app, page, zips }) => {
    await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
    // No id, zip name or title is "science cell"; only Cell Biology carries both words in that order.
    await app.open('/download/science-cell')
    await app.pinSetup.createPin()
    await app.toasts.expectShown(`"${CATALOG.cellBiology.title}" added to your projects`, 30_000)
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.catalogItemId)).toEqual([CATALOG.cellBiology.id])
  })

  test('REG-733 a link that matches two items asks which one, in catalog order, and imports the choice', { tag: '@P2' }, async ({ app, page, zips }) => {
    await zips.serve(CATALOG.class11Ch2.zipUrl, singlePdfZip('Units', 'CLASS11MARKER'))
    await zips.serve(CATALOG.class12Ch2.zipUrl, singlePdfZip('Potential', 'CLASS12MARKER'))
    const picker = new DeepLinkPickerDialog(page)
    await app.open('/download/chapter-2')
    await app.pinSetup.createPin()
    await expect(picker.dialog).toBeVisible({ timeout: 30_000 })
    await expect(picker.dialog).toContainText('The link you opened matches more than one catalog item. Pick one to import.')
    await expect(picker.rows).toHaveCount(2)
    await expect(picker.rows.nth(0)).toContainText('Class 11 · Physics')
    await expect(picker.rows.nth(1)).toContainText('Class 12 · Physics')
    await expect(picker.rows.nth(1)).toContainText('Chapter 2')

    await picker.row('Class 12 · Physics').click()
    await expect(picker.dialog).toBeHidden()
    await app.toasts.expectShown('"Chapter 2" added to your projects', 30_000)
    const rows = await readStore<ProjectRow>(page, 'projects')
    expect(rows.map((p) => [p.catalogItemId, p.name])).toEqual([[CATALOG.class12Ch2.id, PROJECT_NAME.class12Ch2]])
    expect(zips.requests).toEqual([`/${CATALOG.class12Ch2.zipUrl}`])
  })

  test('REG-734 the picker cannot be dismissed by Escape, and Cancel imports nothing', { tag: '@P3' }, async ({ app, page, zips }) => {
    const picker = new DeepLinkPickerDialog(page)
    await app.open('/download/chapter-2')
    await app.pinSetup.createPin()
    await expect(picker.dialog).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Escape')
    await expect(picker.dialog).toBeVisible()
    await picker.cancel.click()
    await expect(picker.dialog).toBeHidden()
    expect(zips.requests).toEqual([])
    expect(await readStore(page, 'projects')).toHaveLength(0)
    expect(await pending(page)).toBeNull()
  })

  test('REG-735 a link that matches nothing says so and opens the catalog searching for it', { tag: '@P2' }, async ({ app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await app.open('/download/quantum-gravity')
    await app.pinSetup.createPin()
    await app.toasts.expectShown('Couldn\'t find "quantum-gravity" — showing closest matches.', 30_000)
    await expect(catalog.search).toHaveValue('quantum-gravity')
    await expect(page.getByText('No results for "quantum-gravity"')).toBeVisible()
    expect(zips.requests).toEqual([])
    expect(await readStore(page, 'projects')).toHaveLength(0)
  })

  test.describe('catalog unavailable', () => {
    test.use({ catalog: failing(503, 'down for maintenance') })

    test('REG-736 when the catalog cannot load, the link says so instead of waiting forever', { tag: '@P2' }, async ({ app, page, zips }) => {
      await app.open('/download/cell-biology')
      await app.pinSetup.createPin()
      await app.toasts.expectShown('Couldn\'t load the catalog to open "cell-biology". Check your connection and try again.', 30_000)
      expect(await pending(page)).toBeNull()
      expect(zips.requests).toEqual([])
      expect(await readStore(page, 'projects')).toHaveLength(0)
    })
  })

  test('REG-737 a link opened while the app is locked runs after unlocking', { tag: '@P3' }, async ({ signedIn: app, page, zips }) => {
    await zips.serve(CATALOG.genetics.zipUrl, singlePdfZip('Inheritance', 'GENETICSMARKER'))
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    await app.open('/download/genetics-basics')
    await app.login.expectVisible()
    await expect(page).toHaveURL(`${baseURL}/`)
    expect(zips.requests).toEqual([])
    await app.login.unlockWith()
    await app.toasts.expectShown(`"${CATALOG.genetics.title}" added to your projects`, 30_000)
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.catalogItemId)).toEqual([CATALOG.genetics.id])
  })
})
