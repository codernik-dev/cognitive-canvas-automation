/**
 * Smoke: can a new user get from a blank device to a saved note on a PDF?
 * Each test is independent (own browser profile) and stops at the first
 * broken link in that chain.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount, dbInfo } from '../../helpers/idb.js'
import { FIND_PDF } from '../../data/files.js'

test.describe('Smoke', { tag: ['@smoke', '@P1'] }, () => {
  test('SMK-001 a fresh device opens on PIN setup, offline, without errors', async ({ app, blockedRequests }) => {
    await app.open()
    await app.pinSetup.expectVisible()
    await expect(app.pinSetup.next).toBeDisabled()
    // Offline-first: the app did try to reach muulorigin.com, every attempt was refused, and it still came up.
    expect(blockedRequests.some((r) => /muulorigin\.com/.test(r)), 'the network guard saw the boot-time requests').toBe(true)
  })

  test('SMK-002 creating a PIN signs in and reaches the projects screen', async ({ app, page }) => {
    await app.open()
    await app.pinSetup.createPin()
    await app.home.reach()
    await expect(app.home.emptyState).toBeVisible()
    const users = await readStore<{ pinHash?: string }>(page, 'users')
    expect(users).toHaveLength(1)
    expect(users[0].pinHash, 'PIN is stored hashed, never in clear').toMatch(/^pbkdf2\$sha256\$\d+\$/)
  })

  test('SMK-003 a new project opens and is saved', async ({ signedIn: app, page }) => {
    await app.home.createProject('Smoke Project')
    await app.documents.expectOpen('Smoke Project')
    await expect(app.documents.emptyState).toBeVisible()
    await expectStoreCount(page, 'projects', 1, (p) => p.name === 'Smoke Project')
  })

  test('SMK-004 an uploaded PDF opens with every page counted and page 1 drawn', async ({ project: _p, app, page }) => {
    await app.documents.uploadFiles(FIND_PDF.payload())
    // The toast (3.5 s) fires as the document opens: watch for it during the open, not after.
    await Promise.all([
      app.toasts.expectShown(`"${FIND_PDF.displayName}" uploaded`, 30_000),
      app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount),
    ])
    const docs = await readStore<{ name: string; pageCount: number }>(page, 'documents')
    expect(docs.map((d) => [d.name, d.pageCount])).toEqual([[FIND_PDF.displayName, FIND_PDF.pageCount]])
  })

  test('SMK-005 a note placed on the canvas keeps its text after a reload', async ({ pdfOpen: app, page }) => {
    const id = await app.canvas.place('note', 0.5, 0.4)
    await app.canvas.writeNote(id!, 'Smoke note text')
    await expect(app.canvas.item(id!)).toContainText('Smoke note text')
    await expect
      .poll(async () => JSON.stringify((await readStore(page, 'workspaceItems')).find((i) => i.id === id)?.data ?? ''))
      .toContain('Smoke note text')

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(app.canvas.item(id!)).toContainText('Smoke note text')
  })

  test('SMK-006 the database opens at the current schema with every store', async ({ signedIn: _app, page }) => {
    const info = await dbInfo(page)
    expect(info?.version).toBe(13)
    expect(info?.stores).toEqual(expect.arrayContaining([
      'users', 'projects', 'documents', 'searchText', 'workspaceItems', 'highlights', 'itemLinks', 'areaLinks',
      'canvasStrokes', 'mediaBlobs', 'textHighlights', 'textAreaLinks', 'recordTombstones', 'binaryIndex',
    ]))
  })

  // Jumping to a match on a page not yet viewed is broken (DEF-001); that is
  // asserted in tests/regression/find.spec.ts. Smoke checks the search itself.
  test('SMK-007 find in document counts matches across every page', async ({ pdfOpen: app }) => {
    await app.viewer.tool('find').click()
    await app.find.search('canvas')
    await app.find.expectCount(1, FIND_PDF.canvasMatches)
    await expect(app.find.currentMatch).toBeAttached()
  })

  test('SMK-008 settings open and Dark mode applies', async ({ signedIn: app }) => {
    await app.header.settings.click()
    await app.settings.expectOpen()
    await app.settings.openTab('Appearance')
    await app.settings.mode('Dark').click()
    await expect.poll(() => app.settings.isDark()).toBe(true)
  })
})
