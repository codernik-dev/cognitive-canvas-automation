/**
 * A stub of the MoBrowser host bridge, so the GitHub and local-folder backup
 * flows (which only run inside the MoBrowser custom browser) can be driven in
 * plain Chromium without a real host, repository or disk.
 *
 * What the app sees (src/services/backup/bridgeService.ts, vaultDestinations.ts):
 *   window.externalMessage.send(json) -> Promise<{ ok, data?, error? }>
 *   window.credentialBridge.list('git' | 'local') -> Promise<entries[]>
 * Their presence is what makes detectEnvironment() answer 'mobrowser'.
 *
 * The state (a fake git repository per credential, fake folders on a fake
 * disk, every message received) lives HERE in Node, behind
 * context.exposeBinding, not in the page: a restore reloads the page, and the
 * "disk" has to survive that the way a real one would.
 *
 * Host contract implemented (as the app sends it):
 *   GIT_CAPABILITIES; GIT_STREAM_BEGIN / _CHUNK / _END / _ABORT (the host
 *   assembles the ZIP, commits it and maintains cognitive-canvas/backups/index.json);
 *   GIT_PULL (whole file, or a ranged read with offset/length); GIT_STAT;
 *   GIT (write a JSON file: the payload minus `git` is the file body).
 *   {type:'backup', action: capabilities | createFolder | beginWrite | writeChunk |
 *   endWrite | abortWrite | writeFile | readFile | stat | readChunk};
 *   {type:'get_folder_details', folderPath} lists one folder.
 * A pass proves the app's side of that contract, not the real host's.
 */
import type { BrowserContext } from '@playwright/test'

export interface GitRepo { id: string; name: string; owner: string; repository: string; branch: string }
export interface LocalFolder { id: string; name: string; path: string }

export interface BridgeSeed {
  repos?: GitRepo[]
  folders?: LocalFolder[]
  /** Decoded bytes per GIT_STREAM_CHUNK the host negotiates in its begin answer (small = several chunks). */
  gitChunkBytes?: number
  /** Max decoded bytes per writeChunk the host advertises for folder writes. */
  folderChunkBytes?: number
}

export type BridgeMessage = Record<string, unknown> & { type: string; action?: string }

export interface GitIndexEntry { name: string; path: string; createdAt: string; totalSize: number; description?: string; format?: string }

interface Override { type: string; action?: string; when?: (m: BridgeMessage) => boolean; reply: unknown; remaining: number }

interface GitStream { repo: string; fileName: string; totalBytes: number; commitMessage: string; chunks: Map<number, Buffer> }
interface FileStream { path: string; totalBytes: number; chunks: Buffer[] }

export const REPO_INDEX = 'cognitive-canvas/backups/index.json'
export const REPO_DESCRIPTIONS = 'cognitive-canvas/backups/descriptions.json'
export const REPO_DATA_DIR = 'cognitive-canvas/backups/data'

const b64 = (b: Buffer) => b.toString('base64')
const unb64 = (s: string) => Buffer.from(s, 'base64')

export class MoBrowserBridge {
  /** Every externalMessage the page sent, parsed, in order. */
  readonly messages: BridgeMessage[] = []
  /** Every credentialBridge.list(type) call. */
  readonly credentialLists: string[] = []
  repos: GitRepo[]
  folders: LocalFolder[]
  /** The fake disk: full path -> bytes. */
  readonly disk = new Map<string, Buffer>()
  /** Fake repositories: credential id -> path -> bytes. */
  readonly repoFiles = new Map<string, Map<string, Buffer>>()
  /** Fake repositories' backup index: credential id -> entries (oldest first). */
  readonly repoIndex = new Map<string, GitIndexEntry[]>()
  /** Full streamed pushes the host assembled: repo id -> { fileName, bytes, commitMessage }. */
  readonly pushes: Array<{ repo: string; fileName: string; bytes: Buffer; commitMessage: string }> = []
  /** Size the host reports from `stat`, per full path, when it should lie (size-mismatch test). */
  readonly statOverride = new Map<string, number>()
  private readonly overrides: Override[] = []
  private readonly gitStreams = new Map<string, GitStream>()
  private readonly fileStreams = new Map<string, FileStream>()
  private seq = 0

  private constructor(private readonly seed: BridgeSeed) {
    this.repos = seed.repos ?? []
    this.folders = seed.folders ?? []
  }

  /** A bridge that is NOT wired into any page (the test runs as an ordinary browser). */
  static async detached(): Promise<MoBrowserBridge> {
    return new MoBrowserBridge({})
  }

  /** Install into every page of `context`. Call before the app is opened. */
  static async install(context: BrowserContext, seed: BridgeSeed = {}): Promise<MoBrowserBridge> {
    const bridge = new MoBrowserBridge(seed)
    await context.exposeBinding('__ccE2eBridgeSend', (_src, json: string) => bridge.handle(json))
    await context.exposeBinding('__ccE2eBridgeList', (_src, type: string) => bridge.list(type))
    await context.addInitScript(() => {
      const w = window as unknown as Record<string, unknown> & {
        __ccE2eBridgeSend: (j: string) => Promise<unknown>
        __ccE2eBridgeList: (t: string) => Promise<unknown>
      }
      w.externalMessage = { send: (json: string) => w.__ccE2eBridgeSend(json) }
      w.credentialBridge = { list: (type: string) => w.__ccE2eBridgeList(type) }
    })
    return bridge
  }

  // ── Test-side controls ──

  /**
   * Answer the next `times` messages of this type/action (and matching `when`)
   * with `reply`, e.g. {ok:false, error:'404 Not Found'}.
   */
  override(type: string, reply: unknown, opts: { action?: string; times?: number; when?: (m: BridgeMessage) => boolean } = {}) {
    this.overrides.push({ type, action: opts.action, when: opts.when, reply, remaining: opts.times ?? 1 })
  }

  /** Messages of one type (and action). */
  sent(type: string, action?: string): BridgeMessage[] {
    return this.messages.filter((m) => m.type === type && (action === undefined || m.action === action))
  }

  /** Put a file on the fake disk. */
  putFile(path: string, bytes: Buffer) { this.disk.set(path, bytes) }

  /** Files directly inside `dir` on the fake disk. */
  filesIn(dir: string): string[] {
    const prefix = dir.replace(/\/+$/, '') + '/'
    return [...this.disk.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map((p) => p.slice(prefix.length)).sort()
  }

  /** Seed a backup into a repository, as an earlier push would have left it. */
  seedRepoBackup(repoId: string, fileName: string, bytes: Buffer, createdAt: string, description?: string) {
    const path = `${REPO_DATA_DIR}/${fileName}`
    this.repoFilesOf(repoId).set(path, bytes)
    this.indexOf(repoId).push({ name: fileName, path, createdAt, totalSize: bytes.length, format: 'single', ...(description ? { description } : {}) })
  }

  /** A JSON file the app wrote to a repository with GIT, parsed. */
  repoJson<T>(repoId: string, path: string): T | undefined {
    const b = this.repoFilesOf(repoId).get(path)
    return b ? (JSON.parse(b.toString('utf8')) as T) : undefined
  }

  repoFilesOf(id: string) {
    let m = this.repoFiles.get(id)
    if (!m) this.repoFiles.set(id, (m = new Map()))
    return m
  }

  indexOf(id: string) {
    let l = this.repoIndex.get(id)
    if (!l) this.repoIndex.set(id, (l = []))
    return l
  }

  // ── Host side ──

  private list(type: string): unknown[] {
    this.credentialLists.push(type)
    if (type === 'git') return this.repos.map((r) => ({ ...r, type: 'git' }))
    if (type === 'local') return this.folders.map((f) => ({ ...f, type: 'local' }))
    return []
  }

  private handle(json: string): unknown {
    const msg = JSON.parse(json) as BridgeMessage
    this.messages.push(msg)
    const o = this.overrides.find((x) => x.remaining > 0 && x.type === msg.type && (x.action === undefined || x.action === msg.action) && (!x.when || x.when(msg)))
    if (o) {
      o.remaining--
      return o.reply
    }
    try {
      return this.answer(msg)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** The repo a git message targets: its credential id (the app always names one when a repo is configured). */
  private repoOf(msg: Record<string, unknown>): string {
    const payload = (msg.payload ?? {}) as Record<string, unknown>
    const git = (msg.git ?? payload.git ?? {}) as Record<string, unknown>
    return String(git.id ?? 'default')
  }

  private answer(msg: BridgeMessage): unknown {
    switch (msg.type) {
      case 'GIT_CAPABILITIES':
        return { ok: true, data: { streamPush: true, rangedPull: true, largeFilePush: true, maxChunkBytes: 12 * 1024 * 1024, maxBackupsKept: 10 } }
      case 'GIT_STREAM_BEGIN': {
        const sessionId = `git-session-${++this.seq}`
        this.gitStreams.set(sessionId, {
          repo: this.repoOf(msg), fileName: String(msg.fileName), totalBytes: Number(msg.totalBytes),
          commitMessage: String(msg.commitMessage ?? ''), chunks: new Map(),
        })
        return { ok: true, data: { sessionId, ...(this.seed.gitChunkBytes ? { maxChunkBytes: this.seed.gitChunkBytes } : {}) } }
      }
      case 'GIT_STREAM_CHUNK': {
        const s = this.gitStreams.get(String(msg.sessionId))
        if (!s) return { ok: false, error: 'unknown session' }
        s.chunks.set(Number(msg.chunkIndex), unb64(String(msg.chunk)))
        return { ok: true }
      }
      case 'GIT_STREAM_END': {
        const s = this.gitStreams.get(String(msg.sessionId))
        if (!s) return { ok: false, error: 'unknown session' }
        const bytes = Buffer.concat([...s.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c))
        if (bytes.length !== Number(msg.totalBytes) || bytes.length !== s.totalBytes) return { ok: false, error: `size mismatch: ${bytes.length} of ${s.totalBytes}` }
        this.gitStreams.delete(String(msg.sessionId))
        const path = `${REPO_DATA_DIR}/${s.fileName}`
        this.repoFilesOf(s.repo).set(path, bytes)
        this.indexOf(s.repo).push({ name: s.fileName, path, createdAt: new Date().toISOString(), totalSize: bytes.length, format: 'single' })
        this.pushes.push({ repo: s.repo, fileName: s.fileName, bytes, commitMessage: s.commitMessage })
        return { ok: true, data: { committed: true } }
      }
      case 'GIT_STREAM_ABORT':
        this.gitStreams.delete(String(msg.sessionId))
        return { ok: true }
      case 'GIT_STAT': {
        const payload = msg.payload as Record<string, unknown>
        const b = this.repoFilesOf(this.repoOf(msg)).get(String(payload.filePath))
        return b ? { ok: true, data: { size: b.length } } : { ok: false, error: '404 Not Found' }
      }
      case 'GIT_PULL': {
        const payload = msg.payload as Record<string, unknown>
        const repo = this.repoOf(msg)
        const path = String(payload.filePath)
        if (path === REPO_INDEX) {
          const idx = this.repoIndex.get(repo)
          if (!idx) return { ok: false, error: '404 Not Found' }
          return { ok: true, data: { content: JSON.stringify({ indexKind: 'cognitive-canvas-backup-index', backups: idx }) } }
        }
        const b = this.repoFilesOf(repo).get(path)
        if (!b) return { ok: false, error: '404 Not Found' }
        if (payload.offset !== undefined) {
          const offset = Number(payload.offset)
          const slice = b.subarray(offset, offset + Number(payload.length))
          return { ok: true, data: { chunk: b64(Buffer.from(slice)), eof: offset + slice.length >= b.length } }
        }
        return { ok: true, data: { content: b.toString('utf8') } }
      }
      case 'GIT': {
        const payload = { ...(msg.payload as Record<string, unknown>) }
        const git = payload.git as Record<string, unknown>
        delete payload.git
        const repo = this.repoOf(msg)
        // An older host lets the app keep the index itself (the GIT_ZIP / chunked paths).
        if (git.filePath === REPO_INDEX) this.repoIndex.set(repo, (payload.backups as GitIndexEntry[]) ?? [])
        else this.repoFilesOf(repo).set(String(git.filePath), Buffer.from(JSON.stringify(payload)))
        return { ok: true }
      }
      case 'GIT_ZIP':
      case 'MUULORIGIN':
        return { ok: false, error: `${msg.type} is not supported by this host` }
      case 'get_folder_details':
        return { ok: true, data: { files: this.folderListing(String(msg.folderPath)) } }
      case 'backup':
        return this.answerBackup(msg)
      default:
        return { ok: false, error: `unknown message type ${msg.type}` }
    }
  }

  private folderListing(dir: string) {
    const prefix = dir.replace(/\/+$/, '') + '/'
    const out = new Map<string, { name: string; isDirectory: boolean; size?: number }>()
    for (const [p, b] of this.disk) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash < 0) out.set(rest, { name: rest, isDirectory: false, size: b.length })
      else out.set(rest.slice(0, slash), { name: rest.slice(0, slash), isDirectory: true })
    }
    return [...out.values()]
  }

  private answerBackup(msg: BridgeMessage): unknown {
    const join = (dir: unknown, name: unknown) => `${String(dir).replace(/\/+$/, '')}/${String(name)}`
    switch (msg.action) {
      case 'capabilities':
        return { ok: true, data: { streamingWrite: true, rangedRead: true, maxChunkBytes: this.seed.folderChunkBytes ?? 12 * 1024 * 1024 } }
      case 'createFolder':
        return { ok: true, data: { path: join(msg.folderPath, msg.name) } }
      case 'beginWrite': {
        const sessionId = `file-session-${++this.seq}`
        this.fileStreams.set(sessionId, { path: join(msg.folderPath, msg.filename), totalBytes: Number(msg.totalBytes), chunks: [] })
        return { ok: true, data: { sessionId } }
      }
      case 'writeChunk': {
        const s = this.fileStreams.get(String(msg.sessionId))
        if (!s) return { ok: false, error: 'unknown session' }
        if (Number(msg.seq) !== s.chunks.length) return { ok: false, error: `out of order chunk ${String(msg.seq)}` }
        s.chunks.push(unb64(String(msg.content)))
        return { ok: true }
      }
      case 'endWrite': {
        const s = this.fileStreams.get(String(msg.sessionId))
        if (!s) return { ok: false, error: 'unknown session' }
        const bytes = Buffer.concat(s.chunks)
        if (bytes.length !== s.totalBytes) return { ok: false, error: `size mismatch: ${bytes.length} of ${s.totalBytes}` }
        this.fileStreams.delete(String(msg.sessionId))
        this.disk.set(s.path, bytes)
        return { ok: true, data: { fullPath: s.path } }
      }
      case 'abortWrite':
        this.fileStreams.delete(String(msg.sessionId))
        return { ok: true }
      case 'writeFile': {
        const content = String(msg.content ?? '')
        this.disk.set(join(msg.folderPath, msg.filename), msg.encoding === 'base64' ? unb64(content) : Buffer.from(content, 'utf8'))
        return { ok: true }
      }
      case 'readFile': {
        const b = this.disk.get(join(msg.folderPath, msg.filename))
        if (!b) return { ok: false, error: 'File not found' }
        return { ok: true, data: { content: msg.encoding === 'base64' ? b64(b) : b.toString('utf8') } }
      }
      case 'stat': {
        const path = join(msg.folderPath, msg.filename)
        const b = this.disk.get(path)
        if (!b) return { ok: false, error: 'File not found' }
        return { ok: true, data: { size: this.statOverride.get(path) ?? b.length } }
      }
      case 'readChunk': {
        const b = this.disk.get(join(msg.folderPath, msg.filename))
        if (!b) return { ok: false, error: 'File not found' }
        const offset = Number(msg.offset)
        const slice = b.subarray(offset, offset + Number(msg.length))
        return { ok: true, data: { content: b64(Buffer.from(slice)), eof: offset + slice.length >= b.length } }
      }
      default:
        return { ok: false, error: `unknown backup action ${String(msg.action)}` }
    }
  }
}
