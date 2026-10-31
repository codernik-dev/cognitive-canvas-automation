/**
 * Regression: Product Catalog browsing against a MOCKED list API
 * (helpers/mocks/contentCatalog.ts, data/content-files.ts). Downloads live in
 * catalog-download.spec.ts; the API-001/002 smoke checks stay in
 * tests/api/integrations.spec.ts.
 */
import { test, expect } from '../../fixtures/content.js'
import { CatalogScreen } from '../../pages/ContentCatalog.js'
import { always, failing, paged } from '../../helpers/mocks/contentCatalog.js'
import { CATALOG, CATALOG_ITEMS } from '../../data/content-files.js'

const RECENT_KEY = 'cc2_catalog_recent_searches'

test.describe('Catalog browsing (mocked API)', { tag: ['@regression', '@catalog', '@api'] }, () => {
  test('REG-700 the catalog lists every category with its item count, sorted naturally, with the totals footer', { tag: ['@P2', '@sanity'] }, async ({ catalogShown: _app, page, catalogApi }) => {
    const catalog = new CatalogScreen(page)
    await expect(catalog.hero).toBeVisible()
    await expect(catalog.intro).toBeVisible()
    await expect(catalog.cardTitles).toHaveText(['Class 11', 'Class 12', 'History', 'Science'])
    await expect(catalog.card('Science')).toContainText('4 items')
    await expect(catalog.card('History')).toContainText('2 items')
    await expect(catalog.card('Class 11')).toContainText('1 item')
    // A category's chips preview its subcategories (or its item titles when it has none).
    await expect(catalog.card('Science')).toContainText('Biology')
    await expect(catalog.card('History')).toContainText('Ancient Rome')
    await expect(catalog.statsFooter).toHaveText('8 items across 4 categories')
    // Covers: the app's bundled cover for "Class 12"; a category with no cover gets the folder placeholder.
    const cover = catalog.card('Class 12').getByRole('img', { name: 'Class 12' })
    await expect(cover).toHaveAttribute('src', '/catalog/category-class-12.jpg')
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { message: 'cover image loaded' }).toBe(true)
    await expect(catalog.card('History').getByRole('img')).toHaveCount(0)
    for (const tag of ['Biology', 'History', 'Physics', 'Science']) await expect(catalog.tag(tag)).toBeVisible()
    // One list request, with the documented page size.
    expect(catalogApi.requests.map((u) => u.pathname + u.search)).toEqual(['/api/catalogs?limit=200'])
  })

  test('REG-701 a category with subcategories shows them plus its own items, and a subcategory lists its items', { tag: '@P2' }, async ({ catalogShown: _app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.openCategory('Science')
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science')
    await expect(catalog.cardTitles).toHaveText(['Biology', 'Physics'])
    await expect(catalog.card('Biology')).toContainText('2 items')
    await expect(catalog.card('Physics')).toContainText('1 item')
    await expect(page.getByRole('heading', { name: 'More in Science' })).toBeVisible()
    await expect(catalog.itemTitles).toHaveText([CATALOG.labSafety.title])

    await catalog.card('Biology').click()
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science/Biology')
    await expect(catalog.itemTitles).toHaveText([CATALOG.cellBiology.title, CATALOG.genetics.title])
    await expect(catalog.item(CATALOG.cellBiology.title)).toContainText(CATALOG.cellBiology.description)
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Download')
    await expect(catalog.copyLink(CATALOG.cellBiology.title)).toBeVisible()
  })

  test('REG-702 a category without subcategories goes straight to its items', { tag: '@P3' }, async ({ catalogShown: _app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.openCategory('History')
    await expect(catalog.itemTitles).toHaveText([CATALOG.rome.title, CATALOG.historyUnit.title])
    await expect(catalog.cardTitles).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /^More in / })).toHaveCount(0)
  })

  test('REG-703 the breadcrumb and the Back chevron step back one level at a time, and Back at the top closes the catalog', { tag: '@P2' }, async ({ catalogShown: app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.openCategory('Science')
    await catalog.card('Biology').click()
    await catalog.crumb('Science').click()
    await expect(catalog.cardTitles).toHaveText(['Biology', 'Physics'])
    await catalog.card('Biology').click()
    await catalog.crumb('Product Catalog').click()
    await expect(catalog.hero).toBeVisible()

    await catalog.openCategory('Science')
    await catalog.card('Biology').click()
    await catalog.back.click()
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science')
    await catalog.back.click()
    await expect(catalog.hero).toBeVisible()
    await catalog.back.click()
    await expect(app.home.newProjectName).toBeVisible()
    await expect(catalog.hero).toBeHidden()
  })

  test('REG-704 a subject tag filters the catalog to that subject, and pressing it again clears the filter', { tag: '@P3' }, async ({ catalogShown: _app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.tag('Biology').click()
    await expect(catalog.resultsCaption(/^2 results in\s*Biology$/i)).toBeVisible()
    await expect(catalog.itemTitles).toHaveText([CATALOG.cellBiology.title, CATALOG.genetics.title])
    await expect(catalog.itemCrumb(CATALOG.cellBiology.title)).toHaveText('Science · Biology')
    await catalog.tag('Biology').click()
    await expect(catalog.cardTitles).toHaveText(['Class 11', 'Class 12', 'History', 'Science'])

    // Back peels the tag off before it closes anything.
    await catalog.tag('History').click()
    await expect(catalog.itemTitles).toHaveText([CATALOG.rome.title, CATALOG.historyUnit.title])
    await catalog.back.click()
    await expect(catalog.cardTitles).toHaveText(['Class 11', 'Class 12', 'History', 'Science'])
    await expect(catalog.hero).toBeVisible()
  })

  test('REG-705 search matches titles, descriptions and categories across the whole catalog', { tag: '@P2' }, async ({ catalogShown: _app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.search.fill('genetics')
    await expect(catalog.resultsCaption(/^1 result for\s*"genetics"$/i)).toBeVisible()
    await expect(catalog.itemTitles).toHaveText([CATALOG.genetics.title])
    await expect(catalog.itemCrumb(CATALOG.genetics.title)).toHaveText('Science · Biology')

    // A word only in the description.
    await catalog.search.fill('organelles')
    await expect(catalog.itemTitles).toHaveText([CATALOG.cellBiology.title])

    // Search is global even from inside a category.
    await catalog.search.fill('')
    await page.keyboard.press('Escape')
    await catalog.openCategory('History')
    await catalog.search.fill('newton')
    await expect(catalog.itemTitles).toHaveText([CATALOG.motion.title])
  })

  test('REG-706 a search naming a category or subcategory shows section cards that jump into it', { tag: '@P3' }, async ({ catalogShown: _app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.search.fill('physics')
    await expect(catalog.resultsCaption(/^3 sections for\s*"physics"$/i)).toBeVisible()
    await expect(catalog.cardTitles).toHaveText(['Physics', 'Physics', 'Physics'])
    // Section cards replace the item list.
    await expect(catalog.itemCards).toHaveCount(0)
    await catalog.card('Physics').filter({ hasText: 'Science' }).click()
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science/Physics')
    await expect(catalog.search).toHaveValue('')
    await expect(catalog.itemTitles).toHaveText([CATALOG.motion.title])

    // Roman numerals are read as numbers: "class xi" is Class 11.
    await catalog.crumb('Product Catalog').click()
    await catalog.search.fill('class xi')
    await expect(catalog.resultsCaption(/^1 section for\s*"class xi"$/i)).toBeVisible()
    await catalog.card('Class 11').click()
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Class 11')
  })

  test('REG-707 a search with no match says so, Clear empties it, and Escape leaves search mode', { tag: '@P3' }, async ({ catalogShown: _app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.search.fill('zzzz')
    await expect(page.getByText('No results for "zzzz"')).toBeVisible()
    await catalog.clearSearch.click()
    await expect(catalog.search).toHaveValue('')
    await expect(catalog.clearSearch).toBeHidden()
    await catalog.search.click()
    await expect(page.getByRole('heading', { name: 'Suggestions' })).toBeVisible()
    await catalog.search.press('Escape')
    await expect(page.getByRole('heading', { name: 'Suggestions' })).toBeHidden()
    await expect(catalog.cardTitles).toHaveText(['Class 11', 'Class 12', 'History', 'Science'])
  })

  test('REG-708 the search panel suggests subjects and remembers the last three searches after a reload', { tag: '@P3' }, async ({ catalogShown: app, page }) => {
    const catalog = new CatalogScreen(page)
    await catalog.search.click()
    await expect(catalog.overlayEntries('Suggestions')).toHaveText(['Biology', 'History', 'Physics', 'Science'])
    await expect(page.getByRole('heading', { name: 'Recent' })).toHaveCount(0)
    await catalog.overlayEntries('Suggestions').filter({ hasText: 'History' }).click()
    await expect(catalog.search).toHaveValue('History')
    await expect(catalog.search).toBeFocused()

    for (const q of ['genetics', 'rome', 'motion']) {
      await catalog.search.fill(q)
      await catalog.search.press('Escape')
      await catalog.search.click()
    }
    // Newest first, capped at three: "History" dropped off.
    await expect(catalog.overlayEntries('Recent')).toHaveText(['motion', 'rome', 'genetics'])
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), RECENT_KEY)) ?? 'null')).toEqual(['motion', 'rome', 'genetics'])

    await app.reload()
    await catalog.expectSettled()
    await catalog.search.click()
    await expect(catalog.overlayEntries('Recent')).toHaveText(['motion', 'rome', 'genetics'])
    await catalog.overlayEntries('Recent').filter({ hasText: 'rome' }).click()
    await expect(catalog.itemTitles).toHaveText([CATALOG.rome.title])
  })

  test.describe('paging', () => {
    test.use({ catalog: paged([[CATALOG.cellBiology, CATALOG.genetics], [CATALOG.motion], [CATALOG.rome]], ['page/2', 'page 3']) })

    test('REG-709 the catalog follows nextCursor until the last page and shows the items of every page', { tag: '@P2' }, async ({ catalogShown: _app, page, catalogApi }) => {
      const catalog = new CatalogScreen(page)
      await expect(catalog.statsFooter).toHaveText('4 items across 2 categories')
      await expect(catalog.cardTitles).toHaveText(['History', 'Science'])
      expect(catalogApi.requests.map((u) => u.pathname + u.search)).toEqual([
        '/api/catalogs?limit=200',
        '/api/catalogs?limit=200&cursor=page%2F2',
        '/api/catalogs?limit=200&cursor=page%203',
      ])
    })
  })

  test('REG-710 while the list loads the catalog says "Loading content..."', { tag: '@P3' }, async ({ app, page, catalogApi }) => {
    const catalog = new CatalogScreen(page)
    const release = catalogApi.hold()
    await app.open()
    await app.pinSetup.createPin()
    await expect(catalog.loading).toBeVisible({ timeout: 30_000 })
    await expect(catalog.hero).toBeHidden()
    release()
    await expect(catalog.hero).toBeVisible()
    await expect(catalog.loading).toBeHidden()
  })

  test.describe('server error', () => {
    test.use({ catalog: failing(503, 'down for maintenance') })

    test('REG-711 a server error shows "Failed to load content" with the reason, and Try Again loads the list', { tag: '@P2' }, async ({ catalogShown: _app, page, catalogApi }) => {
      const catalog = new CatalogScreen(page)
      await expect(catalog.errorTitle).toBeVisible()
      await expect(page.getByText(/^Catalog API error: 503\b/)).toBeVisible()
      expect(catalogApi.requests).toHaveLength(1)
      catalogApi.respondWith(always(CATALOG_ITEMS))
      await catalog.tryAgain.click()
      await expect(catalog.cardTitles).toHaveText(['Class 11', 'Class 12', 'History', 'Science'])
      await expect(catalog.errorTitle).toBeHidden()
      expect(catalogApi.requests).toHaveLength(2)
    })
  })

  test.describe('malformed replies', () => {
    test.use({ catalog: failing(200, '{"results":[]}', 'application/json') })

    test('REG-712 a reply without an items array, invalid JSON, or a non-array items each show their own error', { tag: '@P3' }, async ({ catalogShown: _app, page, catalogApi }) => {
      const catalog = new CatalogScreen(page)
      await expect(page.getByText('Catalog API response missing "items" array')).toBeVisible()

      catalogApi.respondWith(failing(200, 'this is not json', 'application/json'))
      await catalog.tryAgain.click()
      await expect(page.getByText('Catalog API returned invalid JSON')).toBeVisible()

      catalogApi.respondWith(failing(200, '{"items":{"id":"x"}}', 'application/json'))
      await catalog.tryAgain.click()
      await expect(page.getByText('Catalog API "items" is not an array')).toBeVisible()
      await expect(catalog.errorTitle).toBeVisible()
      expect(catalogApi.requests).toHaveLength(3)
    })
  })

  test.describe('empty catalog', () => {
    test.use({ catalog: always([]) })

    test('REG-713 an empty catalog shows no categories, a zero total and no Select button', { tag: '@P3' }, async ({ catalogShown: _app, page }) => {
      const catalog = new CatalogScreen(page)
      await expect(catalog.statsFooter).toHaveText('0 items across 0 categories')
      await expect(catalog.cardTitles).toHaveCount(0)
      await expect(catalog.selectMode).toHaveCount(0)
      await expect(catalog.errorTitle).toHaveCount(0)
    })
  })

  test.describe('five-minute cache', () => {
    test.use({ clockAt: new Date('2026-03-10T09:00:00Z') })

    test('REG-714 the list is reused for five minutes, then fetched again', { tag: '@P3' }, async ({ catalogShown: _app, page, catalogApi }) => {
      const catalog = new CatalogScreen(page)
      expect(catalogApi.requests).toHaveLength(1)
      await catalog.back.click()
      await catalog.openFromHeader()
      await expect(catalog.cardTitles).toHaveText(['Class 11', 'Class 12', 'History', 'Science'])
      expect(catalogApi.requests, 'reopened within five minutes: served from the cache').toHaveLength(1)

      await catalog.back.click()
      await page.clock.setSystemTime(new Date('2026-03-10T09:10:00Z'))
      await catalog.openFromHeader()
      await expect.poll(() => catalogApi.requests.length, { message: 'a second list request after five minutes' }).toBe(2)
      await expect(catalog.cardTitles).toHaveText(['Class 11', 'Class 12', 'History', 'Science'])
    })
  })
})
