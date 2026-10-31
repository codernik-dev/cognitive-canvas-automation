/**
 * Regression: downloading catalog items into projects. The list API and the
 * ZIPs are MOCKED (helpers/mocks/contentCatalog.ts); every ZIP is built in
 * memory from text PDFs (data/content-files.ts), so the documents and their
 * searchable words are known in advance.
 */
import { test, expect } from '../../fixtures/content.js'
import { CatalogScreen } from '../../pages/ContentCatalog.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { baseURL } from '../../config/env.js'
import { BAD_FILES } from '../../data/files.js'
import {
  CATALOG, PROJECT_NAME, IMPORTED_DESCRIPTION, CELL_BIOLOGY_ZIP, HTML_NOT_A_ZIP,
  pdfZip, emptyZip, singlePdfZip, cc2BackupZip,
} from '../../data/content-files.js'

interface ProjectRow { id: string; userId: string; name: string; description: string; catalogItemId?: string; createdAt: number }
interface DocumentRow { id: string; projectId: string; name: string; pageCount: number; fileSize: number; data: { __bytes: number } }
interface SearchTextRow { projectId: string; documentId: string; pageNumber: number; text: string }

const projects = (page: import('@playwright/test').Page) => readStore<ProjectRow>(page, 'projects')

async function openBiology(catalog: CatalogScreen) {
  await catalog.openCategory('Science')
  await catalog.card('Biology').click()
  await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science/Biology')
}

test.describe('Catalog downloads (mocked API and ZIPs)', { tag: ['@regression', '@catalog', '@api'] }, () => {
  test('REG-105 downloading a catalog item adds it as a project with its documents and searchable text (mocked ZIP)', { tag: ['@P1', '@sanity'] }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
    await openBiology(catalog)

    const release = zips.hold(CATALOG.cellBiology.zipUrl)
    await catalog.downloadButton(CATALOG.cellBiology.title).click()
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Downloading...')
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toBeDisabled()
    // One download at a time: the Select pill hides while it runs.
    await expect(catalog.selectMode).toBeHidden()
    release()

    await app.toasts.expectShown(`"${CATALOG.cellBiology.title}" added to your projects`, 30_000)
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Downloaded')
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toBeDisabled()
    await expect(catalog.downloadedBadge(CATALOG.cellBiology.title)).toBeVisible()
    // Stays on the catalog, at the same level.
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science/Biology')
    await expect(catalog.downloadButton(CATALOG.genetics.title)).toHaveText('Download')

    const [user] = await readStore<{ id: string }>(page, 'users')
    const rows = await projects(page)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: user.id, name: PROJECT_NAME.cellBiology, description: IMPORTED_DESCRIPTION, catalogItemId: CATALOG.cellBiology.id })

    const docs = (await readStore<DocumentRow>(page, 'documents')).sort((a, b) => a.name.localeCompare(b.name))
    expect(docs.map((d) => [d.name, d.pageCount, d.projectId])).toEqual(CELL_BIOLOGY_ZIP.docs.map((d) => [d.name, d.pages, rows[0].id]))
    for (const d of docs) expect(d.data.__bytes, `${d.name} keeps its PDF bytes`).toBe(d.fileSize)

    const text = await readStore<SearchTextRow>(page, 'searchText')
    expect(text).toHaveLength(3)
    for (const d of CELL_BIOLOGY_ZIP.docs) {
      const doc = docs.find((x) => x.name === d.name)!
      const page1 = text.find((t) => t.documentId === doc.id && t.pageNumber === 1)
      expect(page1?.text, `page 1 of ${d.name} is searchable`).toContain(d.marker)
      expect(page1?.projectId).toBe(rows[0].id)
    }
    expect(zips.requests).toEqual([`/${CATALOG.cellBiology.zipUrl}`])
  })

  test('REG-715 a downloaded item stays marked Downloaded after a reload, and its project opens with its documents', { tag: '@P2' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.cellBiology.title).click()
    await app.toasts.expectShown(`"${CATALOG.cellBiology.title}" added to your projects`, 30_000)

    await app.reload()
    // With a project in the library the catalog no longer opens by itself.
    await expect(app.home.card(PROJECT_NAME.cellBiology)).toBeVisible({ timeout: 30_000 })
    await catalog.openFromHeader()
    await openBiology(catalog)
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Downloaded')
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toBeDisabled()

    await catalog.back.click()
    await catalog.back.click()
    await catalog.back.click()
    await app.home.openProject(PROJECT_NAME.cellBiology)
    await app.documents.expectOpen(PROJECT_NAME.cellBiology)
    await expect(app.documents.cards).toHaveCount(2)
    for (const d of CELL_BIOLOGY_ZIP.docs) await expect(app.documents.card(d.name)).toBeVisible()
    expect(zips.requests, 'nothing downloaded twice').toHaveLength(1)
  })

  test('REG-716 project names are built from category, subcategory and title without repeating what the title already says', { tag: '@P2' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    for (const key of ['labSafety', 'rome', 'historyUnit'] as const) await zips.serve(CATALOG[key].zipUrl, singlePdfZip(`${key} doc`, key.toUpperCase()))

    await catalog.openCategory('Science')
    await catalog.downloadButton(CATALOG.labSafety.title).click()
    await app.toasts.expectShown(`"${CATALOG.labSafety.title}" added to your projects`, 30_000)
    await catalog.crumb('Product Catalog').click()
    await catalog.openCategory('History')
    await catalog.downloadButton(CATALOG.rome.title).click()
    await app.toasts.expectShown(`"${CATALOG.rome.title}" added to your projects`, 30_000)
    await expect(catalog.downloadButton(CATALOG.rome.title)).toHaveText('Downloaded')
    await catalog.downloadButton(CATALOG.historyUnit.title).click()
    await app.toasts.expectShown(`"${CATALOG.historyUnit.title}" added to your projects`, 30_000)

    await expectStoreCount(page, 'projects', 3)
    const byItem = Object.fromEntries((await projects(page)).map((p) => [p.catalogItemId, p.name]))
    expect(byItem).toEqual({
      [CATALOG.labSafety.id]: PROJECT_NAME.labSafety,
      [CATALOG.rome.id]: PROJECT_NAME.rome,
      [CATALOG.historyUnit.id]: PROJECT_NAME.historyUnit,
    })
  })

  test('REG-717 a project name stored inside the ZIP never replaces the catalog name', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.genetics.zipUrl, pdfZip(
      [{ path: 'Inheritance.pdf', pages: [{ heading: 'Inheritance', lines: ['Mendel GENETICSMARKER.'] }] }],
      { 'project.json': JSON.stringify({ name: 'genetics draft 3 FINAL' }) },
    ))
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.genetics.title).click()
    await app.toasts.expectShown(`"${CATALOG.genetics.title}" added to your projects`, 30_000)
    const rows = await projects(page)
    expect(rows.map((p) => p.name)).toEqual([PROJECT_NAME.genetics])
    expect((await readStore<DocumentRow>(page, 'documents')).map((d) => d.name)).toEqual(['Inheritance'])
  })

  test('REG-718 a ZIP with no documents still adds an empty project', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.genetics.zipUrl, emptyZip())
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.genetics.title).click()
    await app.toasts.expectShown(`"${CATALOG.genetics.title}" added to your projects`, 30_000)
    const rows = await projects(page)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: PROJECT_NAME.genetics, description: IMPORTED_DESCRIPTION, catalogItemId: CATALOG.genetics.id })
    expect(await readStore(page, 'documents')).toHaveLength(0)
    expect(await readStore(page, 'searchText')).toHaveLength(0)
  })

  test('REG-719 an unreadable PDF inside the ZIP is skipped and the readable ones are imported', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.genetics.zipUrl, pdfZip(
      [{ path: 'Readable.pdf', pages: [{ heading: 'Readable', lines: ['READABLEMARKER'] }] }],
      { 'Broken.pdf': new Uint8Array(BAD_FILES.corruptPdf().buffer) },
    ))
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.genetics.title).click()
    await app.toasts.expectShown(`"${CATALOG.genetics.title}" added to your projects`, 30_000)
    expect((await readStore<DocumentRow>(page, 'documents')).map((d) => d.name)).toEqual(['Readable'])
    const text = await readStore<SearchTextRow>(page, 'searchText')
    expect(text.map((t) => t.text.includes('READABLEMARKER'))).toEqual([true])
  })

  test('REG-720 a catalog item packaged as a Cognitive Canvas backup imports its documents under the catalog name', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
    knownDefect('DEF-702')
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.genetics.zipUrl, cc2BackupZip({ projectName: 'genetics authoring copy v3', description: 'internal draft', docName: 'Punnett Squares', marker: 'PUNNETTMARKER' }))
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.genetics.title).click()
    await app.toasts.expectShown(`"${CATALOG.genetics.title}" added to your projects`, 30_000)
    await expect(catalog.downloadButton(CATALOG.genetics.title)).toHaveText('Downloaded')
    const rows = await projects(page)
    expect(rows).toHaveLength(1)
    const docs = await readStore<DocumentRow>(page, 'documents')
    expect(docs.map((d) => [d.name, d.projectId])).toEqual([['Punnett Squares', rows[0].id]])
    expect(rows[0].catalogItemId).toBe(CATALOG.genetics.id)
    // The curated catalog name, as for every other ZIP format.
    expect(rows[0].name).toBe(PROJECT_NAME.genetics)
  })

  test('REG-721 a download that returns a web page instead of a ZIP fails with a clear message and adds nothing', { tag: '@P2' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.cellBiology.zipUrl, { body: HTML_NOT_A_ZIP, contentType: 'text/html' })
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.cellBiology.title).click()
    await app.toasts.expectShown(`Failed to add "${CATALOG.cellBiology.title}": Downloaded file is an HTML error page, not a ZIP`, 30_000)
    await expect(page.getByText('Failed: Downloaded file is an HTML error page, not a ZIP', { exact: true })).toBeVisible()
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Download')
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toBeEnabled()
    expect(await projects(page)).toHaveLength(0)
    expect(await readStore(page, 'documents')).toHaveLength(0)
  })

  test('REG-722 a missing ZIP (404) fails with the status and adds nothing', { tag: '@P2' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.cellBiology.zipUrl, { status: 404, body: 'no such file', contentType: 'text/plain' })
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.cellBiology.title).click()
    await app.toasts.expectShown(new RegExp(`^Failed to add "${CATALOG.cellBiology.title}": Download failed: 404\\b`), 30_000)
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Download')
    expect(await projects(page)).toHaveLength(0)
  })

  test('REG-739 a download that never reaches the server fails with a network message and adds nothing', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.abort(CATALOG.cellBiology.zipUrl)
    await openBiology(catalog)
    await catalog.downloadButton(CATALOG.cellBiology.title).click()
    await app.toasts.expectShown(`Failed to add "${CATALOG.cellBiology.title}": Download failed (network): Failed to fetch`, 30_000)
    await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Download')
    expect(await projects(page)).toHaveLength(0)
    expect(zips.requests).toEqual([`/${CATALOG.cellBiology.zipUrl}`])
  })

  test.describe('clipboard', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

    test('REG-723 Copy shareable link copies a /?download= link for the item and says so', { tag: '@P2' }, async ({ catalogShown: app, page, zips }) => {
      const catalog = new CatalogScreen(page)
      await openBiology(catalog)
      await catalog.copyLink(CATALOG.cellBiology.title).click()
      await app.toasts.expectShown('Link copied — opening it drops this item straight into Cognitive Canvas.')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/?download=cell-biology`)
      // Copying is not downloading.
      expect(zips.requests).toEqual([])
      await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Download')
    })
  })

  test('REG-724 while an item downloads, Home shows a placeholder card that turns into the project', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
    // A library that already holds a project (the empty-library case is REG-738).
    await app.home.reach()
    await app.home.createProject('Existing Notes')
    await app.documents.expectOpen('Existing Notes')
    await app.documents.backToProjects.click()
    await catalog.openFromHeader()
    await openBiology(catalog)
    const release = zips.hold(CATALOG.cellBiology.zipUrl)
    const requested = zips.waitFor(CATALOG.cellBiology.zipUrl)
    await catalog.downloadButton(CATALOG.cellBiology.title).click()
    await requested
    await app.header.home.click()
    const placeholder = page.locator('[aria-busy="true"]').filter({ hasText: CATALOG.cellBiology.title })
    await expect(placeholder).toBeVisible()
    await expect(placeholder).toContainText('Downloading…')
    release()
    await expect(app.home.card(PROJECT_NAME.cellBiology)).toBeVisible({ timeout: 30_000 })
    await expect(placeholder).toBeHidden()
    await expect(app.home.cards).toHaveCount(2)
  })

  test('REG-738 with an empty library, Home still shows the placeholder card of a download in progress', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
    knownDefect('DEF-705')
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
    await openBiology(catalog)
    // Held for the rest of the test: the import stays in flight while Home is checked.
    zips.hold(CATALOG.cellBiology.zipUrl)
    const requested = zips.waitFor(CATALOG.cellBiology.zipUrl)
    await catalog.downloadButton(CATALOG.cellBiology.title).click()
    await requested
    await app.header.home.click()
    await expect(app.home.newProjectName).toBeVisible()
    // Home shows neither the empty state nor the import; the user should see it landing.
    await expect(page.locator('[aria-busy="true"]').filter({ hasText: CATALOG.cellBiology.title })).toBeVisible()
  })

  test.describe('multi-select', () => {
    test('REG-725 in Select mode tapping cards selects them, the bar counts them, and Select all, Clear and Cancel work', { tag: '@P2' }, async ({ catalogShown: _app, page, zips }) => {
      const catalog = new CatalogScreen(page)
      await openBiology(catalog)
      await catalog.selectMode.click()
      await expect(catalog.multiBar).toContainText('0 of 2 selected')
      const download = catalog.multiBar.getByRole('button', { name: /^Download \(\d+\)$/ })
      await expect(download).toHaveText('Download (0)')
      await expect(download).toBeDisabled()
      await expect(catalog.item(CATALOG.cellBiology.title)).toContainText('Tap to select')
      await expect(catalog.item(CATALOG.cellBiology.title).getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)

      await catalog.item(CATALOG.cellBiology.title).click()
      await expect(catalog.item(CATALOG.cellBiology.title)).toContainText('Selected')
      await expect(catalog.multiBar).toContainText('1 of 2 selected')
      await expect(download).toHaveText('Download (1)')
      await expect(download).toBeEnabled()
      await catalog.item(CATALOG.cellBiology.title).click()
      await expect(catalog.multiBar).toContainText('0 of 2 selected')

      await catalog.multiBar.getByRole('button', { name: 'Select all' }).click()
      await expect(catalog.multiBar).toContainText('2 of 2 selected')
      await catalog.multiBar.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect(catalog.multiBar).toContainText('0 of 2 selected')
      await catalog.multiBar.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(catalog.multiBar).toBeHidden()
      await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Download')
      expect(zips.requests).toEqual([])
    })

    test('REG-726 downloading several selected items imports them one after another and marks each Downloaded', { tag: '@P2' }, async ({ catalogShown: _app, page, zips }) => {
      const catalog = new CatalogScreen(page)
      await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
      await zips.serve(CATALOG.genetics.zipUrl, singlePdfZip('Inheritance', 'GENETICSMARKER'))
      await openBiology(catalog)
      await catalog.selectMode.click()
      await catalog.multiBar.getByRole('button', { name: 'Select all' }).click()
      const releaseSecond = zips.hold(CATALOG.genetics.zipUrl)
      await catalog.multiBar.getByRole('button', { name: 'Download (2)' }).click()

      // Strictly one at a time: the first finishes before the second starts.
      await expect(catalog.multiBar).toContainText(`Downloading 2 of 2 — ${CATALOG.genetics.title}`, { timeout: 30_000 })
      await expect(catalog.item(CATALOG.cellBiology.title)).toContainText('Done')
      await expect(catalog.item(CATALOG.genetics.title)).toContainText('Downloading...')
      releaseSecond()

      // A clean run leaves Select mode by itself.
      await expect(catalog.multiBar).toBeHidden({ timeout: 30_000 })
      await expect(catalog.downloadButton(CATALOG.cellBiology.title)).toHaveText('Downloaded')
      await expect(catalog.downloadButton(CATALOG.genetics.title)).toHaveText('Downloaded')
      expect(zips.requests).toEqual([`/${CATALOG.cellBiology.zipUrl}`, `/${CATALOG.genetics.zipUrl}`])
      const rows = await projects(page)
      expect(rows.map((p) => p.catalogItemId).sort()).toEqual([CATALOG.cellBiology.id, CATALOG.genetics.id].sort())
      expect(await readStore(page, 'documents')).toHaveLength(3)
    })

    test('REG-727 items downloaded together are named by the same catalog rule as a single download', { tag: '@P3' }, async ({ catalogShown: _app, page, zips }) => {
      knownDefect('DEF-703')
      const catalog = new CatalogScreen(page)
      await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
      await zips.serve(CATALOG.genetics.zipUrl, singlePdfZip('Inheritance', 'GENETICSMARKER'))
      await openBiology(catalog)
      await catalog.selectMode.click()
      await catalog.multiBar.getByRole('button', { name: 'Select all' }).click()
      await catalog.multiBar.getByRole('button', { name: 'Download (2)' }).click()
      await expect(catalog.multiBar).toBeHidden({ timeout: 30_000 })
      const byItem = Object.fromEntries((await projects(page)).map((p) => [p.catalogItemId, p.name]))
      expect(byItem).toEqual({
        [CATALOG.cellBiology.id]: PROJECT_NAME.cellBiology,
        [CATALOG.genetics.id]: PROJECT_NAME.genetics,
      })
    })

    test('REG-728 an item that fails in a batch is marked Failed and the bar stays up', { tag: '@P3' }, async ({ catalogShown: _app, page, zips }) => {
      const catalog = new CatalogScreen(page)
      await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
      await zips.serve(CATALOG.genetics.zipUrl, { status: 404, body: 'gone', contentType: 'text/plain' })
      await openBiology(catalog)
      await catalog.selectMode.click()
      await catalog.multiBar.getByRole('button', { name: 'Select all' }).click()
      await catalog.multiBar.getByRole('button', { name: 'Download (2)' }).click()
      await expect(catalog.item(CATALOG.genetics.title)).toContainText('Failed', { timeout: 30_000 })
      await expect(catalog.item(CATALOG.cellBiology.title)).toContainText('Done')
      await expect(catalog.multiBar).toContainText(/\d+ of \d+ selected/)
      await expect(catalog.multiBar).toBeVisible()
      const rows = await projects(page)
      expect(rows.map((p) => p.catalogItemId)).toEqual([CATALOG.cellBiology.id])
    })

    test('REG-729 an item already downloaded cannot be selected and is left out of the count', { tag: '@P3' }, async ({ catalogShown: app, page, zips }) => {
      const catalog = new CatalogScreen(page)
      await zips.serve(CATALOG.cellBiology.zipUrl, CELL_BIOLOGY_ZIP.build())
      await openBiology(catalog)
      await catalog.downloadButton(CATALOG.cellBiology.title).click()
      await app.toasts.expectShown(`"${CATALOG.cellBiology.title}" added to your projects`, 30_000)
      await catalog.selectMode.click()
      await expect(catalog.item(CATALOG.cellBiology.title)).toContainText('Already downloaded')
      await expect(catalog.multiBar).toContainText('0 of 1 selected')
      await catalog.item(CATALOG.cellBiology.title).click()
      await expect(catalog.multiBar).toContainText('0 of 1 selected')
      await catalog.multiBar.getByRole('button', { name: 'Select all' }).click()
      await expect(catalog.multiBar).toContainText('1 of 1 selected')
      await expect(catalog.item(CATALOG.genetics.title)).toContainText('Selected')
    })
  })
})
