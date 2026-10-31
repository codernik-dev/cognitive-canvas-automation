/**
 * A small WebDriver BiDi driver for MoBrowser.
 *
 * MoBrowser is built on Firefox, which Playwright cannot drive, but Firefox's
 * remote agent speaks the W3C WebDriver BiDi protocol. This file is the subset
 * the live MoBrowser tests need:
 *   - launch MoBrowser with its own profile (never the user's) and connect;
 *   - navigate, evaluate script, wait on a condition (polled, with a timeout);
 *   - REAL input: pointer clicks and key presses through `input.performActions`,
 *     the same trusted events a person makes, never element.click() from script;
 *   - serve the build under test at a given origin (network interception), so
 *     the app runs at its real address and the real API accepts it.
 *
 * Everything returned to a test is data; nothing here prints a typed value.
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const MOBROWSER_EXE = process.env.CC_MOBROWSER_EXE ?? 'C:\\Program Files\\mobrowser\\mobrowser.exe'

type Json = Record<string, unknown>
interface Pending { resolve: (v: Json) => void; reject: (e: Error) => void; method: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** BiDi value -> plain JS (the subset script.evaluate returns for JSON-like data). */
function deserialize(v: Json | undefined): unknown {
  if (!v) return undefined
  switch (v.type) {
    case 'undefined': return undefined
    case 'null': return null
    case 'string': case 'boolean': return v.value
    case 'number': return typeof v.value === 'string' ? Number(v.value) : v.value
    case 'array': return (v.value as Json[]).map(deserialize)
    case 'object': return Object.fromEntries((v.value as [string, Json][]).map(([k, val]) => [k, deserialize(val)]))
    default: return v.value
  }
}

export class MoBrowser {
  private ws!: WebSocket
  private id = 0
  private pending = new Map<number, Pending>()
  private intercepts: Array<{ prefix: string; dir: string }> = []
  context = ''

  private constructor(private readonly port: number) {}

  /** Start MoBrowser on `profileDir` (created if missing) with the remote agent on `port`. */
  static async launch(opts: { profileDir: string; port?: number; headless?: boolean }): Promise<MoBrowser> {
    if (!existsSync(MOBROWSER_EXE)) throw new Error(`MoBrowser not found at ${MOBROWSER_EXE} (set CC_MOBROWSER_EXE)`)
    mkdirSync(opts.profileDir, { recursive: true })
    const port = opts.port ?? 9340
    const args = ['-no-remote', '-profile', opts.profileDir, '--remote-debugging-port', String(port)]
    if (opts.headless) args.push('--headless')
    spawn(MOBROWSER_EXE, [...args, 'about:blank'], { stdio: 'ignore', detached: true }).unref()
    const mo = new MoBrowser(port)
    await mo.connect()
    return mo
  }

  private async connect() {
    const deadline = Date.now() + 60_000
    for (;;) {
      try {
        this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/session`)
        await new Promise<void>((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('connect')) })
        break
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`MoBrowser remote agent did not start on port ${this.port}`, { cause: e })
        await sleep(300)
      }
    }
    this.ws.onmessage = (m) => this.onMessage(JSON.parse(String(m.data)) as Json)
    // Leave native dialogs open so a test can read and answer them (acceptNextDialog).
    const s = await this.send('session.new', { capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: 'ignore' } } } })
    if (!s) throw new Error('no BiDi session')
    const tree = await this.send('browsingContext.getTree', {})
    this.context = ((tree.contexts as Json[])[0].context) as string
  }

  private onMessage(msg: Json) {
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.type === 'error') p.reject(new Error(`${p.method}: ${String(msg.error)} ${String(msg.message ?? '')}`))
      else p.resolve((msg.result ?? {}) as Json)
      return
    }
    if (msg.method === 'network.beforeRequestSent') void this.onIntercept(msg.params as Json)
    if (msg.method === 'browsingContext.userPromptOpened') {
      const p = msg.params as Json
      const waiter = this.dialogWaiters.shift()
      if (waiter) void this.send('browsingContext.handleUserPrompt', { context: p.context, accept: waiter.accept }).then(() => waiter.resolve({ type: String(p.type), message: String(p.message) }))
    }
  }

  private dialogWaiters: Array<{ accept: boolean; resolve: (d: { type: string; message: string }) => void }> = []

  /** Answer the next native dialog (confirm/alert) and resolve with its type and text. Call BEFORE the action that opens it. */
  async acceptNextDialog(accept = true): Promise<Promise<{ type: string; message: string }>> {
    await this.send('session.subscribe', { events: ['browsingContext.userPromptOpened'] })
    return new Promise((resolve) => this.dialogWaiters.push({ accept, resolve }))
  }

  send(method: string, params: Json): Promise<Json> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  // ── Serving the build under test at its real address ──

  /** Answer every request under `origin` from `dir` (SPA fallback to index.html). */
  async serve(origin: string, dir: string) {
    this.intercepts.push({ prefix: origin.replace(/\/$/, ''), dir })
    await this.send('session.subscribe', { events: ['network.beforeRequestSent'] })
    const o = new URL(origin)
    await this.send('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', protocol: o.protocol.replace(':', ''), hostname: o.hostname }] })
  }

  /**
   * Requests the build could not be served for. The fixture fails the test when
   * this is not empty. A request the page dropped before it was answered (it
   * navigated away) is normal and not recorded.
   */
  readonly interceptErrors: string[] = []

  private async onIntercept(p: Json) {
    if (!p.isBlocked) return
    const req = p.request as Json
    try {
      const url = new URL(req.url as string)
      const hit = this.intercepts.find((i) => url.href.startsWith(i.prefix))
      if (!hit) {
        await this.send('network.continueRequest', { request: req.request })
        return
      }
      let file = path.join(hit.dir, decodeURIComponent(url.pathname))
      if (!file.startsWith(hit.dir) || !existsSync(file) || !statSync(file).isFile()) file = path.join(hit.dir, 'index.html')
      const body = readFileSync(file)
      await this.send('network.provideResponse', {
        request: req.request,
        statusCode: 200,
        reasonPhrase: 'OK',
        headers: [{ name: 'content-type', value: { type: 'string', value: contentType(file) } }],
        body: { type: 'base64', value: body.toString('base64') },
      })
    } catch (e) {
      if (!/no such request/i.test(String(e))) this.interceptErrors.push(`${String(req.url)}: ${String(e)}`)
    }
  }

  // ── Pages and script ──

  async goto(url: string) {
    await this.send('browsingContext.navigate', { context: this.context, url, wait: 'complete' })
  }

  /** Run the page function `fn(arg)` (arg passed as plain JSON data) and return its JSON-like result. */
  async eval<T>(fn: string, arg?: unknown): Promise<T> {
    const r = await this.send('script.callFunction', {
      functionDeclaration: `async (a) => { const f = (${fn}); return await f(a === undefined ? undefined : JSON.parse(a)) }`,
      target: { context: this.context },
      arguments: arg === undefined ? [] : [{ type: 'string', value: JSON.stringify(arg) }],
      awaitPromise: true,
    })
    if (r.type === 'exception') throw new Error(`page script threw: ${JSON.stringify((r.exceptionDetails as Json)?.text ?? r.exceptionDetails)}`)
    return deserialize(r.result as Json) as T
  }

  /** Poll `fn(arg)` in the page until it returns a truthy value; return that value. */
  async waitFor<T>(fn: string, arg?: unknown, timeout = 30_000, what = 'condition'): Promise<T> {
    const deadline = Date.now() + timeout
    let last: unknown
    for (;;) {
      try {
        last = await this.eval<T>(fn, arg)
        if (last) return last as T
      } catch (e) {
        last = e
      }
      if (Date.now() > deadline) throw new Error(`MoBrowser: timed out after ${timeout} ms waiting for ${what} (last: ${String(last)})`)
      await sleep(200)
    }
  }

  /** Install a script that runs before the page's own on every navigation. */
  async preload(fn: string) {
    await this.send('script.addPreloadScript', { functionDeclaration: fn })
  }

  // ── Real input ──

  /** A trusted pointer click at the centre of the first element matching `finder` (a page function returning an element). */
  async click(finder: string, arg?: unknown, what = 'element') {
    const box = await this.waitFor<{ x: number; y: number }>(`(v) => {
      const el = (${finder})(v);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
      if (!r.width || !r.height || disabled) return null;
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }`, arg, 30_000, `${what} to be visible and enabled`)
    await this.send('input.performActions', {
      context: this.context,
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: box.x, y: box.y, duration: 0 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ] }],
    })
    await this.send('input.releaseActions', { context: this.context })
  }

  /** Real key presses typing `text` into whatever has focus. */
  async type(text: string) {
    const actions = [...text].flatMap((ch) => [{ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }])
    await this.send('input.performActions', { context: this.context, actions: [{ type: 'key', id: 'keyboard', actions }] })
    await this.send('input.releaseActions', { context: this.context })
  }

  /** Press a special key: 'Enter', 'Escape', 'Backspace', 'Tab'. */
  async press(key: 'Enter' | 'Escape' | 'Backspace' | 'Tab') {
    const code = { Enter: '\uE007', Escape: '\uE00C', Backspace: '\uE003', Tab: '\uE004' }[key]
    await this.send('input.performActions', { context: this.context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: code }, { type: 'keyUp', value: code }] }] })
    await this.send('input.releaseActions', { context: this.context })
  }

  /** Names of the cookies this profile holds for `domain` (values never leave the browser). */
  async cookieNames(domain: string): Promise<string[]> {
    const r = await this.send('storage.getCookies', {})
    const want = domain.replace(/^\./, '')
    return ((r.cookies as Json[]) ?? [])
      .filter((c) => String(c.domain).replace(/^\./, '').endsWith(want))
      .filter((c) => !c.expiry || Number(c.expiry) * 1000 > Date.now())
      .map((c) => String(c.name))
  }

  async screenshot(): Promise<Buffer> {
    const r = await this.send('browsingContext.captureScreenshot', { context: this.context })
    return Buffer.from(r.data as string, 'base64')
  }

  /**
   * Close this MoBrowser instance the way a person would quit it: the protocol's
   * browser.close. The launcher process may hand over to a detached browser
   * process, so its exit says nothing; callers wait for the profile lock to be
   * released instead (profileLocked).
   */
  async close() {
    await this.send('browser.close', {})
    try { this.ws.close() } catch { /* the browser closed the socket itself */ }
  }
}

/**
 * Is a MoBrowser instance running on `profileDir`? Firefox-based browsers hold
 * `parent.lock` open exclusively while they run, so failing to open it means
 * the profile is in use. A missing or openable lock means it is free.
 */
export function profileLocked(profileDir: string): boolean {
  const lock = path.join(profileDir, 'parent.lock')
  if (!existsSync(lock)) return false
  try {
    closeSync(openSync(lock, 'r+'))
    return false
  } catch (e) {
    return ['EBUSY', 'EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')
  }
}

/** The user's own MoBrowser profiles, from MoBrowser's profiles.ini (never the test profile). */
export function userProfiles(): string[] {
  const root = path.join(process.env.APPDATA ?? '', 'mobrowser', 'Mobrowser')
  const ini = path.join(root, 'profiles.ini')
  if (!existsSync(ini)) return []
  const out: string[] = []
  let relative = true
  for (const line of readFileSync(ini, 'utf8').split(/\r?\n/)) {
    if (/^\[/.test(line)) relative = true
    const rel = line.match(/^IsRelative=(\d)/)
    if (rel) relative = rel[1] === '1'
    const p = line.match(/^Path=(.+)$/)
    if (p) out.push(relative ? path.join(root, p[1]) : p[1])
  }
  return out
}

function contentType(file: string) {
  const ext = path.extname(file).toLowerCase()
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm', '.gz': 'application/gzip', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.pdf': 'application/pdf',
  } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

/**
 * Page-side finders, as source strings for MoBrowser.click / waitFor. Accessible
 * name here = aria-label, else the trimmed text: what a person reads on the control.
 */
export const find = {
  button: `(name) => [...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')].find((b) => ((b.getAttribute('aria-label') || b.textContent || '').trim() === name))`,
  buttonMatching: `(src) => { const re = new RegExp(src); return [...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')].find((b) => re.test((b.getAttribute('aria-label') || b.textContent || '').trim())) }`,
  placeholder: `(ph) => document.querySelector('input[placeholder="' + ph + '"],textarea[placeholder="' + ph + '"]')`,
  selector: `(sel) => document.querySelector(sel)`,
  text: `(t) => [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === t)`,
}
