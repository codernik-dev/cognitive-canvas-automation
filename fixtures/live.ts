/**
 * `test` for the LIVE project (tests/live): the build under test against the
 * REAL MuulOrigin servers, signed in with the dedicated QA account.
 *
 * How the local build reaches the real servers:
 *   - The real API only accepts requests from the app's own address, and the
 *     session is a cookie MuulOrigin shares across *.muulorigin.com. So the
 *     test serves this build's dist/ AT https://cognitivecanvas.muulorigin.com,
 *     inside the test browser only (a route; nothing outside the test changes),
 *     and the app then signs in and calls the API exactly as in production.
 *   - Sign-in happens in its own process (helpers/live/signin.mjs) so the
 *     password never enters a trace or the report. Each test gets a fresh session.
 *
 * Safety:
 *   - Only MuulOrigin's own hosts are reachable; every other request is aborted.
 *   - Everything a test creates on the server carries `run.tag` in its
 *     description, and teardown deletes exactly those records (and nothing
 *     else), whether the test passed or not.
 *   - Cloud auto-sync is off unless a test turns it on, so nothing is uploaded
 *     that the test did not ask for.
 *
 * Skipped unless CC_LIVE_EMAIL and CC_LIVE_PASSWORD are set (config/env.ts).
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DIST_DIR } from '../config/env.js'
import { promisify } from 'node:util'
import type { BrowserContext, Page } from '@playwright/test'
import { test as base, expect } from './test.js'
import { ENV } from '../config/env.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'

export const LIVE_ORIGIN = 'https://cognitivecanvas.muulorigin.com'
export const LIVE_API = 'https://api.muulorigin.com'
const DIST = DIST_DIR
const SIGNIN = path.resolve(import.meta.dirname, '..', 'helpers', 'live', 'signin.mjs')
const isMuul = (u: URL) => u.hostname === 'muulorigin.com' || u.hostname.endsWith('.muulorigin.com')

export interface LiveRun {
  /** Unique per test: put it in every description the test sends, so teardown can find its records. */
  tag: string
  /** Every request the app sent to the real API (method and path only). */
  apiCalls: string[]
}

interface LiveOptions { liveCloudSync: boolean }
interface LiveFixtures { run: LiveRun; liveSession: string }

/**
 * A fresh real MuulOrigin session, signed in out of process: the QA account, or
 * `account` (a sharing student). Returns its storage state file.
 */
export async function newLiveSession(account?: { email: string; password: string }): Promise<{ file: string; dispose: () => void }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cc-live-'))
  const file = path.join(dir, 'session.json')
  const env = account ? { ...process.env, CC_LIVE_EMAIL: account.email, CC_LIVE_PASSWORD: account.password } : { ...process.env }
  // A sign-in now and then does not complete (the sharing tests sign in several accounts per test): try again after a pause.
  for (let attempt = 1; ; attempt++) {
    try {
      await promisify(execFile)(process.execPath, [SIGNIN, file], { env, timeout: 120_000 })
      break
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 20_000 * attempt))
    }
  }
  return { file, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Make `context` a live device: only MuulOrigin's hosts reachable, this build
 * served at the app's real address, cloud auto-sync on or off. API calls (method
 * and path) are pushed to `apiCalls` when given.
 */
export async function installLiveRoutes(context: BrowserContext, cloudSync: boolean, apiCalls?: string[]) {
  await context.route((u) => !isMuul(u) && u.protocol !== 'data:' && u.protocol !== 'blob:', (r) => r.abort('blockedbyclient'))
  await context.route(`${LIVE_ORIGIN}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    const file = path.join(DIST, decodeURIComponent(pathname))
    const servable = file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()
    return route.fulfill({ path: servable ? file : path.join(DIST, 'index.html') })
  })
  if (apiCalls) {
    context.on('request', (r) => {
      const u = new URL(r.url())
      if (u.origin === LIVE_API && r.method() !== 'OPTIONS') apiCalls.push(`${r.method()} ${u.pathname}`)
    })
  }
  await context.addInitScript((sync) => {
    if (sessionStorage.getItem('__e2e_live_seeded')) return
    sessionStorage.setItem('__e2e_live_seeded', '1')
    localStorage.setItem('cc2_cloud_sync_v1', JSON.stringify({ enabled: sync, noticeShownFor: [] }))
  }, cloudSync)
}

export interface CloudItem { id: string; description: string | null; tags: string | null; storageType: string; fileSize: number }

/** The account's real cloud backup records, read with the page's own session (a page on the app's address). */
export async function listCloud(page: Page): Promise<CloudItem[]> {
  return page.evaluate(async (api) => {
    const token = localStorage.getItem('mo_token') ?? document.cookie.match(/(?:^|; )mo_token=([^;]+)/)?.[1]
    if (!token) throw new Error('no MuulOrigin session on this page')
    const auth = { Authorization: `Bearer ${decodeURIComponent(token)}` }
    const items: CloudItem[] = []
    let cursor = ''
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${api}/api/backups?product=CognitiveCanvas&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth })
      if (!res.ok) throw new Error(`cloud list answered ${res.status}`)
      const body = await res.json() as { items?: CloudItem[]; nextCursor?: string }
      items.push(...(body.items ?? []))
      if (!body.nextCursor) break
      cursor = body.nextCursor
    }
    return items
  }, LIVE_API)
}

export const test = base.extend<LiveOptions & LiveFixtures>({
  // The guard below lets through MuulOrigin's own hosts only.
  externalNetwork: 'allow',
  baseURL: LIVE_ORIGIN,
  liveCloudSync: [false, { option: true }],

  liveSession: async ({ externalNetwork: _network }, provide) => {
    test.skip(!ENV.liveEmail || !ENV.livePassword, 'Live tests need CC_LIVE_EMAIL and CC_LIVE_PASSWORD (a dedicated QA account).')
    const session = await newLiveSession()
    await provide(session.file)
    session.dispose()
  },

  storageState: async ({ liveSession }, provide) => provide(liveSession),

  run: [
    async ({ context, liveCloudSync }, provide, testInfo) => {
      const tag = `e2e-${Date.now().toString(36)}-${testInfo.workerIndex}`
      const apiCalls: string[] = []
      await installLiveRoutes(context, liveCloudSync, apiCalls)
      // Evidence of how the real server answered: each call of the teacher's pages with when it left, its status
      // and how long it took, or "no answer" (a slow or silent server shows here). Method and path only, no data.
      const t0 = Date.now()
      const timings: string[] = []
      const open = new Map<object, { i: number; at: number }>()
      context.on('request', (r) => {
        const u = new URL(r.url())
        if (u.origin !== LIVE_API || r.method() === 'OPTIONS') return
        open.set(r, { i: timings.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${r.method()} ${u.pathname} (no answer)`) - 1, at: Date.now() })
      })
      const answered = (r: object, outcome: string) => {
        const e = open.get(r)
        if (!e) return
        open.delete(r)
        timings[e.i] = timings[e.i].replace(/ \(no answer\)$/, ` -> ${outcome} in ${Date.now() - e.at} ms`)
      }
      context.on('requestfinished', (r) => { void r.response().then((res) => answered(r, String(res?.status() ?? '?')), () => answered(r, '?')) })
      context.on('requestfailed', (r) => answered(r, `failed (${r.failure()?.errorText ?? '?'})`))

      await provide({ tag, apiCalls })

      await testInfo.attach('live-api-calls.txt', { body: apiCalls.join('\n'), contentType: 'text/plain' })
      await testInfo.attach('live-api-timings.txt', { body: timings.join('\n'), contentType: 'text/plain' })
      // Teardown: delete every cloud backup this test created (and only those). From a blank page on the
      // app's address, where the app's session is readable: a second copy of the app booting here could
      // navigate mid-request ("Failed to fetch"). A network failure is tried twice more.
      const cleaner = await context.newPage()
      const blank = `${LIVE_ORIGIN}/__live-cleanup__`
      await cleaner.route(blank, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cleanup</title>' }))
      await cleaner.goto(blank)
      const clean = () => cleaner.evaluate(async ({ api, tag }) => {
        const token = localStorage.getItem('mo_token') ?? document.cookie.match(/(?:^|; )mo_token=([^;]+)/)?.[1]
        if (!token) return 'no session'
        const auth = { Authorization: `Bearer ${decodeURIComponent(token)}` }
        const mine: string[] = []
        let cursor = ''
        for (let i = 0; i < 20; i++) {
          const res = await fetch(`${api}/api/backups?product=CognitiveCanvas&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth })
          if (!res.ok) return `list ${res.status}`
          const body = await res.json() as { items?: { id: string; description: string | null; tags: string | null }[]; nextCursor?: string }
          // A run's records carry its tag, or (project names allow letters and digits only) the tag without its dashes.
          for (const it of body.items ?? []) {
            const text = `${it.description ?? ''} ${it.tags ?? ''}`
            if (text.includes(tag) || text.includes(tag.replace(/[^A-Za-z0-9]/g, ''))) mine.push(it.id)
          }
          if (!body.nextCursor) break
          cursor = body.nextCursor
        }
        for (const id of mine) await fetch(`${api}/api/backups/${id}?product=CognitiveCanvas`, { method: 'DELETE', headers: auth })
        return `removed ${mine.length}`
      }, { api: LIVE_API, tag })
      let removed = ''
      for (let attempt = 1; !removed; attempt++) {
        try {
          removed = await clean()
        } catch (e) {
          if (attempt === 3) throw e
          await new Promise((r) => setTimeout(r, 5_000 * attempt))
        }
      }
      await testInfo.attach('live-cleanup.txt', { body: removed, contentType: 'text/plain' })
      await cleaner.close()
    },
    { auto: true },
  ],

  // Re-declared so the routes and the session are in place before the app opens.
  app: async ({ page, run: _run }, provide) => {
    await provide(new CognitiveCanvas(page))
  },
})

export { expect }
