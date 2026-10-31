/**
 * A mocked MuulOrigin account: signed-in state, plan (entitlements) and a
 * programmable fake of api.muulorigin.com, for every spec that needs a
 * signed-in user (cloud backup, sharing, support, plans).
 *
 * How the app decides it is signed in and on which plan (src/services/auth/
 * muulOriginAuth.ts, src/services/subscription/subscriptionService.ts):
 *   - localStorage `mo_token` holds a JWT; the app decodes `sub`/`email` from
 *     it and never verifies the signature, so a fake token is enough;
 *   - the plan comes from GET /api/entitlements?product=cognitive-canvas. The
 *     mock answers it with the server-generated contract fixtures in
 *     src/services/subscription/__fixtures__ (read, never copied), so a change
 *     to the contract shows up here too.
 *
 * Everything is a MOCK: a pass proves the app's side of the contract, not the
 * real server's. Real sign-in (the www.muulorigin.com redirect and its
 * HttpOnly refresh cookie) cannot be exercised from 127.0.0.1 at all.
 *
 * Routing: a catch-all answers any unmocked API path with 404 `{}` so the
 * signed-in background polls (sharing, support, presence) fail softly instead
 * of being aborted (aborts raise the "Can't reach MuulOrigin" banner). Specific
 * handlers registered later with on() win, because Playwright tries the most
 * recently added route first. Every response carries CORS headers for the app
 * origin, and preflight OPTIONS requests are answered 204.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, Request } from '@playwright/test'
import { baseURL } from '../../config/env.js'

export const MUUL_API = 'https://api.muulorigin.com'
export const MUUL_WWW = 'https://www.muulorigin.com'
const APP_ORIGIN = new URL(baseURL).origin

const FIXTURE_FILE = path.resolve(import.meta.dirname, '..', '..', '..', 'src', 'services', 'subscription', '__fixtures__', 'entitlements-cognitive-canvas.json')
const ENTITLEMENTS = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Record<string, Record<string, unknown>>

/** Scenario keys of the contract fixture: 'free', 'dev' (Economy), 'pro', 'enterprise', 'pro-paused', ... */
export type PlanScenario =
  | 'no-subscription' | 'free' | 'dev' | 'pro' | 'enterprise' | 'alias-fullcommunity' | 'unknown-paid-gold'
  | 'pro-paused' | 'pro-halted' | 'pro-cancelled' | 'pro-cancelling' | 'pro-cancelled-ended' | 'pro-one-time-expired'
  | 'pro-grace' | 'pro-halted-after-grace' | 'pro-retrying' | 'pro-refunded' | 'pro-seat' | 'pro-seat-ended'

export function entitlementsFor(plan: PlanScenario): Record<string, unknown> {
  const body = ENTITLEMENTS[plan]
  if (!body) throw new Error(`no entitlements scenario "${plan}" in ${FIXTURE_FILE}`)
  return structuredClone(body)
}

export interface MuulIdentity {
  sub: string
  email: string
  firstName: string
  lastName: string
  orgId: string
}

/** A reserved-TLD identity: it can never belong to a real person or receive mail. */
export const TEST_IDENTITY: MuulIdentity = {
  sub: 'e2e-user-0001',
  email: 'automation.user@example.invalid',
  firstName: 'Automation',
  lastName: 'User',
  orgId: 'e2e-org-0001',
}

const b64url = (s: string) => Buffer.from(s).toString('base64url')

/** A three-part JWT the app can decode (it never checks the signature or expiry). */
export function fakeJwt(id: MuulIdentity = TEST_IDENTITY): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ sub: id.sub, email: id.email, given_name: id.firstName, family_name: id.lastName }))
  return `${header}.${payload}.e2e-signature`
}

export interface MockReply {
  status?: number
  /** JSON body (default `{}`), or raw bytes/text with an explicit contentType. */
  json?: unknown
  body?: Buffer | string
  contentType?: string
  headers?: Record<string, string>
}

export type MockHandler = (req: Request, url: URL) => MockReply | Promise<MockReply>

export interface RecordedCall {
  method: string
  url: URL
  /** Request body as text (multipart and JSON bodies are readable; binary parts appear as bytes). */
  body: string | null
  /** Raw request body. */
  bodyBuffer: Buffer | null
  headers: Record<string, string>
}

export interface MuulAccountOptions {
  /** Plan scenario for GET /api/entitlements, or null for a signed-out user (no token, no entitlements). Default 'pro'. */
  plan?: PlanScenario | null
  identity?: MuulIdentity
  /** Automatic cloud sync (on by default in the app). Off unless a spec tests it, because it starts uploading 15 s after boot. Default false. */
  cloudSync?: boolean
}

const CORS = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-chunk-sha256, x-requested-with',
  'access-control-expose-headers': '*',
}

export class MuulApiMock {
  /** Every request the app sent to api.muulorigin.com, in order (preflights excluded). */
  readonly calls: RecordedCall[] = []
  readonly identity: MuulIdentity
  readonly token: string | null

  private constructor(private readonly page: Page, readonly plan: PlanScenario | null, identity: MuulIdentity) {
    this.identity = identity
    this.token = plan === null ? null : fakeJwt(identity)
  }

  /**
   * Install before the app is opened. Seeds the signed-in state once per tab
   * (a sessionStorage guard keeps a later sign-out from being undone by a reload).
   */
  static async install(page: Page, opts: MuulAccountOptions = {}): Promise<MuulApiMock> {
    const plan = opts.plan === undefined ? 'pro' : opts.plan
    const mock = new MuulApiMock(page, plan, opts.identity ?? TEST_IDENTITY)

    await page.addInitScript(
      ({ token, sub, cloudSync }) => {
        // The guard's error page for a blocked off-origin navigation denies
        // storage access; there is no app on it to seed.
        try {
          if (sessionStorage.getItem('__e2e_muul_seeded')) return
        } catch {
          return
        }
        sessionStorage.setItem('__e2e_muul_seeded', '1')
        if (token) localStorage.setItem('mo_token', token)
        localStorage.setItem('cc2_cloud_sync_v1', JSON.stringify({ enabled: cloudSync, noticeShownFor: [sub] }))
      },
      { token: mock.token, sub: mock.identity.sub, cloudSync: opts.cloudSync ?? false },
    )

    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.origin !== MUUL_API || req.method() === 'OPTIONS') return
      mock.calls.push({ method: req.method(), url, body: req.postData(), bodyBuffer: req.postDataBuffer(), headers: req.headers() })
    })

    // The SDK scripts in index.html (auth-bridge.js, backup.js) are external code: serve empty stubs.
    await page.route(`${MUUL_WWW}/assets/sdk/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* e2e stub: MuulOrigin SDK not loaded in tests */' }),
    )

    await page.route(`${MUUL_API}/**`, (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      return route.fulfill({ status: 404, contentType: 'application/json', headers: CORS, body: '{}' })
    })

    if (plan !== null) {
      await mock.on('GET', '/api/entitlements', () => ({ json: entitlementsFor(plan) }))
      await mock.on('GET', '/api/iam/auth/me', () => ({
        json: {
          user: { userId: mock.identity.sub, email: mock.identity.email, firstName: mock.identity.firstName, lastName: mock.identity.lastName, emailVerified: true },
          org: { orgId: mock.identity.orgId },
        },
      }))
      // A 401/403 here would sign the user out; answer with the same token instead.
      await mock.on('POST', '/api/iam/auth/refresh', () => ({ json: { token: mock.token } }))
      await mock.on('POST', '/api/iam/auth/logout', () => ({ json: {} }))
    }
    return mock
  }

  /**
   * Answer METHOD + pathname (exact string, or a RegExp tested against the
   * pathname) with `handler`. Registered later than the catch-all, so it wins.
   */
  async on(method: string, pathname: string | RegExp, handler: MockHandler) {
    const matches = (url: URL) => (typeof pathname === 'string' ? url.pathname === pathname : pathname.test(url.pathname))
    await this.page.route(
      (url) => url.origin === MUUL_API && matches(url),
      async (route) => {
        const req = route.request()
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
        if (req.method() !== method.toUpperCase()) return route.fallback()
        const reply = await handler(req, new URL(req.url()))
        const headers = { ...CORS, ...reply.headers }
        if (reply.body !== undefined) {
          return route.fulfill({ status: reply.status ?? 200, headers, contentType: reply.contentType ?? 'application/octet-stream', body: reply.body })
        }
        return route.fulfill({ status: reply.status ?? 200, headers, contentType: 'application/json', body: JSON.stringify(reply.json ?? {}) })
      },
    )
  }

  /** Calls to METHOD + pathname so far. */
  callsTo(method: string, pathname: string | RegExp): RecordedCall[] {
    return this.calls.filter((c) => c.method === method.toUpperCase() && (typeof pathname === 'string' ? c.url.pathname === pathname : pathname.test(c.url.pathname)))
  }

  /** Resolves with the next matching request (start waiting BEFORE the action that sends it). */
  waitForCall(method: string, pathname: string | RegExp, timeout = 15_000): Promise<Request> {
    return this.page.waitForRequest((req) => {
      const url = new URL(req.url())
      return url.origin === MUUL_API && req.method() === method.toUpperCase() && (typeof pathname === 'string' ? url.pathname === pathname : pathname.test(url.pathname))
    }, { timeout })
  }
}
