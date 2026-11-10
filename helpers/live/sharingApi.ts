/**
 * The real sharing API, called the way the app calls it, for the live sharing
 * specs: who an account is, what the server holds mid-test, and removing what
 * a test created.
 *
 * Neither way in refreshes the session in the normal case: the server rotates
 * refresh tokens (two refreshes at once sign one side out) and throttles
 * refreshes (503 after a burst).
 *   - LiveApi, through the account's browser context: the access token the
 *     sign-in set (the mo_token cookie, valid for hours). Only a 401 makes it
 *     refresh, so it still runs only while no page of that context is busy.
 *   - pageGet, inside the app's page with the token the app already holds:
 *     during a test.
 *
 * Paths are those of services/sharing/sharingService.ts.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { LIVE_API, LIVE_ORIGIN } from '../../fixtures/live.js'

export interface Identity { userId: string; email: string; name: string }

export interface InboxNote { id: string; title: string; fromUserId: string; seen: boolean; imported: boolean }
interface SentBundle { id: string; title: string }
export interface SharingOverview {
  me: { id: string; email: string; subscribed: boolean }
  canShare: boolean
  broadcastLists: { id: string; name: string; memberIds?: string[]; shares?: SentBundle[] }[]
  threads: { id: string; otherUserId: string; shares?: SentBundle[] }[]
  inbox: InboxNote[]
  unseenCount: number
}
/** A live share the teacher owns. Stopped ones stay listed (stopped: true): the server keeps them as history and has no call to delete them. */
export interface LiveShareRow { id?: string; shareId?: string; title: string; projectId: string; recipientIds?: string[]; stopped?: boolean; currentVersion?: number }

const liveId = (s: LiveShareRow) => String(s.shareId ?? s.id)

/**
 * What any test run's names carry (fixtures/liveSharing.ts nameTag: "e2e" and a
 * base-36 time), to sweep up what an interrupted cleanup left behind.
 */
export const ANY_RUN_TAG = /e2e[0-9a-z]{8,}/
const carries = (text: string, match: string | RegExp) => (typeof match === 'string' ? text.includes(match) : match.test(text))

/** A 503 or 429 (the server shedding a burst) is waited out: 10 s, then 20 s, then given up. */
const BUSY = [503, 429]
const pause = (attempt: number) => new Promise((r) => setTimeout(r, 10_000 * attempt))

export class LiveApi {
  private token: string | null = null
  constructor(private readonly context: BrowserContext) {}

  private async auth(refresh = false): Promise<string> {
    if (this.token && !refresh) return this.token
    if (!refresh) {
      const cookie = (await this.context.cookies(LIVE_API)).find((c) => c.name === 'mo_token')
      if (cookie) return (this.token = decodeURIComponent(cookie.value))
    }
    for (let attempt = 1; ; attempt++) {
      const res = await this.context.request.post(`${LIVE_API}/api/iam/auth/refresh`, { headers: { Origin: LIVE_ORIGIN }, data: { refreshToken: '' } })
      if (res.ok()) return (this.token = ((await res.json()) as { token: string }).token)
      if (!BUSY.includes(res.status()) || attempt === 3) throw new Error(`session refresh answered ${res.status()}`)
      await pause(attempt)
    }
  }

  /**
   * One call: a 401 (the token expired during a long test) refreshes once; a busy
   * server (503, 429, or no answer within 60 s) is waited out.
   */
  async call<T>(method: 'GET' | 'DELETE', path: string): Promise<{ status: number; body: T | null }> {
    let refreshed = false
    for (let attempt = 1; ; attempt++) {
      const res = await this.context.request.fetch(`${LIVE_API}${path}`, { method, timeout: 60_000, headers: { Origin: LIVE_ORIGIN, Authorization: `Bearer ${await this.auth()}` } })
        .catch((e: Error) => { if (attempt < 3 && /Timeout/.test(e.message)) return null; throw e })
      if (!res) { await pause(attempt); continue }
      if (res.status() === 401 && !refreshed) { refreshed = true; await this.auth(true); continue }
      if (BUSY.includes(res.status()) && attempt < 3) { await pause(attempt); continue }
      const text = await res.text()
      const json = res.headers()['content-type']?.includes('json')
      return { status: res.status(), body: text && json ? JSON.parse(text) as T : null }
    }
  }

  private async get<T>(path: string): Promise<T> {
    const { status, body } = await this.call<T>('GET', path)
    if (status !== 200 || !body) throw new Error(`GET ${path} answered ${status}`)
    return body
  }

  async me(): Promise<Identity> {
    const { user } = await this.get<{ user: { userId: string; email: string; firstName?: string; lastName?: string } }>('/api/iam/auth/me')
    return { userId: user.userId, email: user.email, name: [user.firstName, user.lastName].filter(Boolean).join(' ') }
  }

  overview() { return this.get<SharingOverview>('/api/sharing/overview') }
  async liveMine() { return (await this.get<{ items: LiveShareRow[] }>('/api/sharing/live/mine')).items }

  /**
   * As the sender: stop the live shares, delete the sent copies and the
   * classes whose title or name carries `tag`. Nothing else. Returns what it did.
   */
  async removeSent(tag: string | RegExp): Promise<string> {
    const done: string[] = []
    const del = async (path: string) => done.push(`DELETE ${path} -> ${(await this.call('DELETE', path)).status}`)
    for (const s of await this.liveMine()) if (!s.stopped && carries(s.title, tag)) await del(`/api/sharing/live/${encodeURIComponent(liveId(s))}`)
    const o = await this.overview()
    for (const l of o.broadcastLists) {
      for (const b of l.shares ?? []) if (carries(b.title, tag)) await del(`/api/sharing/lists/${encodeURIComponent(l.id)}/shares/${encodeURIComponent(b.id)}`)
      if (carries(l.name, tag)) await del(`/api/sharing/lists/${encodeURIComponent(l.id)}`)
    }
    for (const t of o.threads) for (const b of t.shares ?? []) if (carries(b.title, tag)) await del(`/api/sharing/threads/${encodeURIComponent(t.otherUserId)}/shares/${encodeURIComponent(b.id)}`)
    return done.join('\n') || 'nothing to remove'
  }

  /** As a recipient: delete the received notes whose title carries `tag`. Nothing else. */
  async removeReceived(tag: string | RegExp): Promise<string> {
    const done: string[] = []
    for (const n of (await this.overview()).inbox) {
      if (!carries(n.title, tag)) continue
      const path = `/api/sharing/inbox/${encodeURIComponent(n.id)}`
      done.push(`DELETE ${path} -> ${(await this.call('DELETE', path)).status}`)
    }
    return done.join('\n') || 'nothing to remove'
  }
}

/** A GET with the token the app on `page` already holds (never refreshes). */
export async function pageGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async ({ api, path }) => {
    const token = localStorage.getItem('mo_token')
    if (!token) throw new Error('no MuulOrigin session on this page')
    const res = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`)
    return res.json()
  }, { api: LIVE_API, path }) as Promise<T>
}
