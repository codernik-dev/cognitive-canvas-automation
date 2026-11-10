/**
 * A STATEFUL in-memory fake of the MuulOrigin sharing API (and the IAM
 * directory / team routes the sharing screens use), living in the Node test
 * process. One instance can serve several pages, each signed in as a
 * different identity: a share POSTed by the teacher's page is stored here and
 * really delivered to the student's page on its next poll. Uploaded payloads
 * (project ZIPs, live data ZIPs, live files) are stored and served back
 * byte for byte.
 *
 * Everything is a MOCK of the client's contract, read from the client:
 * a pass proves the app's side, not the real server's.
 *
 * ── Client contract (src/services/sharing/sharingService.ts, liveSyncService.ts,
 *    liveFiles.ts, shareLimits.ts, resolveUsers.ts, services/auth/orgService.ts) ──
 * All calls: https://api.muulorigin.com, `Authorization: Bearer <mo_token>`,
 * non-2xx = soft failure (toast / empty state); 401 -> one refresh + retry.
 *
 *   GET    /api/sharing/overview                    -> {me, canShare, broadcastLists, threads, inbox, unseenCount, liveSubscriptions}
 *          polled: LiveAutoSync every 3 s (signed in, tab visible, online), bell/profile menu every 20 s,
 *          Live badge every 15 s; one shared fetcher dedupes them (SNAPSHOT_REUSE_MS 5 s).
 *   GET    /api/sharing/capabilities                -> {maxUploadBytes, chunkedUpload, maxChunkBytes, applicationMaxBytes, liveFiles}
 *          cached for the session; any failure -> fallback 90 MB, no chunking, no liveFiles.
 *   GET    /api/iam/users/search?q=<min 2 chars>    -> {users:[{userId,email,firstName,lastName,subscribed}]}; 429 "... in N seconds" -> "Searching too fast"
 *   POST   /api/iam/users/lookup {userIds}          -> {users:[...]} (names for unknown ids, background)
 *   POST   /api/sharing/lists {name,colorKey,memberIds}        -> 201 BroadcastList   (403 {code:'plan_required',message} = plan refusal)
 *   PATCH  /api/sharing/lists/:id {name?,colorKey?}            -> 200 (404 = gone or not yours, 403 = no subscription, 400 = bad name)
 *   DELETE /api/sharing/lists/:id                              -> 204
 *   POST   /api/sharing/lists/:id/members {userId}             -> 204    DELETE /api/sharing/lists/:id/members/:userId -> 204
 *   POST   /api/sharing/lists/:id/shares   multipart           -> 201 {delivered}
 *   POST   /api/sharing/threads/:userId/shares multipart       -> 201
 *          multipart fields: projectId, title, itemSummary ('Project copy'), icon ('📄'), documentIds (JSON),
 *          documents (JSON [{id,name}]), blob (snapshot.zip = exportProjects(.., {excludePrivate, documentIds}))
 *   DELETE /api/sharing/lists/:id/shares/:bundleId | /threads/:userId/shares/:bundleId | /threads/:userId -> 204
 *   POST   /api/sharing/inbox/seen                             -> 204 (bell opened / Received board shown)
 *   GET    /api/sharing/inbox/:noteId/download                 -> application/zip (restoreProject on the device)
 *   DELETE /api/sharing/inbox/:noteId                          -> 204
 *   Live (format 1 = whole zip per version; format 2 = files stored once by SHA-256, used only when
 *   capabilities.liveFiles is true and localStorage cc2_live_protocol !== '1'):
 *   POST   /api/sharing/live multipart {projectId,title,recipientIds(JSON),documentIds(JSON),[listId],[format='2'],blob live.zip} -> {shareId, version}
 *   POST   /api/sharing/live/:id/push multipart {blob,[format='2'],[title]} -> {version}; 409 = stopped (format 2: 409 {missing:[sha]})
 *   GET    /api/sharing/live/mine                              -> {items:[{shareId,projectId,title,documentIds,recipientIds,listIds,currentVersion,lastPushedAt,stopped,createdAt}]}
 *   DELETE /api/sharing/live/:id                               -> 204 (stopped flag; recipients keep their copy)
 *   GET    /api/sharing/live/:id/mirror?version=&format=2      -> zip, header x-live-version; 404 = version gone
 *          recipient asks ?version=<current>&format=2 first, then walks lastMerged+1..current without format
 *   POST   /api/sharing/live/:id/seen {version}                -> 204
 *   PATCH  /api/sharing/live/:id/recipients/me {mirrorToLibrary?|stopNoticeAcknowledged?} -> 204
 *   POST   /api/sharing/live/:id/recipients {userId}           -> 204    DELETE /api/sharing/live/:id/recipients/:userId -> 204
 *   GET    /api/sharing/live/:id/delivery                      -> {recipients:[{userId,lastSeenVersion,lastSeenAt,upToDate}]}
 *   PATCH  /api/sharing/live/presence {away}                   -> 204
 *   POST   /api/sharing/live/files/check {hashes}              -> {missing}
 *   POST   /api/sharing/live/files/:sha  (raw bytes)           -> 204
 *   GET    /api/sharing/live/:id/files/:sha                    -> bytes
 *   Team (orgService.ts):
 *   GET    /api/iam/orgs/:orgId/members?product=cognitive-canvas&limit=100 -> {items:[{userId,email,firstName,lastName,appRole,grantedAt,isOwner}]}
 *   POST   /api/iam/orgs/:orgId/members {userId,product,appRole,permissions} -> 200
 *   DELETE /api/iam/orgs/:orgId/members/:userId              -> 204
 *   POST   /api/iam/users/signup {email,password,firstName,lastName,appRole} -> {userId,orgId,email,role,status}
 *
 * Server behaviour assumed where the client does not say: a copy download
 * marks the note `imported`; a member added to a class is subscribed to the
 * live shares linked to that class; the fake does not enforce plan caps
 * itself (tests inject refusals with `override`).
 */
import { createHash } from 'node:crypto'
import type { Request } from '@playwright/test'
import { unzipSync, zipSync, strFromU8 } from 'fflate'
import { MuulApiMock, entitlementsFor, type MockReply, type MuulIdentity, type PlanScenario } from './muulAccount.js'

/* ── model ─────────────────────────────────────────────────────────────── */

export interface Person {
  id: string
  email: string
  firstName: string
  lastName: string
  /** Paid subscription: can share. Derived from the plan when registered through attach(). */
  subscribed: boolean
  orgId: string
}

export interface Bundle {
  id: string
  fromUserId: string
  title: string
  itemSummary: string
  icon: string
  projectId: string
  createdAt: number
  documentIds: string[]
  documents: Array<{ id: string; name: string }>
  zip: Buffer
}

export interface ClassList {
  id: string
  name: string
  colorKey: string
  ownerId: string
  memberIds: string[]
  shares: Bundle[]
  createdAt: number
}

export interface Thread {
  ownerId: string
  otherUserId: string
  shares: Bundle[]
  updatedAt: number
}

export interface InboxNote {
  id: string
  toUserId: string
  fromUserId: string
  title: string
  itemSummary: string
  icon: string
  createdAt: number
  seen: boolean
  imported: boolean
  documentIds: string[]
  documents: Array<{ id: string; name: string }>
  zip: Buffer
}

export interface LiveVersion {
  version: number
  format: 1 | 2
  zip: Buffer
  createdAt: number
}

export interface RecipientState {
  lastSeenVersion: number
  lastSeenAt: number | null
  mirrorToLibrary?: boolean
  stopNoticeAcknowledged?: boolean
}

export interface LiveShare {
  shareId: string
  ownerId: string
  projectId: string
  title: string
  documentIds: string[]
  recipientIds: string[]
  listIds: string[]
  versions: LiveVersion[]
  createdAt: number
  lastPushedAt: number | null
  stopped: boolean
  recipients: Map<string, RecipientState>
}

export interface OrgMemberRow {
  userId: string
  appRole: 'viewer' | 'editor' | 'admin'
  grantedAt: number
  isOwner?: boolean
}

export interface Capabilities {
  maxUploadBytes: number
  chunkedUpload: boolean
  maxChunkBytes: number
  applicationMaxBytes: number
  liveFiles: boolean
}

/** One multipart part. */
export interface Part {
  name: string
  filename?: string
  contentType?: string
  data: Buffer
  text: string
}

/** A request the fake answered, with its body decoded. */
export interface SharingCall {
  caller: string
  method: string
  path: string
  query: URLSearchParams
  json: unknown
  form: Map<string, Part> | null
  raw: Buffer | null
  status: number
}

type Handler = (ctx: Ctx) => MockReply | Promise<MockReply>
interface Ctx {
  caller: Person
  method: string
  path: string
  params: string[]
  query: URLSearchParams
  json: unknown
  form: Map<string, Part> | null
  raw: Buffer | null
  req: Request
}

interface Override {
  method: string
  path: RegExp
  times: number
  reply: (ctx: Ctx) => MockReply | Promise<MockReply>
}

interface HoldEntry {
  method: string
  path: RegExp
  /** Matching requests still to let through before the one that is held. */
  pass: number
  armed: boolean
  reached: () => void
  release: (reply?: MockReply) => void
  released: Promise<MockReply | undefined>
}

/** A request the fake keeps waiting until the test lets it go (see `SharingBackend.hold`). */
export interface Hold {
  /** Resolves once the held request has arrived and is waiting. */
  reached: Promise<void>
  /**
   * Let it through: the fake then answers it as usual, or with `reply` when one is given. A reply
   * answers this one request only, so later requests on the same path get the fake's own answer.
   */
  release: (reply?: MockReply) => void
}

/* ── small utilities, exported for specs ───────────────────────────────── */

export const sha256 = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Parse a multipart/form-data body (the shape Chromium sends for FormData). */
export function parseMultipart(body: Buffer, contentType: string): Map<string, Part> {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) throw new Error(`not multipart: ${contentType}`)
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`)
  const parts = new Map<string, Part>()
  let pos = body.indexOf(boundary)
  while (pos !== -1) {
    const start = pos + boundary.length
    if (body.slice(start, start + 2).toString() === '--') break
    const headerEnd = body.indexOf('\r\n\r\n', start)
    const next = body.indexOf(boundary, headerEnd)
    if (headerEnd === -1 || next === -1) break
    const headers = body.slice(start + 2, headerEnd).toString('utf8')
    const data = body.slice(headerEnd + 4, next - 2) // part ends with CRLF before the boundary
    const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? ''
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1]
    const ct = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]
    parts.set(name, { name, filename, contentType: ct, data, text: data.toString('utf8') })
    pos = next
  }
  return parts
}

/** Unzip a payload into name -> bytes. */
export function unzip(buf: Buffer | Uint8Array): Record<string, Uint8Array> {
  return unzipSync(buf instanceof Buffer ? new Uint8Array(buf) : buf)
}

/** JSON entry of an unzipped payload. */
export function zipJson<T>(files: Record<string, Uint8Array>, name: string): T {
  const f = files[name]
  if (!f) throw new Error(`zip has no ${name}; it has: ${Object.keys(files).join(', ')}`)
  return JSON.parse(strFromU8(f)) as T
}

const fullName = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ')
const noContent: MockReply = { status: 204, body: '', contentType: 'text/plain' }
const notFound = (message = 'Not found'): MockReply => ({ status: 404, json: { message } })

/** Paid plans can share (server-side `subscribed`). */
export function planCanShare(plan: PlanScenario | null): boolean {
  if (plan === null) return false
  const e = entitlementsFor(plan) as { status?: string; caps?: { copyShare?: { enabled?: boolean } } }
  return e.status === 'active' && !!e.caps?.copyShare?.enabled
}

/* ── the fake ──────────────────────────────────────────────────────────── */

export class SharingBackend {
  readonly people = new Map<string, Person>()
  readonly lists: ClassList[] = []
  readonly threads: Thread[] = []
  readonly inbox: InboxNote[] = []
  readonly live: LiveShare[] = []
  /** Format-2 file store: ownerId -> sha256 -> bytes. */
  readonly files = new Map<string, Map<string, Buffer>>()
  readonly orgs = new Map<string, OrgMemberRow[]>()
  readonly calls: SharingCall[] = []
  /** Users who signed out (owner presence). */
  readonly away = new Set<string>()
  capabilities: Capabilities | null = { maxUploadBytes: 90 * 1024 * 1024, chunkedUpload: false, maxChunkBytes: 0, applicationMaxBytes: 0, liveFiles: false }
  /** Search answers 429 with this many seconds while set. */
  searchRateLimitSeconds: number | null = null

  private seq = 0
  private readonly overrides: Override[] = []
  private readonly holds: HoldEntry[] = []
  private readonly routes: Array<[string, RegExp, Handler]> = []

  constructor() {
    this.defineRoutes()
  }

  nextId(prefix: string) {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  /* ── people ── */

  /** Put someone in the directory (searchable, resolvable). */
  addPerson(id: MuulIdentity, subscribed: boolean): Person {
    const p: Person = { id: id.sub, email: id.email, firstName: id.firstName, lastName: id.lastName, subscribed, orgId: id.orgId }
    this.people.set(p.id, p)
    if (!this.orgs.has(p.orgId)) this.orgs.set(p.orgId, [{ userId: p.id, appRole: 'admin', grantedAt: Date.now(), isOwner: true }])
    return p
  }

  person(id: string): Person {
    const p = this.people.get(id)
    if (!p) throw new Error(`unknown person ${id}`)
    return p
  }

  /**
   * Serve this backend to the page `mock` belongs to, as the mock's identity.
   * Call before the app opens (the account fixture does this for the main page).
   */
  async attach(mock: MuulApiMock): Promise<void> {
    if (mock.plan === null) return // signed out: no token, nothing to serve
    if (!this.people.has(mock.identity.sub)) this.addPerson(mock.identity, planCanShare(mock.plan))
    const callerId = mock.identity.sub
    const pattern = /^\/api\/(sharing\/|iam\/users\/(search|lookup|signup)$|iam\/orgs\/)/
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      await mock.on(method, pattern, (req, url) => this.dispatch(callerId, req, url))
    }
  }

  /**
   * Answer the next `times` matching requests with `reply` instead of the
   * fake's own logic (server errors, plan refusals, hung requests).
   */
  override(method: string, path: RegExp, reply: MockReply | ((ctx: Ctx) => MockReply | Promise<MockReply>), times = Number.POSITIVE_INFINITY) {
    const o: Override = { method: method.toUpperCase(), path, times, reply: typeof reply === 'function' ? reply : () => reply }
    this.overrides.push(o)
    return { clear: () => { o.times = 0 } }
  }

  /**
   * Keep one matching request waiting until `release()`, then answer it with the
   * fake's own logic. `pass` lets that many matching requests through first, so
   * "the second push from now" can be held while the first goes on. Holds the
   * request open in the browser: a test must release what it holds.
   */
  hold(method: string, path: RegExp, { pass = 0 }: { pass?: number } = {}): Hold {
    let reached!: () => void
    let release!: (reply?: MockReply) => void
    const reachedP = new Promise<void>((r) => { reached = r })
    const released = new Promise<MockReply | undefined>((r) => { release = r })
    this.holds.push({ method: method.toUpperCase(), path, pass, armed: true, reached, release, released })
    return { reached: reachedP, release }
  }

  /** Let every held request go and disarm the rest (fixture teardown: a failed test must not leave a request hanging). */
  releaseAll() {
    for (const h of this.holds) { h.armed = false; h.release() }
  }

  /** Requests the fake has answered, optionally filtered. */
  callsTo(method: string, path: string | RegExp, caller?: string): SharingCall[] {
    return this.calls.filter((c) => c.method === method.toUpperCase()
      && (typeof path === 'string' ? c.path === path : path.test(c.path))
      && (!caller || c.caller === caller))
  }

  /* ── seeding (state a test starts from) ── */

  seedList(ownerId: string, name: string, memberIds: string[], colorKey = 'teal'): ClassList {
    const l: ClassList = { id: this.nextId('list'), name, colorKey, ownerId, memberIds: [...memberIds], shares: [], createdAt: Date.now() - 60_000 }
    this.lists.push(l)
    return l
  }

  /** A copy already delivered to `toUserId` (and recorded in the sender's thread). */
  seedCopy(fromUserId: string, toUserId: string, bundle: Omit<Bundle, 'id' | 'fromUserId' | 'createdAt'> & { createdAt?: number }, opts: { seen?: boolean; imported?: boolean } = {}): InboxNote {
    const b: Bundle = { ...bundle, id: this.nextId('bundle'), fromUserId, createdAt: bundle.createdAt ?? Date.now() - 30_000 }
    this.threadOf(fromUserId, toUserId).shares.push(b)
    return this.deliver(b, toUserId, opts)
  }

  /** A thread with sends but no recipient side (for people-cap tests). */
  seedThread(ownerId: string, otherUserId: string, title = 'Earlier share'): Thread {
    const th = this.threadOf(ownerId, otherUserId)
    th.shares.push({ id: this.nextId('bundle'), fromUserId: ownerId, title, itemSummary: 'Project copy', icon: '📄', projectId: 'p-old', createdAt: Date.now() - 86_400_000, documentIds: [], documents: [], zip: Buffer.alloc(0) })
    return th
  }

  addOrgMember(orgId: string, userId: string, appRole: OrgMemberRow['appRole'] = 'viewer') {
    const rows = this.orgs.get(orgId) ?? []
    rows.push({ userId, appRole, grantedAt: Date.now() - rows.length * 1000 })
    this.orgs.set(orgId, rows)
  }

  /* ── queries for assertions ── */

  inboxOf(userId: string) { return this.inbox.filter((n) => n.toUserId === userId) }
  listsOf(ownerId: string) { return this.lists.filter((l) => l.ownerId === ownerId) }
  liveOf(ownerId: string) { return this.live.filter((s) => s.ownerId === ownerId) }
  threadOf(ownerId: string, otherUserId: string): Thread {
    let th = this.threads.find((t) => t.ownerId === ownerId && t.otherUserId === otherUserId)
    if (!th) { th = { ownerId, otherUserId, shares: [], updatedAt: Date.now() }; this.threads.push(th) }
    return th
  }

  /* ── dispatch ── */

  private async dispatch(callerId: string, req: Request, url: URL): Promise<MockReply> {
    const method = req.method().toUpperCase()
    const path = url.pathname
    const raw = req.postDataBuffer()
    const ct = req.headers()['content-type'] ?? ''
    let json: unknown = null
    let form: Map<string, Part> | null = null
    if (raw && /multipart\/form-data/i.test(ct)) form = parseMultipart(raw, ct)
    else if (raw && raw.length && !/octet-stream/i.test(ct)) { try { json = JSON.parse(raw.toString('utf8')) } catch { json = null } }
    const caller = this.person(callerId)
    const auth = req.headers()['authorization'] ?? ''
    const ctxBase = { caller, method, path, query: url.searchParams, json, form, raw, req }

    const record = (status: number) => this.calls.push({ caller: callerId, method, path, query: url.searchParams, json, form, raw, status })
    if (!auth.startsWith('Bearer ')) { record(401); return { status: 401, json: { message: 'Unauthorized' } } }

    // Every armed hold counts this request; the first one whose turn it is keeps it waiting.
    let holdHere: HoldEntry | undefined
    for (const h of this.holds) {
      if (!h.armed || h.method !== method || !h.path.test(path)) continue
      if (h.pass > 0) h.pass -= 1
      else if (!holdHere) { holdHere = h; h.armed = false }
    }
    if (holdHere) {
      holdHere.reached()
      const answer = await holdHere.released
      if (answer) { record(answer.status ?? 200); return answer }
    }

    const o = this.overrides.find((x) => x.times > 0 && x.method === method && x.path.test(path))
    if (o) {
      o.times -= 1
      const reply = await o.reply({ ...ctxBase, params: [] })
      record(reply.status ?? 200)
      return reply
    }
    for (const [m, re, h] of this.routes) {
      if (m !== method) continue
      const hit = re.exec(path)
      if (!hit) continue
      const reply = await h({ ...ctxBase, params: hit.slice(1).map(decodeURIComponent) })
      record(reply.status ?? 200)
      return reply
    }
    record(404)
    return notFound(`fake has no route for ${method} ${path}`)
  }

  private route(method: string, re: RegExp, h: Handler) {
    this.routes.push([method, re, h])
  }

  /* ── shaping responses ── */

  private bundleOut(b: Bundle) {
    const { zip: _zip, ...rest } = b
    return rest
  }

  private listOut(l: ClassList) {
    return { ...l, shares: l.shares.map((b) => this.bundleOut(b)) }
  }

  private noteOut(n: InboxNote) {
    const from = this.people.get(n.fromUserId)
    const { zip: _zip, toUserId: _to, ...rest } = n
    return { ...rest, fromName: from ? fullName(from) : undefined, fromEmail: from?.email }
  }

  private subscriptionOut(s: LiveShare, userId: string) {
    const st = s.recipients.get(userId) ?? { lastSeenVersion: 0, lastSeenAt: null }
    const owner = this.people.get(s.ownerId)
    return {
      shareId: s.shareId,
      ownerId: s.ownerId,
      ownerName: owner ? fullName(owner) : '',
      title: s.title,
      currentVersion: s.versions.length,
      lastSeenVersion: st.lastSeenVersion,
      createdAt: s.createdAt,
      lastPushedAt: s.lastPushedAt,
      stopped: s.stopped,
      ownerAway: this.away.has(s.ownerId),
      ...(st.mirrorToLibrary !== undefined ? { mirrorToLibrary: st.mirrorToLibrary } : {}),
      ...(st.stopNoticeAcknowledged !== undefined ? { stopNoticeAcknowledged: st.stopNoticeAcknowledged } : {}),
    }
  }

  private ownedOut(s: LiveShare) {
    return {
      shareId: s.shareId, projectId: s.projectId, title: s.title, documentIds: s.documentIds, recipientIds: s.recipientIds,
      listIds: s.listIds, currentVersion: s.versions.length, lastPushedAt: s.lastPushedAt, stopped: s.stopped, createdAt: s.createdAt,
    }
  }

  overview(userId: string) {
    const me = this.person(userId)
    const inbox = this.inboxOf(userId).sort((a, b) => b.createdAt - a.createdAt)
    return {
      me: { id: me.id, email: me.email, displayName: fullName(me), subscribed: me.subscribed },
      canShare: me.subscribed,
      broadcastLists: me.subscribed ? this.listsOf(userId).map((l) => this.listOut(l)) : [],
      threads: me.subscribed
        ? this.threads.filter((t) => t.ownerId === userId).map((t) => ({ id: `thread-${t.otherUserId}`, otherUserId: t.otherUserId, shares: t.shares.map((b) => this.bundleOut(b)), updatedAt: t.updatedAt }))
        : [],
      inbox: inbox.map((n) => this.noteOut(n)),
      unseenCount: inbox.filter((n) => !n.seen).length,
      liveSubscriptions: this.live.filter((s) => s.recipientIds.includes(userId)).map((s) => this.subscriptionOut(s, userId)),
    }
  }

  private userOut(p: Person) {
    return { userId: p.id, email: p.email, firstName: p.firstName, lastName: p.lastName, subscribed: p.subscribed }
  }

  /* ── copy shares ── */

  private bundleFromForm(ctx: Ctx): Bundle | MockReply {
    const f = ctx.form
    const blob = f?.get('blob')
    if (!f || !blob) return { status: 400, json: { message: 'multipart body with a blob is required' } }
    const documents = f.get('documents') ? JSON.parse(f.get('documents')!.text) as Array<{ id: string; name: string }> : []
    return {
      id: this.nextId('bundle'),
      fromUserId: ctx.caller.id,
      title: f.get('title')?.text ?? '',
      itemSummary: f.get('itemSummary')?.text ?? '',
      icon: f.get('icon')?.text ?? '',
      projectId: f.get('projectId')?.text ?? '',
      createdAt: Date.now(),
      documentIds: f.get('documentIds') ? JSON.parse(f.get('documentIds')!.text) as string[] : documents.map((d) => d.id),
      documents,
      zip: Buffer.from(blob.data),
    }
  }

  private deliver(b: Bundle, toUserId: string, opts: { seen?: boolean; imported?: boolean } = {}): InboxNote {
    const n: InboxNote = {
      id: this.nextId('note'), toUserId, fromUserId: b.fromUserId, title: b.title, itemSummary: b.itemSummary, icon: b.icon,
      createdAt: b.createdAt, seen: opts.seen ?? false, imported: opts.imported ?? false, documentIds: b.documentIds, documents: b.documents, zip: b.zip,
    }
    this.inbox.push(n)
    return n
  }

  /* ── live helpers ── */

  private liveFor(ctx: Ctx, id: string, ownerOnly = false): LiveShare | MockReply {
    const s = this.live.find((x) => x.shareId === id)
    if (!s) return notFound('No such live share')
    if (ownerOnly && s.ownerId !== ctx.caller.id) return notFound('No such live share')
    if (!ownerOnly && s.ownerId !== ctx.caller.id && !s.recipientIds.includes(ctx.caller.id)) return { status: 403, json: { message: 'Not a recipient' } }
    return s
  }

  /** Files a format-2 data zip lists that the owner has not uploaded. */
  private missingFiles(ownerId: string, zip: Buffer): string[] {
    const files = unzip(zip)
    if (!files['live-manifest.json']) return []
    const manifest = zipJson<{ files: Array<{ sha256: string }> }>(files, 'live-manifest.json')
    const store = this.files.get(ownerId) ?? new Map()
    return [...new Set(manifest.files.map((f) => f.sha256))].filter((h) => !store.has(h))
  }

  /** A format-2 version served in the old shape: its files packed back in. */
  private packed(ownerId: string, zip: Buffer): Buffer {
    const files = unzip(zip)
    const manifest = zipJson<{ files: Array<{ path: string; sha256: string }> }>(files, 'live-manifest.json')
    const store = this.files.get(ownerId) ?? new Map<string, Buffer>()
    const out: Record<string, Uint8Array> = {}
    for (const [k, v] of Object.entries(files)) if (k !== 'live-manifest.json') out[k] = v
    for (const f of manifest.files) { const b = store.get(f.sha256); if (b) out[f.path] = new Uint8Array(b) }
    return Buffer.from(zipSync(out))
  }

  /* ── routes ── */

  private defineRoutes() {
    const id = '([^/]+)'
    const R = (method: string, path: string, h: Handler) => this.route(method, new RegExp(`^${path}$`), h)

    R('GET', '/api/sharing/overview', (c) => ({ json: this.overview(c.caller.id) }))
    R('GET', '/api/sharing/capabilities', () => (this.capabilities ? { json: this.capabilities } : notFound()))

    /* directory */
    R('GET', '/api/iam/users/search', (c) => {
      if (this.searchRateLimitSeconds !== null) return { status: 429, body: `Too many searches. Try again in ${this.searchRateLimitSeconds} seconds.`, contentType: 'text/plain' }
      const q = (c.query.get('q') ?? '').trim().toLowerCase()
      const users = [...this.people.values()]
        .filter((p) => p.id !== c.caller.id && q.length >= 2 && (p.email.toLowerCase().startsWith(q) || fullName(p).toLowerCase().includes(q)))
        .map((p) => this.userOut(p))
      return { json: { users } }
    })
    R('POST', '/api/iam/users/lookup', (c) => {
      const ids = ((c.json as { userIds?: string[] })?.userIds ?? [])
      return { json: { users: ids.map((x) => this.people.get(x)).filter((p): p is Person => !!p).map((p) => this.userOut(p)) } }
    })
    R('POST', '/api/iam/users/signup', (c) => {
      const b = c.json as { email: string; firstName?: string; lastName?: string; appRole?: string }
      if ([...this.people.values()].some((p) => p.email.toLowerCase() === b.email.toLowerCase())) return { status: 409, json: { message: 'An account with this email already exists.' } }
      const p: Person = { id: this.nextId('user'), email: b.email, firstName: b.firstName ?? '', lastName: b.lastName ?? '', subscribed: false, orgId: this.nextId('org') }
      this.people.set(p.id, p)
      return { json: { userId: p.id, orgId: p.orgId, email: p.email, role: b.appRole ?? 'viewer', status: 'active', firstName: p.firstName, lastName: p.lastName } }
    })

    /* team (IAM orgs) */
    R('GET', `/api/iam/orgs/${id}/members`, (c) => {
      const rows = this.orgs.get(c.params[0])
      if (!rows) return notFound('Organization not found')
      return {
        json: {
          items: rows.map((r) => {
            const p = this.people.get(r.userId)
            return { userId: r.userId, email: p?.email ?? '', firstName: p?.firstName, lastName: p?.lastName, appRole: r.appRole, grantedAt: r.grantedAt, isOwner: !!r.isOwner, products: [] }
          }),
          nextCursor: null,
        },
      }
    })
    R('POST', `/api/iam/orgs/${id}/members`, (c) => {
      const b = c.json as { userId: string; appRole: OrgMemberRow['appRole'] }
      const rows = this.orgs.get(c.params[0])
      if (!rows) return notFound('Organization not found')
      if (!rows.some((r) => r.userId === b.userId)) rows.push({ userId: b.userId, appRole: b.appRole, grantedAt: Date.now() })
      return { json: { product: 'cognitive-canvas', appRole: b.appRole, permissions: [] } }
    })
    R('DELETE', `/api/iam/orgs/${id}/members/${id}`, (c) => {
      const rows = this.orgs.get(c.params[0])
      if (!rows) return notFound('Organization not found')
      const i = rows.findIndex((r) => r.userId === c.params[1])
      if (i === -1) return notFound('Member not found')
      rows.splice(i, 1)
      return noContent
    })

    /* classes (broadcast lists) */
    R('POST', '/api/sharing/lists', (c) => {
      const b = c.json as { name: string; colorKey: string; memberIds: string[] }
      const l: ClassList = { id: this.nextId('list'), name: b.name, colorKey: b.colorKey, ownerId: c.caller.id, memberIds: [...new Set(b.memberIds)], shares: [], createdAt: Date.now() }
      this.lists.push(l)
      return { status: 201, json: this.listOut(l) }
    })
    const ownList = (c: Ctx) => this.lists.find((l) => l.id === c.params[0] && l.ownerId === c.caller.id)
    R('PATCH', `/api/sharing/lists/${id}`, (c) => {
      const l = ownList(c)
      if (!l) return notFound()
      const b = c.json as { name?: string; colorKey?: string }
      if (b.name !== undefined) {
        if (!b.name.trim() || b.name.trim().length > 100) return { status: 400, json: { message: 'Bad name' } }
        l.name = b.name.trim()
      }
      if (b.colorKey !== undefined) l.colorKey = b.colorKey
      return { json: this.listOut(l) }
    })
    R('DELETE', `/api/sharing/lists/${id}`, (c) => {
      const i = this.lists.findIndex((l) => l.id === c.params[0] && l.ownerId === c.caller.id)
      if (i === -1) return notFound()
      this.lists.splice(i, 1)
      for (const s of this.live) s.listIds = s.listIds.filter((x) => x !== c.params[0])
      return noContent
    })
    R('POST', `/api/sharing/lists/${id}/members`, (c) => {
      const l = ownList(c)
      if (!l) return notFound()
      const uid = (c.json as { userId: string }).userId
      if (!l.memberIds.includes(uid)) l.memberIds.push(uid)
      for (const s of this.live) if (!s.stopped && s.listIds.includes(l.id) && !s.recipientIds.includes(uid)) s.recipientIds.push(uid)
      return noContent
    })
    R('DELETE', `/api/sharing/lists/${id}/members/${id}`, (c) => {
      const l = ownList(c)
      if (!l) return notFound()
      l.memberIds = l.memberIds.filter((x) => x !== c.params[1])
      return noContent
    })
    R('POST', `/api/sharing/lists/${id}/shares`, (c) => {
      const l = ownList(c)
      if (!l) return notFound()
      const b = this.bundleFromForm(c)
      if (!('zip' in b)) return b
      l.shares.push(b)
      for (const m of l.memberIds) this.deliver(b, m)
      return { status: 201, json: { delivered: l.memberIds.length } }
    })
    R('DELETE', `/api/sharing/lists/${id}/shares/${id}`, (c) => {
      const l = ownList(c)
      if (!l) return notFound()
      l.shares = l.shares.filter((b) => b.id !== c.params[1])
      return noContent
    })

    /* 1-on-1 */
    R('POST', `/api/sharing/threads/${id}/shares`, (c) => {
      if (!this.people.has(c.params[0])) return notFound('No such user')
      const b = this.bundleFromForm(c)
      if (!('zip' in b)) return b
      const th = this.threadOf(c.caller.id, c.params[0])
      th.shares.push(b)
      th.updatedAt = Date.now()
      this.deliver(b, c.params[0])
      return { status: 201, json: {} }
    })
    R('DELETE', `/api/sharing/threads/${id}/shares/${id}`, (c) => {
      const th = this.threads.find((t) => t.ownerId === c.caller.id && t.otherUserId === c.params[0])
      if (th) th.shares = th.shares.filter((b) => b.id !== c.params[1])
      return noContent
    })
    R('DELETE', `/api/sharing/threads/${id}`, (c) => {
      const i = this.threads.findIndex((t) => t.ownerId === c.caller.id && t.otherUserId === c.params[0])
      if (i !== -1) this.threads.splice(i, 1)
      return noContent
    })

    /* inbox */
    R('POST', '/api/sharing/inbox/seen', (c) => {
      for (const n of this.inboxOf(c.caller.id)) n.seen = true
      return noContent
    })
    R('GET', `/api/sharing/inbox/${id}/download`, (c) => {
      const n = this.inbox.find((x) => x.id === c.params[0] && x.toUserId === c.caller.id)
      if (!n) return notFound()
      n.imported = true
      return { body: n.zip, contentType: 'application/zip' }
    })
    R('DELETE', `/api/sharing/inbox/${id}`, (c) => {
      const i = this.inbox.findIndex((x) => x.id === c.params[0] && x.toUserId === c.caller.id)
      if (i !== -1) this.inbox.splice(i, 1)
      return noContent
    })

    /* live: files (format 2) — before the /live/:id routes so "files" is not read as a share id */
    R('POST', '/api/sharing/live/files/check', (c) => {
      const store = this.files.get(c.caller.id) ?? new Map()
      const hashes = (c.json as { hashes?: string[] })?.hashes ?? []
      return { json: { missing: hashes.filter((h) => !store.has(h)) } }
    })
    R('POST', `/api/sharing/live/files/${id}`, (c) => {
      const body = c.raw ?? Buffer.alloc(0)
      if (sha256(body) !== c.params[0]) return { status: 400, json: { message: 'SHA-256 does not match the bytes' } }
      if (!this.files.has(c.caller.id)) this.files.set(c.caller.id, new Map())
      this.files.get(c.caller.id)!.set(c.params[0], Buffer.from(body))
      return noContent
    })
    R('PATCH', '/api/sharing/live/presence', (c) => {
      if ((c.json as { away?: boolean })?.away) this.away.add(c.caller.id)
      else this.away.delete(c.caller.id)
      return noContent
    })
    R('GET', '/api/sharing/live/mine', (c) => ({ json: { items: this.liveOf(c.caller.id).map((s) => this.ownedOut(s)) } }))

    /* live: shares */
    R('POST', '/api/sharing/live', (c) => {
      const f = c.form
      const blob = f?.get('blob')
      if (!f || !blob) return { status: 400, json: { message: 'multipart body with a blob is required' } }
      const zip = Buffer.from(blob.data)
      const format = f.get('format')?.text === '2' ? 2 : 1
      if (format === 2) {
        const missing = this.missingFiles(c.caller.id, zip)
        if (missing.length) return { status: 409, json: { missing } }
      }
      const listId = f.get('listId')?.text
      const now = Date.now()
      const s: LiveShare = {
        shareId: this.nextId('live'), ownerId: c.caller.id, projectId: f.get('projectId')?.text ?? '', title: f.get('title')?.text ?? '',
        documentIds: JSON.parse(f.get('documentIds')?.text ?? '[]') as string[],
        recipientIds: [...new Set(JSON.parse(f.get('recipientIds')?.text ?? '[]') as string[])],
        listIds: listId ? [listId] : [], versions: [{ version: 1, format, zip, createdAt: now }], createdAt: now, lastPushedAt: now, stopped: false, recipients: new Map(),
      }
      this.live.push(s)
      return { status: 201, json: { shareId: s.shareId, version: 1 } }
    })
    R('POST', `/api/sharing/live/${id}/push`, (c) => {
      const s = this.liveFor(c, c.params[0], true)
      if (!('shareId' in s)) return s
      if (s.stopped) return { status: 409, json: { stopped: true, message: 'This live share has been stopped' } }
      const blob = c.form?.get('blob')
      if (!blob) return { status: 400, json: { message: 'blob is required' } }
      const zip = Buffer.from(blob.data)
      const format = c.form?.get('format')?.text === '2' ? 2 : 1
      if (format === 2) {
        const missing = this.missingFiles(c.caller.id, zip)
        if (missing.length) return { status: 409, json: { missing } }
      }
      const title = c.form?.get('title')?.text
      if (title) s.title = title
      const version = s.versions.length + 1
      s.versions.push({ version, format, zip, createdAt: Date.now() })
      s.lastPushedAt = Date.now()
      return { json: { version } }
    })
    R('DELETE', `/api/sharing/live/${id}`, (c) => {
      const s = this.liveFor(c, c.params[0], true)
      if (!('shareId' in s)) return s
      s.stopped = true
      return noContent
    })
    R('GET', `/api/sharing/live/${id}/mirror`, (c) => {
      const s = this.liveFor(c, c.params[0])
      if (!('shareId' in s)) return s
      const want = c.query.get('version') ? Number(c.query.get('version')) : s.versions.length
      const v = s.versions.find((x) => x.version === want)
      if (!v) return notFound('Version not available')
      const body = v.format === 2 && c.query.get('format') !== '2' ? this.packed(s.ownerId, v.zip) : v.zip
      return { body, contentType: 'application/zip', headers: { 'x-live-version': String(v.version), 'access-control-expose-headers': 'x-live-version, content-length' } }
    })
    R('POST', `/api/sharing/live/${id}/seen`, (c) => {
      const s = this.liveFor(c, c.params[0])
      if (!('shareId' in s)) return s
      const version = Number((c.json as { version?: number })?.version ?? 0)
      const st = s.recipients.get(c.caller.id) ?? { lastSeenVersion: 0, lastSeenAt: null }
      st.lastSeenVersion = Math.max(st.lastSeenVersion, version)
      st.lastSeenAt = Date.now()
      s.recipients.set(c.caller.id, st)
      return noContent
    })
    R('PATCH', `/api/sharing/live/${id}/recipients/me`, (c) => {
      const s = this.liveFor(c, c.params[0])
      if (!('shareId' in s)) return s
      const b = c.json as { mirrorToLibrary?: boolean; stopNoticeAcknowledged?: boolean }
      const st = s.recipients.get(c.caller.id) ?? { lastSeenVersion: 0, lastSeenAt: null }
      if (b.mirrorToLibrary !== undefined) st.mirrorToLibrary = b.mirrorToLibrary
      if (b.stopNoticeAcknowledged !== undefined) st.stopNoticeAcknowledged = b.stopNoticeAcknowledged
      s.recipients.set(c.caller.id, st)
      return noContent
    })
    R('POST', `/api/sharing/live/${id}/recipients`, (c) => {
      const s = this.liveFor(c, c.params[0], true)
      if (!('shareId' in s)) return s
      const uid = (c.json as { userId: string }).userId
      if (!s.recipientIds.includes(uid)) s.recipientIds.push(uid)
      return noContent
    })
    R('DELETE', `/api/sharing/live/${id}/recipients/${id}`, (c) => {
      const s = this.live.find((x) => x.shareId === c.params[0])
      if (!s) return notFound()
      // The owner removes anyone; a recipient may remove only themselves (leave).
      if (s.ownerId !== c.caller.id && c.params[1] !== c.caller.id) return { status: 403, json: { message: 'Not yours' } }
      s.recipientIds = s.recipientIds.filter((x) => x !== c.params[1])
      return noContent
    })
    R('GET', `/api/sharing/live/${id}/delivery`, (c) => {
      const s = this.liveFor(c, c.params[0], true)
      if (!('shareId' in s)) return s
      return {
        json: {
          recipients: s.recipientIds.map((uid) => {
            const st = s.recipients.get(uid) ?? { lastSeenVersion: 0, lastSeenAt: null }
            return { userId: uid, lastSeenVersion: st.lastSeenVersion, lastSeenAt: st.lastSeenAt, upToDate: st.lastSeenVersion >= s.versions.length }
          }),
        },
      }
    })
    R('GET', `/api/sharing/live/${id}/files/${id}`, (c) => {
      const s = this.liveFor(c, c.params[0])
      if (!('shareId' in s)) return s
      const b = this.files.get(s.ownerId)?.get(c.params[1])
      return b ? { body: b, contentType: 'application/octet-stream' } : notFound('File not stored')
    })
  }
}
