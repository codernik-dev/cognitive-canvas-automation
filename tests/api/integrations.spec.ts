/**
 * Integrations, against MOCKED services only (helpers/mockApi.ts). These
 * prove the app's side of each contract and its offline/failure handling.
 * Real-backend behaviour is out of scope by design: see 03-TEST-STRATEGY.md.
 */
import { test, expect } from '../../fixtures/test.js'
import { mockCatalog, SAMPLE_CATALOG } from '../../helpers/mockApi.js'

test.describe('Catalog (mocked API)', { tag: ['@regression', '@api', '@catalog'] }, () => {
  test('API-001 a fresh profile opens the catalog and lists what the API returns', { tag: '@P2' }, async ({ app, page }) => {
    await mockCatalog(page, SAMPLE_CATALOG)
    await app.open()
    await app.pinSetup.createPin()
    for (const item of SAMPLE_CATALOG) await expect(page.getByText(item.title).first()).toBeVisible()
  })

  test('API-002 a failed catalog load says so, and Try Again recovers', { tag: '@P2' }, async ({ app, page }) => {
    await mockCatalog(page, 'fail')
    await app.open()
    await app.pinSetup.createPin()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    await page.unrouteAll({ behavior: 'wait' })
    await mockCatalog(page, SAMPLE_CATALOG)
    await page.getByRole('button', { name: 'Try Again' }).click()
    await expect(page.getByText(SAMPLE_CATALOG[0].title).first()).toBeVisible()
  })
})

test.describe('Gated backup sources (signed out)', { tag: ['@regression', '@api', '@backup'] }, () => {
  test.beforeEach(async ({ signedIn: app }) => {
    await app.dataCenter.openFromHeader()
  })

  test('API-003 Cloud backup asks a signed-out user to sign in for the Pro plan', { tag: '@P2' }, async ({ app, page }) => {
    await app.dataCenter.source('Cloud').click()
    await expect(page.getByText('Cloud backup needs the Pro plan')).toBeVisible()
    await expect(app.dataCenter.dialog.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  // The plan gate is checked before the MoBrowser bridge, so a signed-out user meets the gate first.
  test('API-004 GitHub backup asks a signed-out user to sign in for the Economy plan', { tag: '@P3' }, async ({ app, page }) => {
    await app.dataCenter.source('GitHub').click()
    await expect(page.getByRole('heading', { name: 'GitHub backup needs the Economy plan' })).toBeVisible()
    await expect(app.dataCenter.dialog.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })
})

test.describe('Network footprint', { tag: ['@regression', '@api', '@privacy'] }, () => {
  test('API-005 a full offline journey only ever tries to reach MuulOrigin hosts', { tag: '@P2' }, async ({ pdfOpen: app, blockedRequests }) => {
    await app.canvas.place('note', 0.5, 0.4)
    const hosts = new Set(blockedRequests.map((r) => new URL(r.split(' ')[1]).hostname))
    for (const h of hosts) expect(['www.muulorigin.com', 'api.muulorigin.com'], `unexpected third-party host ${h}`).toContain(h)
  })
})
