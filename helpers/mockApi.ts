/**
 * Mocked MuulOrigin API. Page routes take precedence over the context-level
 * network guard, so a spec that calls these gets a deterministic server and
 * every other external request is still refused.
 *
 * These are MOCKS: a pass proves the app handles the documented contract
 * (CATALOG-API.md, src/services/catalog/remoteCatalog.ts), not that the real
 * server honours it. Nothing here ever reaches api.muulorigin.com.
 */
import type { Page } from '@playwright/test'

const API = 'https://api.muulorigin.com'

export interface CatalogItemMock {
  id: string
  title: string
  description?: string
  category: string
  subcategory?: string
  zipUrl: string
  itemCount?: number
  sortOrder?: number
}

/** Serve /api/catalogs with `items`, once or on every call; returns a call counter. */
export async function mockCatalog(page: Page, items: CatalogItemMock[] | 'fail') {
  const calls = { count: 0 }
  await page.route(`${API}/api/catalogs**`, async (route) => {
    calls.count++
    if (items === 'fail') return route.fulfill({ status: 503, body: 'down for maintenance' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, nextCursor: null }) })
  })
  return calls
}

export const SAMPLE_CATALOG: CatalogItemMock[] = [
  { id: 'auto-cat-1', title: 'Automation Biology Pack', description: 'Mocked catalog item one', category: 'Science', zipUrl: 'projects/automation-biology.zip', itemCount: 3, sortOrder: 1 },
  { id: 'auto-cat-2', title: 'Automation History Pack', description: 'Mocked catalog item two', category: 'Humanities', zipUrl: 'projects/automation-history.zip', itemCount: 2, sortOrder: 2 },
]
