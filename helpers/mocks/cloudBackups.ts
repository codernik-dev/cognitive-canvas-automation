/**
 * A stateful fake of MuulOrigin's cloud backup store (/api/backups/*), built
 * on the shared account mock (helpers/mocks/muulAccount.ts). It keeps every
 * uploaded file in memory, so a spec can back up, list, download, restore and
 * delete exactly as the app does against the real service, and then inspect
 * what the app sent (the multipart fields, the ZIP bytes, the chunk hashes).
 *
 * Contract followed: src/services/backup/cloudBackupApi.ts, backupLimits.ts,
 * services/sharing/chunkedUpload.ts and BACKUP-API.md (list with cursor,
 * usage, capabilities, multipart upload, chunked sessions, download, delete).
 *
 * The state lives in a CloudState object that can be shared by two browser
 * contexts (two "devices" signed in to the same account) for the cross-device
 * sync specs. Everything is a MOCK: a pass proves the app's side of the
 * contract only.
 */
import { createHash } from 'node:crypto'
import type { Page, Request } from '@playwright/test'
import { MUUL_API, type MockReply, type MuulApiMock } from './muulAccount.js'

export const PRODUCT = 'CognitiveCanvas'

export interface CloudItem {
  id: string
  orgId: string
  product: string
  description: string | null
  tags: string | null
  storageType: string
  fileName: string
  contentType: string
  fileSize: number
  version: number
  createdByEmail: string
  createdByUserId: string
  createdAtUtc: string
  githubPath: string | null
}

export interface StoredBackup {
  item: CloudItem
  bytes: Buffer
}

export interface MultipartPart {
  name: string
  filename?: string
  contentType?: string
  data: Buffer
}

/** One POST /api/backups/upload as the server received it. */
export interface UploadRecord {
  fields: Record<string, string>
  file?: { filename: string; contentType: string; bytes: Buffer }
  authorization: string | undefined
  /** The item the store answered with (undefined when a fault answered instead). */
  item?: CloudItem
}

export interface ChunkSession {
  id: string
  totalBytes: number
  totalChunks: number
  chunkBytes: number
  chunks: Map<number, Buffer>
  /** X-Chunk-SHA256 per chunk index, as sent. */
  hashes: Map<number, string>
}

export interface Capabilities {
  maxUploadBytes: number
  chunkedUpload: boolean
  maxChunkBytes: number
  applicationMaxBytes: number
}

interface Fault {
  method: string
  path: string | RegExp
  reply: MockReply
  remaining: number
}

/** Shared server-side state (one per "account"). */
export class CloudState {
  readonly backups: StoredBackup[] = []
  readonly uploads: UploadRecord[] = []
  readonly deletes: string[] = []
  readonly downloads: string[] = []
  readonly sessions = new Map<string, ChunkSession>()
  /** null: usage is the sum of stored file sizes. A number: report exactly that. */
  usageOverride: number | null = null
  /** List page size the server answers with (the app asks for 100). */
  pageSize = 100
  capabilities: Capabilities = { maxUploadBytes: 90 * 1024 * 1024, chunkedUpload: false, maxChunkBytes: 0, applicationMaxBytes: 0 }
  /** When set, the upload answer reports this fileSize instead of the real one (truncation test). */
  storedSizeOverride: number | null = null
  private counter = 0
  private sessionCounter = 0

  nextId() { return `e2e-backup-${String(++this.counter).padStart(3, '0')}` }
  nextVersion() { return this.counter }
  nextSessionId() { return `e2e-upload-${++this.sessionCounter}` }

  get usageBytes(): number {
    if (this.usageOverride !== null) return this.usageOverride
    return this.backups.filter((b) => b.item.storageType !== 'github').reduce((n, b) => n + b.item.fileSize, 0)
  }

  find(id: string) { return this.backups.find((b) => b.item.id === id) }

  /** Items whose tags carry `cc-project:<id>` (cloud sync copies). */
  syncCopies(projectId?: string) {
    return this.backups.filter((b) => (b.item.tags ?? '').split(',').map((t) => t.trim()).some((t) => (projectId ? t === `cc-project:${projectId}` : t.startsWith('cc-project:'))))
  }

  manifests() {
    return this.backups.filter((b) => (b.item.tags ?? '').split(',').map((t) => t.trim()).includes('cc-manifest'))
  }
}

export interface SeedItem {
  bytes: Buffer
  description?: string | null
  tags?: string | null
  storageType?: string
  fileName?: string
  createdAtUtc?: string
  version?: number
  /** Reported size; defaults to bytes.length. */
  fileSize?: number
  contentType?: string
}

/** Split a multipart/form-data body into its parts. */
export function parseMultipart(body: Buffer, contentType: string): MultipartPart[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) throw new Error(`no multipart boundary in "${contentType}"`)
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`)
  const parts: MultipartPart[] = []
  let pos = body.indexOf(boundary)
  while (pos >= 0) {
    const start = pos + boundary.length
    if (body.subarray(start, start + 2).toString() === '--') break
    const next = body.indexOf(boundary, start)
    if (next < 0) break
    // part = \r\n headers \r\n\r\n data \r\n
    const part = body.subarray(start + 2, next - 2)
    const sep = part.indexOf('\r\n\r\n')
    const head = part.subarray(0, sep).toString('utf8')
    const data = Buffer.from(part.subarray(sep + 4))
    const name = /name="([^"]*)"/i.exec(head)?.[1] ?? ''
    const filename = /filename="([^"]*)"/i.exec(head)?.[1]
    const ct = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim()
    parts.push({ name, filename, contentType: ct, data })
    pos = next
  }
  return parts
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

export class CloudBackupStore {
  private readonly faults: Fault[] = []
  private readonly holds: Array<{ method: string; path: string | RegExp; gate: Promise<void> }> = []

  private constructor(readonly state: CloudState, private readonly muul: MuulApiMock, private readonly page: Page) {}

  /**
   * Register the /api/backups handlers on `muul` (call before the app boots,
   * or at least before the app first talks to the store). Pass a shared
   * `state` to make two contexts see one account.
   */
  static async install(muul: MuulApiMock, page: Page, state = new CloudState()): Promise<CloudBackupStore> {
    const store = new CloudBackupStore(state, muul, page)
    const on = (method: string, path: string | RegExp, fn: (req: Request, url: URL) => MockReply | Promise<MockReply>) =>
      muul.on(method, path, async (req, url) => {
        const fault = store.takeFault(method, url.pathname)
        await store.waitHold(method, url.pathname)
        if (fault) return fault
        return fn(req, url)
      })

    await on('GET', '/api/backups', (_req, url) => store.list(url))
    await on('GET', '/api/backups/usage', () => ({
      json: { userId: muul.identity.sub, orgId: muul.identity.orgId, storageUsedBytes: state.usageBytes, storageUsedMb: +(state.usageBytes / (1024 * 1024)).toFixed(2) },
    }))
    await on('GET', '/api/backups/capabilities', () => ({ json: state.capabilities }))
    await on('POST', '/api/backups/upload', (req) => store.upload(req))
    await on('POST', '/api/backups/uploads', (req) => {
      const body = JSON.parse(req.postData() ?? '{}') as { totalBytes: number; totalChunks: number; chunkBytes: number }
      const id = state.nextSessionId()
      state.sessions.set(id, { id, ...body, chunks: new Map(), hashes: new Map() })
      return { json: { uploadId: id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }
    })
    await on('POST', /^\/api\/backups\/uploads\/[^/]+\/chunks\/\d+$/, (req, url) => {
      const [, , , , id, , n] = url.pathname.split('/')
      const session = state.sessions.get(decodeURIComponent(id))
      if (!session) return { status: 404, json: { message: 'unknown upload session' } }
      const bytes = req.postDataBuffer() ?? Buffer.alloc(0)
      const sent = req.headers()['x-chunk-sha256']
      session.hashes.set(Number(n), sent)
      if (sent !== sha256(bytes)) return { status: 400, json: { message: 'chunk hash mismatch' } }
      session.chunks.set(Number(n), bytes)
      return { json: { received: Number(n) } }
    })
    await on('GET', /^\/api\/backups\/uploads\/[^/]+$/, (_req, url) => {
      const session = state.sessions.get(decodeURIComponent(url.pathname.split('/')[4]))
      return session ? { json: { receivedIndexes: [...session.chunks.keys()] } } : { status: 404, json: {} }
    })
    await on('GET', /^\/api\/backups\/[^/]+\/download$/, (_req, url) => {
      const id = decodeURIComponent(url.pathname.split('/')[3])
      state.downloads.push(id)
      const b = state.find(id)
      if (!b) return { status: 404, json: { message: 'Backup not found' } }
      return { body: b.bytes, contentType: b.item.contentType || 'application/zip' }
    })
    await on('DELETE', /^\/api\/backups\/[^/]+$/, (_req, url) => {
      const id = decodeURIComponent(url.pathname.split('/')[3])
      state.deletes.push(id)
      const i = state.backups.findIndex((b) => b.item.id === id)
      if (i < 0) return { status: 404, json: { message: 'Backup not found' } }
      state.backups.splice(i, 1)
      return { status: 204, body: '', contentType: 'text/plain' }
    })
    return store
  }

  /** Put a backup in the store as if an earlier session had uploaded it. */
  seed(s: SeedItem): CloudItem {
    const item: CloudItem = {
      id: this.state.nextId(),
      orgId: this.muul.identity.orgId,
      product: PRODUCT,
      description: s.description === undefined ? null : s.description,
      tags: s.tags === undefined ? null : s.tags,
      storageType: s.storageType ?? 'cloud',
      fileName: s.fileName ?? 'cc-backup-2026-10-01_09-30-00.zip',
      contentType: s.contentType ?? 'application/zip',
      fileSize: s.fileSize ?? s.bytes.length,
      version: s.version ?? this.state.nextVersion(),
      createdByEmail: this.muul.identity.email,
      createdByUserId: this.muul.identity.sub,
      createdAtUtc: s.createdAtUtc ?? new Date().toISOString(),
      githubPath: null,
    }
    this.state.backups.push({ item, bytes: s.bytes })
    return item
  }

  /** Answer the next `times` METHOD + path requests with `reply` instead of the store. */
  failNext(method: string, path: string | RegExp, reply: MockReply, times = 1) {
    this.faults.push({ method: method.toUpperCase(), path, reply, remaining: times })
  }

  /** Hold METHOD + path requests until the returned release() is called (to observe in-flight UI). */
  hold(method: string, path: string | RegExp): { release: () => void } {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const entry = { method: method.toUpperCase(), path, gate }
    this.holds.push(entry)
    return {
      release: () => {
        const i = this.holds.indexOf(entry)
        if (i >= 0) this.holds.splice(i, 1)
        release()
      },
    }
  }

  /** Make the next METHOD + path request fail at the network level (no HTTP answer at all). */
  async abortNext(method: string, path: string) {
    let remaining = 1
    await this.page.route(
      (url) => url.origin === MUUL_API && url.pathname === path,
      (route) => {
        if (route.request().method() !== method.toUpperCase() || remaining <= 0) return route.fallback()
        remaining--
        return route.abort('failed')
      },
    )
  }

  private matches(method: string, path: string | RegExp, m: string, p: string) {
    return method === m && (typeof path === 'string' ? path === p : path.test(p))
  }

  private takeFault(method: string, pathname: string): MockReply | null {
    const f = this.faults.find((x) => x.remaining > 0 && this.matches(x.method, x.path, method.toUpperCase(), pathname))
    if (!f) return null
    f.remaining--
    return f.reply
  }

  private async waitHold(method: string, pathname: string) {
    for (const h of [...this.holds]) if (this.matches(h.method, h.path, method.toUpperCase(), pathname)) await h.gate
  }

  private list(url: URL): MockReply {
    const all = this.state.backups.map((b) => b.item)
    const start = Number(url.searchParams.get('cursor') ?? 0)
    const page = all.slice(start, start + this.state.pageSize)
    const next = start + this.state.pageSize < all.length ? String(start + this.state.pageSize) : null
    return {
      json: { user: this.muul.identity.email, product: PRODUCT, storageUsed: this.state.usageBytes, items: page, nextCursor: next },
    }
  }

  private upload(req: Request): MockReply {
    const body = req.postDataBuffer() ?? Buffer.alloc(0)
    const parts = parseMultipart(body, req.headers()['content-type'] ?? '')
    const fields: Record<string, string> = {}
    let file: UploadRecord['file']
    for (const p of parts) {
      if (p.filename !== undefined) file = { filename: p.filename, contentType: p.contentType ?? '', bytes: p.data }
      else fields[p.name] = p.data.toString('utf8')
    }
    const record: UploadRecord = { fields, file, authorization: req.headers()['authorization'] }
    this.state.uploads.push(record)

    let bytes: Buffer
    let fileName: string
    let contentType: string
    if (fields.uploadId) {
      const session = this.state.sessions.get(fields.uploadId)
      if (!session) return { status: 404, json: { message: 'unknown upload session' } }
      bytes = Buffer.concat([...session.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c))
      fileName = fields.fileName
      contentType = fields.contentType
    } else {
      if (!file) return { status: 400, json: { message: 'no file' } }
      bytes = file.bytes
      fileName = file.filename
      contentType = file.contentType
    }
    const item = this.seed({
      bytes,
      description: fields.description ?? null,
      tags: fields.tags ?? null,
      storageType: fields.storageType === 'github' ? 'github' : 'cloud',
      fileName,
      contentType,
      fileSize: this.state.storedSizeOverride ?? bytes.length,
    })
    record.item = item
    return { json: item }
  }
}
