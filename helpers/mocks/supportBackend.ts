/**
 * A stateful fake of the MuulOrigin support API, built on the shared account
 * mock (MuulApiMock.on). It keeps tickets, messages and attachments in
 * memory so a spec can file a ticket through the UI, have "staff" answer it,
 * and watch the app pick the answer up.
 *
 * Contract (src/services/support/supportApi.ts, SUPPORT-API.md):
 *   POST /api/support/tickets                    {subject, description, priority, category, clientContext, product} -> TicketDetail
 *   GET  /api/support/tickets                    -> TicketSummary[]
 *   GET  /api/support/tickets/:id                -> { ticket: TicketDetail, messages: TicketMessage[] }
 *   POST /api/support/tickets/:id/messages       {body} -> TicketMessage
 *   POST /api/support/tickets/:id/attachments    multipart: file, [messageId] -> Attachment
 * Attachment download URLs point at GET /e2e-files/:attachmentId on the same
 * mocked host, which serves the uploaded bytes back.
 *
 * Errors: `failNext(endpoint, reply)` answers the next call of that endpoint
 * with the given reply instead (once). `hold(endpoint)` keeps calls pending.
 * Everything is a MOCK: a pass proves the app's side of the contract only.
 */
import type { Page, Request } from '@playwright/test'
import { MUUL_API, type MockReply, type MuulApiMock } from './muulAccount.js'

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type Endpoint = 'create' | 'list' | 'detail' | 'reply' | 'upload'

export interface FakeAttachment {
  attachmentId: string
  fileName: string
  contentType: string
  sizeBytes: number
  uploadedByKind: 'USER' | 'AGENT'
  uploadedByUserId: string
  uploadedAtUtc: string
  downloadUrl: string
}

export interface FakeMessage {
  messageId: string
  ticketId: string
  authorKind: 'USER' | 'AGENT'
  authorId: string
  authorName: string
  body: string
  createdAtUtc: string
  attachments: FakeAttachment[]
}

export interface FakeTicket {
  ticketId: string
  subject: string
  description: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  status: TicketStatus
  product: string
  category: string
  clientContext?: string
  createdAtUtc: string
  updatedAtUtc: string
  assignedToAgentId: string | null
  assignedToAgentName: string | null
  submittedByEmail: string
  submittedByUserId: string
  attachments: FakeAttachment[]
  messages: FakeMessage[]
}

export interface UploadRecord {
  ticketId: string
  fileName: string
  contentType: string
  bytes: Buffer
  /** The `messageId` form field, when the app sent one. */
  messageId: string | null
}

export const AGENT = { id: 'agent-007', name: 'Priya (Support)' }

/** Parts of a multipart/form-data body: name, optional filename and type, raw bytes. */
export function parseMultipart(body: Buffer, contentType: string): { name: string; filename?: string; type?: string; data: Buffer }[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) throw new Error(`not multipart: ${contentType}`)
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`)
  const parts: { name: string; filename?: string; type?: string; data: Buffer }[] = []
  let pos = body.indexOf(boundary)
  while (pos !== -1) {
    const start = pos + boundary.length
    if (body.subarray(start, start + 2).toString() === '--') break
    const next = body.indexOf(boundary, start)
    if (next === -1) break
    const part = body.subarray(start + 2, next - 2) // skip CRLF after boundary and before the next one
    const sep = part.indexOf('\r\n\r\n')
    const head = part.subarray(0, sep).toString('utf8')
    // `;\s*name=` so the field name is never read out of `filename="..."`.
    const name = /content-disposition:[^\r\n]*?;\s*name="([^"]*)"/i.exec(head)?.[1] ?? ''
    const filename = /;\s*filename="([^"]*)"/i.exec(head)?.[1]
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]
    parts.push({ name, filename, type, data: part.subarray(sep + 4) })
    pos = next
  }
  return parts
}

export class SupportBackend {
  readonly tickets: FakeTicket[] = []
  readonly uploads: UploadRecord[] = []
  private readonly files = new Map<string, { bytes: Buffer; type: string }>()
  private readonly failures = new Map<Endpoint, MockReply>()
  private readonly gates = new Map<Endpoint, Promise<void>>()
  private seq = 1000
  private lastTime = 0

  /** Uploads still to be cut off at the network level (see dropUploads). */
  private drops = 0
  /** Uploads that were cut off. */
  droppedUploads = 0

  private constructor(private readonly muul: MuulApiMock, private readonly page: Page) {}

  /** Install the support endpoints on an account mock (fixtures/account.ts `muul`) for `page`. */
  static async install(muul: MuulApiMock, page: Page): Promise<SupportBackend> {
    const fake = new SupportBackend(muul, page)
    await fake.routes()
    return fake
  }

  /** Strictly increasing ISO timestamps, so "updated since" comparisons are never ties. */
  now(): string {
    this.lastTime = Math.max(Date.now(), this.lastTime + 1000)
    return new Date(this.lastTime).toISOString()
  }

  /** Answer the next call of `endpoint` with `reply` (once). */
  failNext(endpoint: Endpoint, reply: MockReply) {
    this.failures.set(endpoint, reply)
  }

  /** Cut the next `times` attachment uploads off at the network level (no HTTP answer at all). */
  dropUploads(times: number) {
    this.drops = times
  }

  /** Keep calls to `endpoint` pending until the returned function is called. */
  hold(endpoint: Endpoint): () => void {
    let release!: () => void
    this.gates.set(endpoint, new Promise<void>((r) => { release = r }))
    return () => { this.gates.delete(endpoint); release() }
  }

  ticket(id: string): FakeTicket {
    const t = this.tickets.find((x) => x.ticketId === id)
    if (!t) throw new Error(`no ticket ${id}`)
    return t
  }

  /** A ticket that already exists on the server (filed earlier, maybe elsewhere). */
  seed(partial: Partial<FakeTicket> & { subject: string }): FakeTicket {
    const at = partial.createdAtUtc ?? this.now()
    const t: FakeTicket = {
      ticketId: `TKT-${++this.seq}`,
      description: 'Seeded ticket description for automation.',
      priority: 'MEDIUM',
      status: 'OPEN',
      product: 'cognitive-canvas',
      category: 'APPLICATION',
      createdAtUtc: at,
      updatedAtUtc: partial.updatedAtUtc ?? at,
      assignedToAgentId: null,
      assignedToAgentName: null,
      submittedByEmail: this.muul.identity.email,
      submittedByUserId: this.muul.identity.sub,
      attachments: [],
      messages: [],
      ...partial,
    }
    this.tickets.push(t)
    return t
  }

  /** Staff answer a ticket: an AGENT message, and the ticket's updatedAtUtc moves on. */
  agentReply(ticketId: string, body: string, attachments: { fileName: string; contentType: string; bytes: Buffer }[] = []): FakeMessage {
    const t = this.ticket(ticketId)
    const at = this.now()
    const msg: FakeMessage = {
      messageId: `MSG-${++this.seq}`, ticketId, authorKind: 'AGENT', authorId: AGENT.id, authorName: AGENT.name, body, createdAtUtc: at,
      attachments: attachments.map((a) => this.storeFile(a.fileName, a.contentType, a.bytes, 'AGENT', AGENT.id, at)),
    }
    t.messages.push(msg)
    t.assignedToAgentId = AGENT.id
    t.assignedToAgentName = AGENT.name
    if (t.status === 'OPEN') t.status = 'IN_PROGRESS'
    t.updatedAtUtc = at
    return msg
  }

  /** A file the user attached to the ticket earlier (another device, an older session). */
  addTicketFile(ticketId: string, fileName: string, contentType: string, bytes: Buffer): FakeAttachment {
    const t = this.ticket(ticketId)
    const att = this.storeFile(fileName, contentType, bytes, 'USER', this.muul.identity.sub, this.now())
    t.attachments.push(att)
    return att
  }

  setStatus(ticketId: string, status: TicketStatus) {
    const t = this.ticket(ticketId)
    t.status = status
    t.updatedAtUtc = this.now()
  }

  private storeFile(fileName: string, contentType: string, bytes: Buffer, kind: 'USER' | 'AGENT', by: string, at: string): FakeAttachment {
    const attachmentId = `ATT-${++this.seq}`
    this.files.set(attachmentId, { bytes, type: contentType })
    return { attachmentId, fileName, contentType, sizeBytes: bytes.length, uploadedByKind: kind, uploadedByUserId: by, uploadedAtUtc: at, downloadUrl: `${MUUL_API}/e2e-files/${attachmentId}` }
  }

  private summary(t: FakeTicket) {
    const { description: _d, clientContext: _c, submittedByEmail: _e, submittedByUserId: _u, messages: _m, ...rest } = t
    return rest
  }

  private detail(t: FakeTicket) {
    const { messages: _m, ...rest } = t
    return rest
  }

  /** Common front: a queued failure or a hold, before the real handler runs. */
  private async gate(endpoint: Endpoint, handler: () => MockReply): Promise<MockReply> {
    const g = this.gates.get(endpoint)
    if (g) await g
    const fail = this.failures.get(endpoint)
    if (fail) {
      this.failures.delete(endpoint)
      return fail
    }
    return handler()
  }

  private async routes() {
    const id = (url: URL) => url.pathname.split('/')[4]

    await this.muul.on('GET', '/api/support/tickets', () => this.gate('list', () => ({ json: this.tickets.map((t) => this.summary(t)) })))

    await this.muul.on('POST', '/api/support/tickets', (req: Request) => this.gate('create', () => {
      const body = JSON.parse(req.postData() ?? '{}') as Record<string, string>
      const t = this.seed({
        subject: body.subject, description: body.description, priority: body.priority as FakeTicket['priority'],
        category: body.category, product: body.product, clientContext: body.clientContext,
      })
      return { status: 201, json: this.detail(t) }
    }))

    await this.muul.on('GET', /^\/api\/support\/tickets\/[^/]+$/, (_req, url) => this.gate('detail', () => {
      const t = this.tickets.find((x) => x.ticketId === id(url))
      if (!t) return { status: 404, json: { message: 'Ticket not found' } }
      return { json: { ticket: this.detail(t), messages: t.messages } }
    }))

    await this.muul.on('POST', /^\/api\/support\/tickets\/[^/]+\/messages$/, (req, url) => this.gate('reply', () => {
      const t = this.tickets.find((x) => x.ticketId === id(url))
      if (!t) return { status: 404, json: { message: 'Ticket not found' } }
      const { body } = JSON.parse(req.postData() ?? '{}') as { body: string }
      const at = this.now()
      const msg: FakeMessage = {
        messageId: `MSG-${++this.seq}`, ticketId: t.ticketId, authorKind: 'USER', authorId: this.muul.identity.sub,
        authorName: `${this.muul.identity.firstName} ${this.muul.identity.lastName}`, body, createdAtUtc: at, attachments: [],
      }
      t.messages.push(msg)
      t.updatedAtUtc = at
      return { status: 201, json: msg }
    }))

    await this.muul.on('POST', /^\/api\/support\/tickets\/[^/]+\/attachments$/, (req, url) => this.gate('upload', () => {
      const t = this.tickets.find((x) => x.ticketId === id(url))
      if (!t) return { status: 404, json: { message: 'Ticket not found' } }
      const parts = parseMultipart(req.postDataBuffer() ?? Buffer.alloc(0), req.headers()['content-type'] ?? '')
      const file = parts.find((p) => p.name === 'file')
      if (!file?.filename) return { status: 400, json: { message: 'No file in the upload' } }
      const messageId = parts.find((p) => p.name === 'messageId')?.data.toString('utf8') ?? null
      this.uploads.push({ ticketId: t.ticketId, fileName: file.filename, contentType: file.type ?? '', bytes: file.data, messageId })
      const att = this.storeFile(file.filename, file.type ?? 'application/octet-stream', file.data, 'USER', this.muul.identity.sub, this.now())
      t.attachments.push(att)
      const msg = messageId ? t.messages.find((m) => m.messageId === messageId) : undefined
      if (msg) msg.attachments.push(att)
      t.updatedAtUtc = att.uploadedAtUtc
      return { status: 201, json: att }
    }))

    await this.muul.on('GET', /^\/e2e-files\/[^/]+$/, (_req, url) => {
      const f = this.files.get(url.pathname.split('/')[2])
      if (!f) return { status: 404, json: { message: 'expired' } }
      return { body: f.bytes, contentType: f.type }
    })

    // Registered last, so it is tried first: while armed, an upload gets no HTTP answer at all.
    await this.page.route(
      (url) => url.origin === MUUL_API && /^\/api\/support\/tickets\/[^/]+\/attachments$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'POST' || this.drops <= 0) return route.fallback()
        this.drops--
        this.droppedUploads++
        return route.abort('connectionreset')
      },
    )
  }
}
