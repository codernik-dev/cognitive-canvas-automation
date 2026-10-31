/**
 * `test` for LIVE tests in the real MoBrowser (tests/live/*.mobrowser.live.spec.ts).
 *
 * The browser is MoBrowser itself, driven over WebDriver BiDi
 * (helpers/mobrowser/bidi.ts) with real pointer and key input. It runs on a
 * DEDICATED test profile, never the user's own:
 *   CC_MOBROWSER_PROFILE, default %LOCALAPPDATA%\cognitive-canvas-qa\mobrowser-profile
 * That profile holds only what the QA owner connected to it once with
 * `npm run mobrowser:setup`: the test GitHub repository and the test folder.
 *
 * The build under test is served at the app's real address inside MoBrowser
 * (network interception), signed in with the QA account (CC_LIVE_EMAIL /
 * CC_LIVE_PASSWORD), so the real plan service unlocks GitHub and folder backup
 * and MoBrowser's real host bridge does the pushing, listing and reading.
 *
 * Safety: skipped when the user's own MoBrowser is running (two instances must
 * never share a session), when MoBrowser is not installed, or without the QA
 * account. Each test starts from an empty app (its site data cleared) and
 * cloud auto-sync is kept off, so nothing is uploaded to Muul Cloud.
 */
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'
import { MoBrowser, MOBROWSER_EXE, find, profileLocked, userProfiles } from '../helpers/mobrowser/bidi.js'
import { ENV } from '../config/env.js'
import { LIVE_ORIGIN } from './live.js'

export const MO_PROFILE = process.env.CC_MOBROWSER_PROFILE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'cognitive-canvas-qa', 'mobrowser-profile')
/** The only folder the folder-backup tests may write into (the QA owner adds it in the test profile). */
export const MO_TEST_FOLDER = process.env.CC_MOBROWSER_TEST_FOLDER ?? path.join(os.homedir(), 'Documents', 'CognitiveCanvas-QA-Backups')
/** The only repository the GitHub tests may push to. */
export const MO_TEST_REPO = process.env.CC_MOBROWSER_TEST_REPO ?? 'cc'
const DIST = path.resolve(import.meta.dirname, '..', '..', 'dist')
const APP_DB = 'cognitive-canvas'

/** The user's own MoBrowser is open when any of their profiles is locked. */
const userMoBrowserRunning = () => userProfiles().some(profileLocked)

export interface VaultEntry { id: string; name?: string; label?: string; owner?: string; repository?: string; repo?: string; branch?: string; path?: string }

/** The app inside MoBrowser, driven like a person would. */
export class MoApp {
  constructor(readonly mo: MoBrowser) {}

  /** Real MuulOrigin sign-in in MoBrowser (skipped when this profile already holds a session). */
  async signIn() {
    // The session is the shared refresh cookie; the sign-in page shows its form before it checks it, so ask the browser.
    if ((await this.mo.cookieNames('muulorigin.com')).includes('mo_refresh_token')) return
    await this.mo.goto('https://www.muulorigin.com/signin')
    // Act only on a settled page: redirected away (a session after all), or the form shown for 3 s running.
    let formFor = 0
    for (const deadline = Date.now() + 45_000; ; ) {
      const s = await this.mo.eval<string>(`() => !/signin/.test(location.pathname) ? 'away' : (document.querySelector('form input[type="password"]') ? 'form' : 'wait')`)
      if (s === 'away') return
      formFor = s === 'form' ? formFor + 1 : 0
      if (formFor >= 12) break
      if (Date.now() > deadline) throw new Error('the MuulOrigin sign-in page did not settle')
      await new Promise((r) => setTimeout(r, 250))
    }
    await this.mo.click(find.placeholder, 'you@example.com', 'the email field')
    await this.mo.type(ENV.liveEmail!)
    await this.mo.click(find.selector, 'input[type="password"]', 'the password field')
    await this.mo.type(ENV.livePassword!)
    // The form's own submit button (the page header also has a "Sign In" link).
    await this.mo.click(find.selector, 'form button[type="submit"]', 'the form\'s Sign In button')
    await this.mo.waitFor(`() => !!localStorage.getItem('mo_token')`, undefined, 60_000, 'the MuulOrigin session')
  }

  /** Open the app at its real address with nothing stored for it, cloud auto-sync off. */
  async openFresh() {
    await this.mo.goto(`${LIVE_ORIGIN}/`)
    await this.mo.eval(`async () => {
      for (const d of await indexedDB.databases()) await new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(null) });
      sessionStorage.clear();
      for (const k of Object.keys(localStorage)) if (!/^mo_/.test(k)) localStorage.removeItem(k);
      localStorage.setItem('cc2_cloud_sync_v1', JSON.stringify({ enabled: false, noticeShownFor: [] }));
    }`)
    await this.mo.goto(`${LIVE_ORIGIN}/`)
  }

  async createPin(pin = ENV.testPin) {
    await this.mo.waitFor(`() => document.body.innerText.includes('Create a 6-digit PIN')`, undefined, 60_000, 'PIN setup')
    await this.mo.type(pin)
    await this.mo.click(find.button, 'Next', 'Next')
    await this.mo.waitFor(`() => document.body.innerText.includes('Confirm your PIN')`, undefined, 20_000, 'the confirm step')
    await this.mo.type(pin)
    await this.mo.click(find.button, 'Create Account', 'Create Account')
    // A fresh profile opens the real content catalog first.
    await this.mo.waitFor(`() => [...document.querySelectorAll('h1,h2')].some((h) => h.textContent.trim() === 'Explore Content')`, undefined, 60_000, 'the content catalog')
    await this.home()
  }

  async home() {
    await this.mo.click(find.button, 'Go to home', 'Go to home')
    await this.mo.waitFor(`() => !!document.querySelector('input[placeholder="New project name..."]')`, undefined, 30_000, 'Home')
  }

  async createProject(name: string) {
    await this.mo.click(find.placeholder, 'New project name...', 'the project name field')
    await this.mo.type(name)
    await this.mo.press('Enter')
    await this.mo.waitFor(`(n) => !!document.querySelector('[aria-label="Back to projects"]') && document.body.innerText.includes(n)`, name, 30_000, `project "${name}" to open`)
  }

  /** Upload a PDF into the open project. The OS file dialog cannot be driven, so the file goes to the upload input directly (BiDi input.setFiles). */
  async uploadPdf(file: string, pages: number) {
    const r = await this.mo.send('script.callFunction', {
      functionDeclaration: `() => document.querySelector('input[type="file"]')`,
      target: { context: this.mo.context }, awaitPromise: false,
    })
    const el = r.result as { sharedId?: string }
    if (!el?.sharedId) throw new Error('no upload input on the page')
    await this.mo.send('input.setFiles', { context: this.mo.context, element: { sharedId: el.sharedId }, files: [file] })
    await this.mo.waitFor(`(p) => new RegExp('^1 ?/ ?' + p + '$').test(([...document.querySelectorAll('button')].find((b) => /^\\d+ ?\\/ ?\\d+$/.test(b.textContent.trim())) || {}).textContent?.trim() || '')`, pages, 60_000, 'the PDF to open')
  }

  async backToProjects() {
    await this.mo.click(find.button, 'Back to projects', 'Back to projects')
    await this.mo.waitFor(`() => !!document.querySelector('input[placeholder="New project name..."]')`, undefined, 30_000, 'Home')
  }

  /** Home > the project's More actions > Delete > confirm in the Delete Project dialog. */
  async deleteProject(name: string) {
    await this.mo.click(`(n) => { const card = [...document.querySelectorAll('[data-tour="project-card"]:not([aria-hidden="true"])')].find((c) => [...c.querySelectorAll('*')].some((e) => e.children.length === 0 && e.textContent.trim() === n)); return card && card.querySelector('[aria-label="More actions"]') }`, name, `More actions on "${name}"`)
    await this.mo.click(find.button, 'Delete', 'Delete in the card menu')
    await this.mo.click(`() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.getAttribute('aria-label') || x.textContent).includes('Delete Project')); return d && [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete') }`, undefined, 'Delete in the Delete Project dialog')
  }

  /** Home > Backup & Restore (a project-list button) > mode > source card. */
  async openDataCenter(mode: 'Backup' | 'Restore', source: 'GitHub' | 'Local' | 'Cloud') {
    await this.home()
    await this.mo.click(find.button, 'Backup & Restore', 'Backup & Restore')
    await this.mo.waitFor(`() => [...document.querySelectorAll('h1,h2,h3')].some((h) => /^(Select backup destination|Select restore source)$/.test(h.textContent.trim()))`, undefined, 30_000, 'the Data Center chooser')
    await this.mo.click(find.button, mode, `the ${mode} mode`)
    // A card may carry a plan badge before its label ("Pro Cloud …"): match the label element itself.
    await this.mo.click(`(s) => [...document.querySelectorAll('button.dc-card')].find((b) => [...b.querySelectorAll('*')].some((e) => e.children.length === 0 && e.textContent.trim() === s))`, source, `the ${source} card`)
  }

  /** Rows of one IndexedDB store of the app, read in the page. */
  async store<T>(name: string): Promise<T[]> {
    return this.mo.eval<T[]>(`async ({ db, store }) => {
      const conn = await new Promise((res, rej) => { const r = indexedDB.open(db); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
      try {
        return await new Promise((res, rej) => { const q = conn.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result.map((row) => JSON.parse(JSON.stringify(row, (k, v) => (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) ? { __bytes: v.size ?? v.byteLength } : v)))); q.onerror = () => rej(q.error) });
      } finally { conn.close() }
    }`, { db: APP_DB, store: name })
  }

  /** What MoBrowser's vault holds for 'git' or 'local' (names and paths only). */
  async vault(type: 'git' | 'local'): Promise<VaultEntry[]> {
    return this.mo.eval<VaultEntry[]>(`async (t) => { const l = await window.credentialBridge.list(t); return (Array.isArray(l) ? l : []).map((e) => ({ id: e.id, name: e.name, label: e.label, owner: e.owner, repository: e.repository, repo: e.repo, branch: e.branch, path: e.path })) }`, type)
  }
}

interface MoFixtures { mo: MoBrowser; moApp: MoApp }

export const test = base.extend<MoFixtures>({
  mo: async ({ browserName: _unused }, provide, testInfo) => {
    test.skip(!existsSync(MOBROWSER_EXE), `MoBrowser is not installed at ${MOBROWSER_EXE}`)
    test.skip(!ENV.liveEmail || !ENV.livePassword, 'Live tests need CC_LIVE_EMAIL and CC_LIVE_PASSWORD (a dedicated QA account).')
    test.skip(userMoBrowserRunning(), 'Close MoBrowser first: the tests start their own MoBrowser on a separate test profile and never run beside yours.')
    test.skip(profileLocked(MO_PROFILE), 'The MoBrowser test profile is already in use (another test run, or npm run mobrowser:setup is open).')
    const mo = await MoBrowser.launch({ profileDir: MO_PROFILE, port: 9350 + testInfo.workerIndex, headless: process.env.CC_MOBROWSER_HEADLESS === '1' })
    expect(profileLocked(MO_PROFILE), 'the test MoBrowser runs on the test profile').toBe(true)
    await mo.serve(LIVE_ORIGIN, DIST)
    await provide(mo)
    // Evidence of the last screen; if MoBrowser already went away, record why instead.
    const shot = await mo.screenshot().then((b) => ({ body: b, contentType: 'image/png' }), (e: Error) => ({ body: Buffer.from(`no screenshot: ${e.message}`), contentType: 'text/plain' }))
    await testInfo.attach('mobrowser-last-screen', shot)
    await mo.close()
    // Closed when the test profile's lock is released.
    // MoBrowser can take over a minute to save its session and quit on a busy machine.
    const deadline = Date.now() + 120_000
    while (profileLocked(MO_PROFILE)) {
      if (Date.now() > deadline) throw new Error('the test MoBrowser did not close within 2 minutes')
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(mo.interceptErrors, 'every request for the build was answered from dist/').toEqual([])
  },
  moApp: async ({ mo }, provide) => {
    await provide(new MoApp(mo))
  },
})

export { expect }
