/**
 * A programmable fake of the Product Catalog: the list API on
 * api.muulorigin.com and the catalog ZIPs the app downloads from its own
 * origin. Extends (does not replace) helpers/mockApi.ts `mockCatalog`, which
 * only serves one fixed page.
 *
 * Contract (src/services/catalog/remoteCatalog.ts):
 *   GET https://api.muulorigin.com/api/catalogs?limit=200[&cursor=<nextCursor>]
 *     -> { items: [{ id, title, description, zipUrl, category, subcategory?,
 *                    previewImageUrl, itemCount, sortOrder }], nextCursor? }
 *   The app keeps asking with `cursor` while nextCursor is a non-empty string.
 *   A relative zipUrl ("catalog-e2e/x.zip") is fetched from the app origin,
 *   so the ZIP is served same-origin with page.route, never from the network.
 *
 * Everything is a MOCK: a pass proves the app's side of the contract only.
 */
import type { Page, Request, Route } from '@playwright/test'
import { baseURL } from '../../config/env.js'

export const CATALOG_API = 'https://api.muulorigin.com/api/catalogs'
const APP_ORIGIN = new URL(baseURL).origin

/** CORS for the app origin. The list call sends no credentials, so `*` would do too. */
const CORS = { 'access-control-allow-origin': APP_ORIGIN, 'access-control-allow-headers': 'authorization, content-type, accept' }

export interface CatalogEntry {
  id: string
  title: string
  description?: string
  category: string
  subcategory?: string
  zipUrl: string
  itemCount?: number
  sortOrder?: number
  previewImageUrl?: string
}

/** One answer of the list endpoint: a page of items, or any raw HTTP reply. */
export type CatalogReply =
  | { items: CatalogEntry[]; nextCursor?: string | null }
  | { status: number; body: string; contentType?: string }

/**
 * How the list endpoint answers. Wrapped in an object (not a bare function)
 * so it can be a Playwright option value: a function there would be taken
 * for a fixture.
 */
export interface CatalogResponder {
  respond: (url: URL, call: number) => CatalogReply
}

/** Same items on every call. */
export const always = (items: CatalogEntry[]): CatalogResponder => ({ respond: () => ({ items, nextCursor: null }) })

/** Same raw HTTP reply on every call (errors, malformed bodies). */
export const failing = (status: number, body: string, contentType = 'text/plain'): CatalogResponder => ({ respond: () => ({ status, body, contentType }) })

/** Pages chained by cursor: page n answers with nextCursor `cursors[n]` (absent on the last page). */
export function paged(pages: CatalogEntry[][], cursors: string[]): CatalogResponder {
  return {
    respond: (url) => {
      const cursor = url.searchParams.get('cursor')
      const index = cursor === null ? 0 : cursors.indexOf(cursor) + 1
      if (index < 0 || index >= pages.length) return { status: 400, body: JSON.stringify({ message: `unknown cursor ${cursor}` }), contentType: 'application/json' }
      return { items: pages[index], nextCursor: cursors[index] ?? null }
    },
  }
}

export class CatalogApi {
  /** Every list request the app made, in order (preflights excluded). */
  readonly requests: URL[] = []
  private responder: CatalogResponder
  private held: { promise: Promise<void>; release: () => void } | null = null

  private constructor(responder: CatalogResponder) {
    this.responder = responder
  }

  /** Install before the app opens. Later page routes (other mocks) take precedence over this one. */
  static async install(page: Page, responder: CatalogResponder): Promise<CatalogApi> {
    const api = new CatalogApi(responder)
    await page.route((url) => url.href.startsWith(CATALOG_API), (route) => api.handle(route))
    return api
  }

  /** Answer later calls differently (e.g. the server recovers before "Try Again"). */
  respondWith(responder: CatalogResponder) {
    this.responder = responder
  }

  /** Keep every list request pending until the returned function is called (to see the loading state). */
  hold(): () => void {
    let release!: () => void
    const promise = new Promise<void>((r) => { release = r })
    this.held = { promise, release }
    return () => { this.held = null; release() }
  }

  private async handle(route: Route) {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    this.requests.push(url)
    if (this.held) await this.held.promise
    const reply = this.responder.respond(url, this.requests.length)
    if ('items' in reply) {
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(reply) })
    }
    return route.fulfill({ status: reply.status, headers: CORS, contentType: reply.contentType ?? 'text/plain', body: reply.body })
  }
}

export interface ZipReply {
  status?: number
  body: Buffer | string
  contentType?: string
}

/**
 * Serves catalog ZIPs from the app origin. A path with no route would fall
 * through to serve-dist's SPA fallback (index.html), so every zipUrl a test
 * downloads must be served here explicitly.
 */
export class CatalogZips {
  /** Paths requested, in order, e.g. "/catalog-e2e/cell-biology.zip". */
  readonly requests: string[] = []
  private readonly gates = new Map<string, Promise<void>>()

  constructor(private readonly page: Page) {}

  /** Serve `zipUrl` (relative, as in the catalog entry). Returns nothing; inspect `requests`. */
  async serve(zipUrl: string, reply: ZipReply | Buffer) {
    const path = `/${zipUrl.replace(/^\//, '')}`
    const r: ZipReply = Buffer.isBuffer(reply) ? { body: reply, contentType: 'application/zip' } : reply
    await this.page.route((url) => url.origin === APP_ORIGIN && url.pathname === path, async (route) => {
      this.requests.push(path)
      const gate = this.gates.get(path)
      if (gate) await gate
      return route.fulfill({ status: r.status ?? 200, contentType: r.contentType ?? 'application/zip', body: r.body })
    })
  }

  /** Fail every download of `zipUrl` at the network level (connection refused). */
  async abort(zipUrl: string) {
    const path = `/${zipUrl.replace(/^\//, '')}`
    await this.page.route((url) => url.origin === APP_ORIGIN && url.pathname === path, (route) => {
      this.requests.push(path)
      return route.abort('connectionrefused')
    })
  }

  /** Hold the next downloads of `zipUrl` until the returned function is called. */
  hold(zipUrl: string): () => void {
    const path = `/${zipUrl.replace(/^\//, '')}`
    let release!: () => void
    this.gates.set(path, new Promise<void>((r) => { release = r }))
    return () => { this.gates.delete(path); release() }
  }

  /** Resolves with the next request for `zipUrl` (start waiting BEFORE the click). */
  waitFor(zipUrl: string): Promise<Request> {
    const path = `/${zipUrl.replace(/^\//, '')}`
    return this.page.waitForRequest((req) => {
      const url = new URL(req.url())
      return url.origin === APP_ORIGIN && url.pathname === path
    })
  }
}
