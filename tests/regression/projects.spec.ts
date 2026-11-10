/**
 * Regression: project management on the Home screen.
 * Name rule (utils/projectName.ts): trimmed, 1-100 chars, letters/digits/spaces.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/shell.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { BAD_FILES, FIND_PDF, TEXT_FILES } from '../../data/files.js'
import { knownDefect } from '../../helpers/defects.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { mockCatalog } from '../../helpers/mockApi.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

test.describe('Project names', { tag: ['@regression', '@projects'] }, () => {
  test('REG-010 an empty name is refused with "Name cannot be empty"', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await expect(app.home.create).toBeDisabled()
    await app.home.newProjectName.fill('   ')
    await app.home.newProjectName.press('Enter')
    await expect(page.getByRole('alert')).toHaveText('Name cannot be empty')
    await expectStoreCount(page, 'projects', 0)
  })

  test('REG-011 punctuation is refused with the allowed-characters rule', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.home.createProject('Bio-Chem: Unit 1!', 'enter')
    await expect(page.getByRole('alert')).toHaveText('Only letters, numbers, and spaces are allowed')
    await expectStoreCount(page, 'projects', 0)
  })

  test('REG-012 the name field accepts at most 100 characters and trims spaces', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    await expect(app.home.newProjectName).toHaveAttribute('maxlength', '100')
    await app.home.createProject(`  ${'A'.repeat(98)}  `)
    await expect.poll(async () => (await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual(['A'.repeat(98)])
  })
})

test.describe('Project list', { tag: ['@regression', '@projects'] }, () => {
  test('REG-013 search filters the list and explains an empty result', { tag: '@P2' }, async ({ signedIn: app }) => {
    for (const name of ['Biology Notes', 'Chemistry Lab', 'Biology Exam']) {
      await app.home.createProject(name)
      await app.documents.backToProjects.click()
    }
    await expect(app.home.cards).toHaveCount(3)
    await app.home.search.fill('biology')
    await expect(app.home.cards).toHaveCount(2)
    await expect(app.home.countHeading).toHaveText('2 of 3 found')
    await app.home.search.fill('physics')
    await expect(app.home.cards).toHaveCount(0)
    await expect(app.home.statusLine('No project matches “physics”.')).toBeVisible()
  })

  test('REG-014 renaming a project from its card is saved', { tag: ['@P2', '@sanity'] }, async ({ signedIn: app, page }) => {
    await app.home.createProject('Old Name')
    await app.documents.backToProjects.click()
    await app.home.renameProject('Old Name', 'New Name')
    await expect(app.home.card('New Name')).toBeVisible()
    await expect.poll(async () => (await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual(['New Name'])
  })

  test('REG-015 deleting a project removes it and everything in it', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page }) => {
    await app.home.createProject('Doomed Project')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.canvas.place('note', 0.5, 0.4)
    await expectStoreCount(page, 'workspaceItems', 1)
    await app.header.home.click()
    await app.home.deleteProject('Doomed Project')
    await expect(app.home.emptyState).toBeVisible()
    for (const store of ['projects', 'documents', 'workspaceItems', 'searchText'] as const) await expectStoreCount(page, store, 0)
  })

  test('REG-016 a project card counts its documents', { tag: '@P3' }, async ({ project, app }) => {
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.header.home.click()
    await expect(app.home.card(project.name)).toContainText('1 doc')
  })
})

test.describe('Upload from Home', { tag: ['@regression', '@projects', '@files'] }, () => {
  test('REG-017 a PDF uploaded from Home becomes a new project holding it, and the PDF opens from that project', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.home.upload(FIND_PDF.payload())
    // The upload ends inside the new project (see REG-633 for which view it should open on).
    await expect(page.getByRole('button', { name: /^Back to (projects|documents)$/ })).toBeVisible({ timeout: 45_000 })
    await expect.poll(async () => (await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual(['New Project 1'])
    await expectStoreCount(page, 'documents', 1)
    await app.header.home.click()
    await expect(app.home.card('New Project 1')).toContainText('1 doc')
    await app.home.openProject('New Project 1')
    await expect(app.documents.card(FIND_PDF.displayName)).toContainText(`${FIND_PDF.pageCount} pages`)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
  })

  test('REG-018 an unreadable PDF uploaded from Home is reported and leaves no empty project', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-004')
    await app.home.upload(BAD_FILES.corruptPdf())
    await expect(page.getByText(/automation-corrupt/).first()).toBeVisible()
    await app.header.home.click()
    await expect(app.home.emptyState).toBeVisible()
    await expectStoreCount(page, 'projects', 0, () => true, 5_000)
  })
})

/* ── Added by the shell suite (REG-623..635) ─────────────────────────────── */

const projectRows = (page: Page) => readStore<{ id: string; name: string; lastOpenedAt: number }>(page, 'projects')

async function makeProjects(app: CognitiveCanvas, names: string[]) {
  for (const name of names) {
    await app.home.createProject(name)
    await app.documents.expectOpen(name)
    await app.documents.backToProjects.click()
  }
}

/** Mock a one-item catalog whose ZIP request waits until the returned release() is called, then answers 404. */
async function holdCatalogZip(page: Page) {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await mockCatalog(page, [{ id: 'auto-pending-1', title: 'Automation Pending Pack', category: 'Science', zipUrl: 'https://api.muulorigin.com/e2e/automation-pending.zip', itemCount: 1, sortOrder: 1 }])
  await page.route('https://api.muulorigin.com/e2e/automation-pending.zip', async (route) => {
    await held
    await route.fulfill({ status: 404, body: 'not here' })
  })
  return release
}

/** In the open Catalog: the Science category, then its item's Download. */
async function startCatalogDownload(page: Page) {
  await page.getByRole('heading', { name: 'Science', level: 3 }).click()
  await page.getByRole('button', { name: 'Download', exact: true }).click()
}

test.describe('Project cards', { tag: ['@regression', '@projects'] }, () => {
  test('REG-623 Delete asks first: the dialog explains it cannot be undone, and Cancel keeps the project', { tag: '@P1' }, async ({ signedIn: app, page }) => {
    await makeProjects(app, ['Not Deleted'])
    await app.home.cardAction('Not Deleted', 'Delete')
    const dialog = page.getByRole('dialog', { name: 'Delete Project' })
    await expect(dialog).toContainText('This will permanently delete this project and all its contents. This action cannot be undone.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(app.home.card('Not Deleted')).toBeVisible()
    expect((await projectRows(page)).map((p) => p.name)).toEqual(['Not Deleted'])
  })

  test('REG-624 the list shows the most recently opened project first, and opening one moves it to the front', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await makeProjects(app, ['First Made', 'Second Made', 'Third Made'])
    const names = () => app.home.cards.locator('h3').allTextContents()
    await expect.poll(names).toEqual(['Third Made', 'Second Made', 'First Made'])
    const before = (await projectRows(page)).find((p) => p.name === 'First Made')!.lastOpenedAt
    await app.home.openProject('First Made')
    await app.documents.expectOpen('First Made')
    await app.documents.backToProjects.click()
    await expect.poll(names).toEqual(['First Made', 'Third Made', 'Second Made'])
    expect((await projectRows(page)).find((p) => p.name === 'First Made')!.lastOpenedAt).toBeGreaterThan(before)
  })

  test('REG-625 the name rule is checked while typing: Create stays disabled with a message until the name is fixed', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.home.newProjectName.fill('Physics #1')
    await expect(app.home.nameError).toHaveText('Only letters, numbers, and spaces are allowed')
    await expect(app.home.create).toBeDisabled()
    await app.home.newProjectName.press('Enter')
    await expect(app.documents.backToProjects).toBeHidden()
    await app.home.newProjectName.fill('Physics 1')
    await expect(app.home.nameError).toBeHidden()
    await expect(app.home.create).toBeEnabled()
    await app.home.newProjectName.fill('')
    await expect(app.home.nameError).toBeHidden() // an emptied field is not shouted at mid-typing
    await expectStoreCount(page, 'projects', 0)
  })

  test('REG-626 renaming from the card menu: Escape cancels, a bad name keeps editing with the rule, blur saves the trimmed name', { tag: '@P2' }, async ({ signedIn: app, shell, page }) => {
    await makeProjects(app, ['Draft Name'])
    const card = app.home.cards.first()
    await app.home.cardAction('Draft Name', 'Rename')
    const input = shell.projects.renameInput(card)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Draft Name')
    await input.fill('Never Saved')
    await input.press('Escape')
    await expect(card.getByText('Draft Name', { exact: true })).toBeVisible()
    expect((await projectRows(page)).map((p) => p.name)).toEqual(['Draft Name'])

    await app.home.cardAction('Draft Name', 'Rename')
    await input.fill('Bad/Name')
    await expect(shell.projects.renameError(card)).toHaveText('Only letters, numbers, and spaces are allowed')
    await input.press('Enter')
    await expect(input).toBeVisible() // still editing
    await input.fill('  Final Name  ')
    await expect(shell.projects.renameError(card)).toBeHidden()
    await page.getByRole('heading', { name: /^Projects \(/ }).click() // blur
    await expect(card.getByText('Final Name', { exact: true })).toBeVisible()
    await expect.poll(async () => (await projectRows(page)).map((p) => p.name)).toEqual(['Final Name'])
  })

  test('REG-638 double-clicking a project\'s name on its card renames it in place instead of opening it', { tag: '@P3' }, async ({ signedIn: app, shell }) => {
    knownDefect('DEF-603')
    await makeProjects(app, ['Double Click Me'])
    const card = app.home.cards.first()
    await card.getByText('Double Click Me', { exact: true }).dblclick()
    await expect(shell.projects.renameInput(card)).toBeFocused()
    await expect(shell.projects.renameInput(card)).toHaveValue('Double Click Me')
    await expect(app.documents.backToProjects).toBeHidden()
  })

  test('REG-627 the project name in the document-list header renames with Save, Cancel, Escape and the same rule', { tag: '@P2' }, async ({ project, app, page }) => {
    const header = page.getByTitle('Click to rename')
    await header.click()
    const input = page.getByRole('textbox').first()
    await expect(input).toHaveValue(project.name)
    await input.fill('Bad: Name')
    await expect(page.getByRole('alert')).toHaveText('Only letters, numbers, and spaces are allowed')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(input).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTitle('Click to rename')).toHaveText(project.name)

    await page.getByRole('button', { name: 'Rename' }).click() // the pencil
    await input.fill('Ignored Name')
    await input.press('Escape')
    await expect(page.getByTitle('Click to rename')).toHaveText(project.name)

    await page.getByTitle('Click to rename').click()
    await input.fill('Header Renamed')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTitle('Click to rename')).toHaveText('Header Renamed')
    await expect.poll(async () => (await projectRows(page)).map((p) => p.name)).toEqual(['Header Renamed'])
    await app.documents.backToProjects.click()
    await expect(app.home.card('Header Renamed')).toBeVisible()
  })

  test('REG-628 the empty library says so; Create Project focuses the name field and Upload opens the file picker for the supported types', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await expect(app.home.emptyState).toBeVisible()
    await expect(page.getByText('Create a new project, upload a PDF to get started, or restore a backup.')).toBeVisible()
    await expect(app.home.search).toBeHidden()
    await shell.projects.createProjectCta.click()
    await expect(app.home.newProjectName).toBeFocused()
    const chooser = page.waitForEvent('filechooser')
    await shell.projects.emptyStateUpload.click()
    const fc = await chooser
    expect(fc.isMultiple()).toBe(true)
    expect(await fc.element().getAttribute('accept')).toBe('.pdf,.md,.markdown,.txt,.text,.zip,.ccbak')
  })

  test('REG-629 the clear button empties the search and brings every project back', { tag: '@P3' }, async ({ signedIn: app, shell }) => {
    await makeProjects(app, ['Apple Project', 'Banana Project'])
    await expect(app.home.countHeading).toHaveText('Projects (2)')
    await app.home.search.fill('apple')
    await expect(app.home.cards).toHaveCount(1)
    await expect(app.home.countHeading).toHaveText('1 of 2 found')
    await shell.projects.clearSearch.click()
    await expect(app.home.search).toHaveValue('')
    await expect(app.home.cards).toHaveCount(2)
    await expect(shell.projects.clearSearch).toBeHidden()
  })

  test('REG-630 a card shows its last-opened date and, signed out, a menu of Rename, Download and Delete without Share', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await makeProjects(app, ['Dated Project'])
    const [row] = await projectRows(page)
    const date = new Date(row.lastOpenedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    await expect(app.home.card('Dated Project')).toContainText(date)
    await expect(app.home.card('Dated Project')).toContainText('0 docs')
    await app.home.card('Dated Project').getByRole('button', { name: 'More actions' }).click()
    const menu = shell.projects.cardMenu(app.home.card('Dated Project'))
    await expect(menu.getByRole('button')).toHaveText(['Rename', 'Download', 'Delete'])
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { name: /^Projects \(/ }).click() // outside click closes it
    await expect(menu).toBeHidden()
  })

  test('REG-631 Download on a card saves the project as a dated ZIP with its manifest and PDF', { tag: '@P2' }, async ({ project, app, page }, testInfo) => {
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.header.home.click()
    const download = page.waitForEvent('download')
    await app.home.cardAction(project.name, 'Download')
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^Automation_Project_\d{4}-\d{2}-\d{2}_\d{1,2}-\d{2}-(am|pm)\.zip$/)
    const zipPath = testInfo.outputPath('project.zip')
    await file.saveAs(zipPath)
    const zip = BackupZip.fromFile(zipPath)
    const id = (await projectRows(page))[0].id
    expect(zip.manifest).toMatchObject({ version: 1, appName: 'cognitive-canvas', type: 'single', projectIds: [id] })
    expect(zip.json<{ name: string }>('project.json').name).toBe(project.name)
    expect(zip.documentFiles(id)).toHaveLength(1)
  })

  test('REG-632 several files uploaded from Home make one project, stay on Home and report what was skipped', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.home.upload([FIND_PDF.payload(), TEXT_FILES.markdown(), BAD_FILES.exe()])
    await expect(app.home.statusLine('Uploaded 2 files · skipped 1')).toBeVisible({ timeout: 45_000 })
    await expect(app.documents.backToProjects).toBeHidden()
    await expect(app.home.card('New Project 1')).toContainText('2 docs')
    expect((await projectRows(page)).map((p) => p.name)).toEqual(['New Project 1'])
    await expectStoreCount(page, 'documents', 2)
  })

  test('REG-955 files from Home that cannot be used are each refused by name with the reason, and no project is made', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    // Text saved as .pdf is refused for its contents (the app reads the bytes, not the name); an .exe for its type.
    await app.home.upload([BAD_FILES.textAsPdf(), BAD_FILES.exe()])
    await expect(app.home.statusLine("Skipped: automation-text-as.pdf (contents don't match its name), automation-program.exe (unsupported)")).toBeVisible({ timeout: 30_000 })
    await expect(app.documents.backToProjects).toBeHidden()
    expect(await projectRows(page)).toEqual([])
    await expectStoreCount(page, 'documents', 0)
  })

  test('REG-633 a single file uploaded from Home opens straight away, like a single upload inside a project', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-604')
    await app.home.upload(TEXT_FILES.markdown())
    await expect(page.getByRole('button', { name: 'Back to documents' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('MARKDOWNMARKER').first()).toBeVisible()
    expect((await projectRows(page)).map((p) => p.name)).toEqual(['New Project 1'])
  })

  test('REG-634 a long project name is cut short on the card and shown whole in a hover tip', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    const long = 'A very long project name that cannot possibly fit on one small card in the grid'
    await makeProjects(app, [long])
    const title = app.home.cards.first().locator('h3')
    expect(await title.evaluate((h) => h.scrollWidth > h.clientWidth)).toBe(true)
    await title.hover()
    await expect(shell.projects.tooltip).toHaveText(long)
    await page.mouse.move(5, 790)
    await expect(shell.projects.tooltip).toBeHidden()
    await app.home.cards.first().getByRole('button', { name: 'More actions' }).hover()
    await expect(shell.projects.tooltip).toHaveText(long)
  })

  test('REG-635 a catalog download shows a placeholder card on Home while it runs, and its failure on that card', { tag: ['@P3', '@api'] }, async ({ app, shell, page }) => {
    const release = await holdCatalogZip(page)
    await app.open()
    await app.pinSetup.createPin()
    await expect(page.getByText('Automation Pending Pack').first()).toBeVisible()
    await app.home.reach()
    await app.home.createProject('Existing Project')
    await app.documents.backToProjects.click()
    await app.header.exploreContent.click()
    await startCatalogDownload(page)
    await app.header.home.click()
    const pending = shell.projects.pendingCards
    await expect(pending).toHaveCount(1)
    await expect(pending).toContainText('Automation Pending Pack')
    await expect(pending).toContainText('Downloading…')
    await expect(pending).toHaveAttribute('aria-busy', 'true')
    await pending.click() // inert: nothing opens
    await expect(app.documents.backToProjects).toBeHidden()

    release()
    await expect(pending).toContainText('Download failed: 404')
    await expect(pending).toHaveAttribute('aria-busy', 'false')
    await expect(pending).toHaveCount(0, { timeout: 10_000 }) // cleared after a few seconds
    expect((await projectRows(page)).map((p) => p.name)).toEqual(['Existing Project'])
  })
  // The empty-library case is REG-738 (catalog-download.spec.ts, DEF-705).
})

/**
 * A file dropped from the desktop. Playwright cannot drag a file in from the
 * OS, so the drop is dispatched with a DataTransfer built in the page (the
 * documented Playwright pattern); the app's own window listener handles it.
 */
async function dropFile(page: Page, name: string, type: string, text: string) {
  const dataTransfer = await page.evaluateHandle(({ name, type, text }) => {
    const dt = new DataTransfer()
    dt.items.add(new File([text], name, { type }))
    return dt
  }, { name, type, text })
  await page.dispatchEvent('body', 'dragover', { dataTransfer })
  await page.dispatchEvent('body', 'drop', { dataTransfer })
}

test.describe('Dropping files', { tag: ['@regression', '@projects', '@files'] }, () => {
  test('REG-636 a file dropped anywhere on Home becomes a new project, opened on it, and the tab stays in the app', { tag: '@P2' }, async ({ signedIn: _app, page }) => {
    const url = page.url()
    await dropFile(page, 'dropped-notes.md', 'text/markdown', '# Dropped\n\nDROPMARKER text.\n')
    // The drop ends inside the new project (which view it opens on is REG-633's question).
    await expect(page.getByRole('button', { name: /^Back to (projects|documents)$/ })).toBeVisible()
    expect(page.url()).toBe(url)
    expect((await projectRows(page)).map((p) => p.name)).toEqual(['New Project 1'])
    expect((await readStore<{ name: string }>(page, 'documents')).map((d) => d.name)).toEqual(['dropped-notes.md'])
  })

  test('REG-637 a file dropped where nothing takes it (Settings) is refused with a hint and creates nothing', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    await app.header.settings.click()
    await app.settings.expectOpen()
    const url = page.url()
    await dropFile(page, 'stray.md', 'text/markdown', 'stray')
    await app.toasts.expectShown('Open a project first, then drop files there to add them.')
    expect(page.url()).toBe(url)
    await app.settings.expectOpen()
    await expectStoreCount(page, 'projects', 0)
  })
})
