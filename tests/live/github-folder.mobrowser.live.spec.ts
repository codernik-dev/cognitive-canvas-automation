/**
 * LIVE in the real MoBrowser: GitHub and folder backup and restore through
 * MoBrowser's own host bridge (fixtures/mobrowser.ts explains the set-up and
 * what keeps it safe). Opt-in: `npm run live`, with the QA account in the
 * environment and the MoBrowser TEST profile prepared once with
 * `npm run mobrowser:setup` (repository codernik-dev/cc-test- and the QA backup folder).
 *
 * REG-903/904 need no connection and always run. REG-905/906 need the
 * connection and are skipped, saying exactly what is missing, until it exists.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { test, expect, MO_TEST_FOLDER, MO_TEST_REPO, type MoApp, type VaultEntry } from '../../fixtures/mobrowser.js'
import { find } from '../../helpers/mobrowser/bidi.js'
import { RESTORE_CONFIRM } from '../../workflows/backup.js'
import { FIND_PDF } from '../../data/files.js'

const tagOf = () => `e2e${Date.now().toString(36)}`
const repoName = (e: VaultEntry) => String(e.repository ?? e.repo ?? e.name ?? '')
const [TEST_OWNER, TEST_NAME] = MO_TEST_REPO.includes('/') ? MO_TEST_REPO.toLowerCase().split('/') : ['', MO_TEST_REPO.toLowerCase()]
/** The repository name must match, and the owner too whenever the entry reports one. */
const isTestRepo = (e: VaultEntry) => {
  const full = repoName(e).toLowerCase()
  const owner = full.includes('/') ? full.split('/')[0] : String(e.owner ?? '').toLowerCase()
  return full.split('/').pop() === TEST_NAME && (!TEST_OWNER || !owner || owner === TEST_OWNER)
}
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
/** In an open repository or folder menu, its rows (the buttons beside its "↻ Refresh"), once there are `want` of them. */
const MENU_ROWS = `(want) => { const refresh = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('↻')); if (!refresh) return null; const rows = [...refresh.parentElement.querySelectorAll('button')].filter((b) => b !== refresh); return rows.length === want ? rows.length : null }`

/** A native dialog the app should open within `ms`; one that never comes fails with `what` instead of hanging. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no ${what} within ${ms / 1000} s`)), ms))])
}

/** The first of these names that is not empty (a vault entry may hold an empty name). */
const firstName = (...names: (string | undefined)[]) => names.map((n) => String(n ?? '').trim()).find(Boolean) ?? ''

/** Open the repository or folder picker (the button under its label). */
async function openPicker(moApp: MoApp, label: 'Which repository' | 'Where to save') {
  await moApp.mo.click(`(l) => { const h = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === l); return h && h.nextElementSibling && h.nextElementSibling.querySelector('button') }`, label, `the picker under "${label}"`)
}

/** PIN, a project holding the 4-page test PDF, back on Home. Returns what was stored, to compare after the restore. */
async function projectWithPdf(moApp: MoApp, name: string, pdfFile: string) {
  await moApp.signIn()
  await moApp.openFresh()
  await moApp.createPin()
  await moApp.createProject(name)
  await moApp.uploadPdf(pdfFile, FIND_PDF.pageCount)
  // One uploaded PDF opens in the viewer, whose way back is "Go to home" (not the document list's "Back to projects").
  await moApp.home()
  const project = (await moApp.store<{ id: string; name: string }>('projects')).find((p) => p.name === name)!
  const docs = (await moApp.store<{ id: string; projectId: string; name: string; pageCount: number; data: { __bytes: number } }>('documents')).filter((d) => d.projectId === project.id)
  return { project, docs: docs.map((d) => ({ id: d.id, name: d.name, pageCount: d.pageCount, bytes: d.data.__bytes })) }
}

async function expectRestored(moApp: MoApp, before: Awaited<ReturnType<typeof projectWithPdf>>) {
  // Home shows at once (the restore runs behind it, then reloads): wait for the project itself, reading through the reload.
  await expect.poll(async () => (await moApp.store<{ id: string }>('projects')).map((p) => p.id), { timeout: 120_000, message: 'the project came back' }).toContain(before.project.id)
  await moApp.mo.waitFor(`() => !!document.querySelector('input[placeholder="New project name..."]')`, undefined, 120_000, 'Home after the restore reload')
  const docs = (await moApp.store<{ id: string; projectId: string; name: string; pageCount: number; data: { __bytes: number } }>('documents')).filter((d) => d.projectId === before.project.id)
  expect(docs.map((d) => ({ id: d.id, name: d.name, pageCount: d.pageCount, bytes: d.data.__bytes }))).toEqual(before.docs)
}

test.describe('Live: MoBrowser host, GitHub and folder', { tag: ['@live', '@backup', '@mobrowser'] }, () => {
  test.describe.configure({ mode: 'serial' })

  test('REG-903 in the real MoBrowser the app finds the host bridge, and its GitHub host reports the streamed push the app relies on', { tag: '@P1' }, async ({ moApp }) => {
    await moApp.signIn()
    await moApp.openFresh()
    const host = await moApp.mo.eval<{ bridge: string; vault: string; caps: { ok: boolean; data?: { streamPush?: unknown; maxChunkBytes?: unknown } } }>(`async () => {
      const raw = await window.externalMessage.send(JSON.stringify({ type: 'GIT_CAPABILITIES' }));
      const caps = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { bridge: typeof window.externalMessage.send, vault: typeof window.credentialBridge.list, caps: { ok: caps.ok, data: caps.data ?? caps.result } };
    }`)
    expect(host.bridge).toBe('function')
    expect(host.vault).toBe('function')
    expect(host.caps.ok).toBe(true)
    expect(host.caps.data?.streamPush).toBe(true)
    expect(Number(host.caps.data?.maxChunkBytes)).toBeGreaterThan(0)
    // The vault answers with lists, which the app reads as its repositories and folders.
    expect(Array.isArray(await moApp.vault('git'))).toBe(true)
    expect(Array.isArray(await moApp.vault('local'))).toBe(true)
  })

  test('REG-904 signed in on the QA account, GitHub and folder backup offer exactly what MoBrowser holds, or say how to add it', { tag: '@P2' }, async ({ moApp }) => {
    await moApp.signIn()
    await moApp.openFresh()
    await moApp.createPin()
    // A library with a project: the first-run catalog only opens (late) on an empty one.
    await moApp.createProject(`Vault ${tagOf()}`)
    await moApp.backToProjects()
    const git = await moApp.vault('git')
    const local = await moApp.vault('local')
    await moApp.openDataCenter('Backup', 'GitHub')
    await moApp.mo.waitFor(`() => document.body.innerText.includes('Back up to GitHub')`, undefined, 30_000, 'the GitHub backup page (plan unlocked)')
    // The picker lists exactly the repositories MoBrowser's vault holds; with none, it says where to add one.
    await openPicker(moApp, 'Which repository')
    if (git.length === 0) {
      await moApp.mo.waitFor(`() => document.body.innerText.includes("No repositories yet. Add one in the browser's credential manager.")`, undefined, 30_000, 'the no-repository guidance in the picker')
    } else {
      // Each by its "owner/repo · branch" line, always shown (a name may be empty), and nothing more.
      for (const e of git) {
        const full = repoName(e).includes('/') || !e.owner ? repoName(e) : `${e.owner}/${repoName(e)}`
        await moApp.mo.waitFor(`(n) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(n + ' · '))`, full, 15_000, `repository "${full}" in the picker`)
      }
      await moApp.mo.waitFor(MENU_ROWS, git.length, 15_000, `exactly ${git.length} repositories in the picker`)
    }
    await moApp.mo.press('Escape')
    await moApp.mo.click(find.button, 'Close', 'Close the Data Center')
    await moApp.openDataCenter('Backup', 'Local')
    await openPicker(moApp, 'Where to save')
    if (local.length === 0) {
      await moApp.mo.waitFor(`() => document.body.innerText.includes("No folders yet. Add one in the browser's credential manager.")`, undefined, 30_000, 'the no-folder guidance in the picker')
    } else {
      // Each by its path, always shown, and nothing more.
      for (const e of local) await moApp.mo.waitFor(`(p) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(p))`, String(e.path ?? ''), 15_000, `folder "${e.path}" in the picker`)
      await moApp.mo.waitFor(MENU_ROWS, local.length, 15_000, `exactly ${local.length} folders in the picker`)
    }
  })

  test('REG-905 a real GitHub backup into the test repository through MoBrowser restores the deleted project identical', { tag: '@P1' }, async ({ moApp }, testInfo) => {
    test.setTimeout(600_000)
    await moApp.signIn()
    await moApp.openFresh()
    const repo = (await moApp.vault('git')).find(isTestRepo)
    test.skip(!repo, `Connect the GitHub repository "${MO_TEST_REPO}" in the MoBrowser test profile once: npm run mobrowser:setup`)
    const tag = tagOf()
    const name = `Git ${tag}`
    const pdf = testInfo.outputPath(FIND_PDF.payload().name)
    writeFileSync(pdf, FIND_PDF.payload().buffer)
    const before = await test.step('a project with the 4-page PDF', () => projectWithPdf(moApp, name, pdf))

    // The picker and the restore list show each repository as its name (owner/repo when the vault entry has
    // none), then "owner/repo · branch": the repository is picked by that second line, which is always there.
    const full = repoName(repo!).includes('/') || !repo!.owner ? repoName(repo!) : `${repo!.owner}/${repoName(repo!)}`
    const byRepo = `(n) => [...document.querySelectorAll('button')].filter((b) => b.textContent.includes(n + ' · ')).at(-1)`
    await test.step(`back up to GitHub (${full})`, async () => {
      await moApp.openDataCenter('Backup', 'GitHub')
      await openPicker(moApp, 'Which repository')
      await moApp.mo.click(byRepo, full, `repository "${full}"`)
      await moApp.mo.click(find.placeholder, 'Backup note / description (optional)', 'the backup note')
      await moApp.mo.type(`QA ${tag}`)
      await moApp.mo.click(find.button, 'Back up now', 'Back up now')
      // The app names the repository as the vault entry's name, else owner/repo (vaultDestinations.ts).
      const shown = firstName(repo!.name, repo!.label, full)
      await moApp.mo.waitFor(`(n) => document.body.innerText.includes('Backed up to ' + n)`, shown, 300_000, `"Backed up to ${shown}"`)
      await moApp.mo.click(find.button, 'Close', 'Close the Data Center')
    })

    await test.step('delete the project', async () => {
      await moApp.deleteProject(name)
      await moApp.mo.waitFor(`(n) => !document.body.innerText.includes(n)`, name, 30_000, 'the project to be deleted')
    })

    await test.step('restore it from GitHub', async () => {
      await moApp.openDataCenter('Restore', 'GitHub')
      await moApp.mo.click(byRepo, full, `repository "${full}" in the restore list`)
      const { opened } = await moApp.mo.acceptNextDialog(true)
      await moApp.mo.click(`(t) => [...document.querySelectorAll('button')].find((b) => /^Restore backup from /.test(b.getAttribute('aria-label') || '') && (b.getAttribute('aria-label') || '').includes(t))`, `QA ${tag}`, 'this run\'s backup in the list')
      expect(await within(opened, 60_000, 'restore confirmation')).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
      await expectRestored(moApp, before)
    })
  })

  test('REG-906 a real folder backup through MoBrowser into the QA folder restores the deleted project identical, and its files are then removed', { tag: '@P1' }, async ({ moApp }, testInfo) => {
    test.setTimeout(600_000)
    await moApp.signIn()
    await moApp.openFresh()
    const folder = (await moApp.vault('local')).find((e) => e.path && samePath(e.path, MO_TEST_FOLDER))
    test.skip(!folder, `Add the folder ${MO_TEST_FOLDER} in the MoBrowser test profile once: npm run mobrowser:setup`)
    const files = (dir: string) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : [])
    const beforeFiles = new Set(files(MO_TEST_FOLDER))
    const descFile = path.join(MO_TEST_FOLDER, 'CognitiveCanvas', 'cc-backup-descriptions.json')
    const descBefore = existsSync(descFile) ? readFileSync(descFile) : null
    try {
      const tag = tagOf()
      const name = `Folder ${tag}`
      const pdf = testInfo.outputPath(FIND_PDF.payload().name)
      writeFileSync(pdf, FIND_PDF.payload().buffer)
      const before = await projectWithPdf(moApp, name, pdf)

      await moApp.openDataCenter('Backup', 'Local')
      // Folders are listed as their name, then their path: picked by the path, the open menu's row (the last
      // button with it, after the picker's own button that shows the current choice).
      const byPath = `(p) => [...document.querySelectorAll('button')].filter((b) => b.textContent.includes(p)).at(-1)`
      await openPicker(moApp, 'Where to save')
      await moApp.mo.click(byPath, folder!.path, `folder "${folder!.path}"`)
      await moApp.mo.click(find.placeholder, 'Backup note / description (optional)', 'the backup note')
      await moApp.mo.type(`QA ${tag}`)
      await moApp.mo.click(find.button, 'Back up now', 'Back up now')
      await moApp.mo.waitFor(`() => /Backed up to "|Backup saved: /.test(document.body.innerText)`, undefined, 120_000, 'the folder backup to finish')
      // A real file landed in the folder.
      expect(files(MO_TEST_FOLDER).filter((f) => !beforeFiles.has(f) && /\.zip$/i.test(f)).length).toBe(1)
      await moApp.mo.click(find.button, 'Close', 'Close the Data Center')

      await moApp.deleteProject(name)
      await moApp.mo.waitFor(`(n) => !document.body.innerText.includes(n)`, name, 30_000, 'the project to be deleted')

      await moApp.openDataCenter('Restore', 'Local')
      await moApp.mo.click(byPath, folder!.path, `folder "${folder!.path}" in the restore list`)
      const { opened } = await moApp.mo.acceptNextDialog(true)
      await moApp.mo.click(`(t) => [...document.querySelectorAll('button')].find((b) => /^Restore backup from /.test(b.getAttribute('aria-label') || '') && (b.getAttribute('aria-label') || '').includes(t))`, `QA ${tag}`, 'this run\'s backup in the list')
      expect(await within(opened, 60_000, 'restore confirmation')).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
      await expectRestored(moApp, before)
    } finally {
      // Leave the QA folder as it was: remove what this run wrote, put the descriptions file back.
      for (const f of files(MO_TEST_FOLDER)) if (!beforeFiles.has(f) && f !== path.relative(MO_TEST_FOLDER, descFile)) rmSync(path.join(MO_TEST_FOLDER, f), { force: true, recursive: true })
      if (descBefore) writeFileSync(descFile, descBefore)
      else rmSync(descFile, { force: true })
    }
  })
})
