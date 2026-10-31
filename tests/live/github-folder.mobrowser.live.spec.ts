/**
 * LIVE in the real MoBrowser: GitHub and folder backup and restore through
 * MoBrowser's own host bridge (fixtures/mobrowser.ts explains the set-up and
 * what keeps it safe). Opt-in: `npm run test:live`, with the QA account in the
 * environment and the MoBrowser TEST profile prepared once with
 * `npm run mobrowser:setup` (repository "cc" and the QA backup folder).
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
const isTestRepo = (e: VaultEntry) => repoName(e) === MO_TEST_REPO || repoName(e).endsWith(`/${MO_TEST_REPO}`)
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

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
  await moApp.backToProjects()
  const project = (await moApp.store<{ id: string; name: string }>('projects')).find((p) => p.name === name)!
  const docs = (await moApp.store<{ id: string; projectId: string; name: string; pageCount: number; data: { __bytes: number } }>('documents')).filter((d) => d.projectId === project.id)
  return { project, docs: docs.map((d) => ({ id: d.id, name: d.name, pageCount: d.pageCount, bytes: d.data.__bytes })) }
}

async function expectRestored(moApp: MoApp, before: Awaited<ReturnType<typeof projectWithPdf>>) {
  await moApp.mo.waitFor(`() => !!document.querySelector('input[placeholder="New project name..."]')`, undefined, 120_000, 'Home after the restore reload')
  const projects = await moApp.store<{ id: string; name: string }>('projects')
  expect(projects.map((p) => p.id)).toContain(before.project.id)
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
      for (const e of git) await moApp.mo.waitFor(`(n) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith(n))`, String(e.name ?? e.label ?? repoName(e)), 15_000, `repository "${repoName(e)}" in the picker`)
    }
    await moApp.mo.press('Escape')
    await moApp.mo.click(find.button, 'Close', 'Close the Data Center')
    await moApp.openDataCenter('Backup', 'Local')
    await openPicker(moApp, 'Where to save')
    if (local.length === 0) {
      await moApp.mo.waitFor(`() => document.body.innerText.includes("No folders yet. Add one in the browser's credential manager.")`, undefined, 30_000, 'the no-folder guidance in the picker')
    } else {
      for (const e of local) await moApp.mo.waitFor(`(n) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith(n))`, String(e.name ?? path.basename(e.path ?? '')), 15_000, `folder "${e.name}" in the picker`)
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
    const before = await projectWithPdf(moApp, name, pdf)

    await moApp.openDataCenter('Backup', 'GitHub')
    const label = String(repo!.name ?? repo!.label ?? repoName(repo!))
    await openPicker(moApp, 'Which repository')
    await moApp.mo.click(`(n) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(n + ' ') || b.textContent.trim() === n)`, label, `repository "${label}"`)
    await moApp.mo.click(find.placeholder, 'Backup note / description (optional)', 'the backup note')
    await moApp.mo.type(`QA ${tag}`)
    await moApp.mo.click(find.button, 'Back up now', 'Back up now')
    await moApp.mo.waitFor(`(n) => document.body.innerText.includes('Backed up to ' + n)`, label, 300_000, `"Backed up to ${label}"`)
    await moApp.mo.click(find.button, 'Close', 'Close the Data Center')

    await moApp.deleteProject(name)
    await moApp.mo.waitFor(`(n) => !document.body.innerText.includes(n)`, name, 30_000, 'the project to be deleted')

    await moApp.openDataCenter('Restore', 'GitHub')
    await moApp.mo.click(`(n) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(n + ' '))`, label, `repository "${label}" in the restore list`)
    const dialog = await moApp.mo.acceptNextDialog(true)
    await moApp.mo.click(`(t) => [...document.querySelectorAll('button')].find((b) => /^Restore backup from /.test(b.getAttribute('aria-label') || '') && (b.getAttribute('aria-label') || '').includes(t))`, `QA ${tag}`, 'this run\'s backup in the list')
    expect(await dialog).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
    await expectRestored(moApp, before)
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
      const label = String(folder!.name ?? path.basename(folder!.path!))
      await openPicker(moApp, 'Where to save')
      await moApp.mo.click(`(n) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(n + ' ') || b.textContent.trim() === n)`, label, `folder "${label}"`)
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
      await moApp.mo.click(`(n) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(n + ' '))`, label, `folder "${label}" in the restore list`)
      const dialog = await moApp.mo.acceptNextDialog(true)
      await moApp.mo.click(`(t) => [...document.querySelectorAll('button')].find((b) => /^Restore backup from /.test(b.getAttribute('aria-label') || '') && (b.getAttribute('aria-label') || '').includes(t))`, `QA ${tag}`, 'this run\'s backup in the list')
      expect(await dialog).toEqual({ type: 'confirm', message: RESTORE_CONFIRM })
      await expectRestored(moApp, before)
    } finally {
      // Leave the QA folder as it was: remove what this run wrote, put the descriptions file back.
      for (const f of files(MO_TEST_FOLDER)) if (!beforeFiles.has(f) && f !== path.relative(MO_TEST_FOLDER, descFile)) rmSync(path.join(MO_TEST_FOLDER, f), { force: true, recursive: true })
      if (descBefore) writeFileSync(descFile, descBefore)
      else rmSync(descFile, { force: true })
    }
  })
})
