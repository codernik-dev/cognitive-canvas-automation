/**
 * Phone home (Pixel 5, project "phone"): the phone project list
 * (ProjectSelectionScreen renderPhone + MobileProjectRow), the phone header
 * (MobileStorageButton, Menu) and the bottom navigation (MobileBottomNav:
 * Library / Catalog / Assistant, + Calendar in the Legal layout).
 *
 * The desktop project grid is covered in tests/regression/projects*.spec.ts;
 * here only what the phone does differently: dense rows with a ⋯ menu, an
 * inline search, a select bar of its own, and entry points the desktop does
 * not have (the Assistant tab, the bottom-bar calendar).
 */
import { test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { AssistantPanel } from '../../components/ContentAssistant.js'
import { LawCalendarDialog, LawDayDialog } from '../../pages/ContentLaw.js'
import type { MobileShell } from '../../pages/MobileShell.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

interface ProjectRow { id: string; name: string; createdAt: number; updatedAt: number; lastOpenedAt: number }
const projects = (page: import('@playwright/test').Page) => readStore<ProjectRow>(page, 'projects')

/** Create projects from the phone list, coming back to it after each (creating opens the project). */
async function createOnPhone(app: CognitiveCanvas, mobile: MobileShell, names: string[]) {
  for (const name of names) {
    await mobile.home.createProject(name)
    await app.documents.expectOpen(name)
    await app.documents.backToProjects.click()
    await expect(mobile.home.row(name)).toBeVisible()
  }
}

test.describe('Phone home', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-800 a phone gets the compact header, the Library / Catalog / Assistant bar and the phone empty state; the storage size opens Storage', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, mobile, page }) => {
    // The desktop icon row collapses: only logo, storage, the tutorial video and Menu remain.
    await expect(mobile.header.menu).toBeVisible()
    await expect(mobile.header.tutorial).toBeVisible()
    for (const desktopOnly of [app.header.settings, app.header.exploreContent, app.header.backupRestore, app.header.profile, app.header.guidedTour]) {
      await expect(desktopOnly).toHaveCount(0)
    }
    // The bottom bar of the standard layout: no Calendar (the court diary is Legal-only).
    await expect(mobile.nav.tabs).toHaveText(['Library', 'Catalog', 'Assistant'])
    await expect(mobile.nav.tab('Library')).toHaveClass(/text-primary-600/)
    await expect(mobile.home.emptyHeading).toBeVisible()
    await expect(mobile.home.emptyText).toBeVisible()
    await expect(mobile.home.search).toBeVisible()

    // Storage shows the used SIZE (not a percentage that rounds to 0 %), and the dialog behind it.
    await expect(mobile.header.storage).toHaveText(/^\d+(\.\d+)? (B|KB|MB|GB)$/)
    await expect(mobile.header.storage).toHaveAttribute('title', /^Storage — \d+(\.\d+)? (B|KB|MB|GB) used of \d+(\.\d+)? (B|KB|MB|GB) \(\d+%\)$/)
    await mobile.header.storage.click()
    const storage = page.getByRole('dialog', { name: 'Storage' })
    await expect(storage).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(storage).toBeHidden()
  })

  test('REG-801 a project created on the phone opens, is stored, and shows as a row with "0 docs · Just now"; an invalid name is refused in words', { tag: '@P1' }, async ({ signedIn: app, mobile, page }) => {
    await mobile.home.newName.fill('Bad/Name')
    await expect(mobile.home.nameError).toHaveText('Only letters, numbers, and spaces are allowed')
    await expect(mobile.home.create).toBeDisabled()
    await expect.poll(async () => (await projects(page)).length).toBe(0)

    await mobile.home.newName.fill('Field Notes')
    await expect(mobile.home.nameError).toHaveCount(0)
    await mobile.home.create.click()
    await app.documents.expectOpen('Field Notes')
    const [row] = await projects(page)
    expect(row).toMatchObject({ name: 'Field Notes', description: '', thumbnailDataUrl: null })

    await app.documents.backToProjects.click()
    await expect(mobile.home.row('Field Notes')).toBeVisible()
    await expect(mobile.home.meta('Field Notes')).toHaveText('0 docs·Just now')
    await expect(mobile.home.heading).toHaveText('Projects (1)')
    // Enter creates too.
    await mobile.home.newName.fill('Second Notes')
    await mobile.home.newName.press('Enter')
    await app.documents.expectOpen('Second Notes')
    await expectStoreCount(page, 'projects', 2)
  })

  test('REG-802 the phone search filters the rows as you type, says when nothing matches, and Clear search brings every row back', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await createOnPhone(app, mobile, ['Biology Notes', 'History Essay', 'Chemistry Lab'])
    await mobile.home.search.fill('bio')
    await expect(mobile.home.rows).toHaveCount(1)
    await expect(mobile.home.row('Biology Notes')).toBeVisible()
    await expect(mobile.home.heading).toHaveText('1 found')
    await mobile.home.search.fill('  LAB ')
    await expect(mobile.home.rows).toHaveCount(1)
    await expect(mobile.home.row('Chemistry Lab')).toBeVisible()
    await mobile.home.search.fill('zzz')
    await expect(mobile.home.rows).toHaveCount(0)
    await expect(mobile.home.noMatch('zzz')).toBeVisible()
    await mobile.home.clearSearch.click()
    await expect(mobile.home.search).toHaveValue('')
    await expect(mobile.home.rows).toHaveCount(3)
    await expect(mobile.home.heading).toHaveText('Projects (3)')
    // Searching never touches the data.
    expect((await projects(page)).map((p) => p.name).sort()).toEqual(['Biology Notes', 'Chemistry Lab', 'History Essay'])
  })

  test('REG-803 Rename from a row\'s ⋯ menu saves on Enter and Escape keeps the old name', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await createOnPhone(app, mobile, ['Old Name'])
    const [before] = await projects(page)
    await expect(mobile.home.actions('Old Name')).toBeVisible()
    await mobile.home.actions('Old Name').click()
    // Signed out, sharing is not offered: the menu holds Rename, Download and Delete only.
    await expect(mobile.home.row('Old Name').getByRole('button', { name: /^(Rename|Share|Download|Delete)$/ })).toHaveText(['Rename', 'Download', 'Delete'])
    await mobile.home.menuItem('Rename').click()
    await expect(mobile.home.renameInput).toHaveValue('Old Name')
    await expect(mobile.home.renameInput).toBeFocused()
    await mobile.home.renameInput.fill('  New Name  ')
    await mobile.home.renameInput.press('Enter')
    await expect(mobile.home.row('New Name')).toBeVisible()
    await expect.poll(async () => (await projects(page))[0].name).toBe('New Name')
    const [renamed] = await projects(page)
    expect(renamed.id).toBe(before.id)
    expect(renamed.updatedAt).toBeGreaterThan(before.updatedAt)

    await mobile.home.rowAction('New Name', 'Rename')
    await mobile.home.renameInput.fill('Thrown Away')
    await mobile.home.renameInput.press('Escape')
    await expect(mobile.home.row('New Name')).toBeVisible()
    await expect(mobile.home.renameInput).toHaveCount(0)
    expect((await projects(page))[0]).toMatchObject({ name: 'New Name', updatedAt: renamed.updatedAt })
  })

  test('REG-804 renaming a row to a name with symbols explains why, like the desktop card, instead of silently keeping the old name', { tag: '@P3' }, async ({ signedIn: app, mobile, page }) => {
    knownDefect('DEF-801')
    await createOnPhone(app, mobile, ['Plain Name'])
    await mobile.home.rowAction('Plain Name', 'Rename')
    await mobile.home.renameInput.fill('Bad/Name')
    await mobile.home.renameInput.press('Enter')
    expect((await projects(page))[0].name).toBe('Plain Name')
    // The desktop card (ProjectCard.tsx) keeps the field open with this message under it.
    await expect(mobile.home.renameInput).toHaveValue('Bad/Name')
    await expect(mobile.home.rows.getByRole('alert')).toHaveText('Only letters, numbers, and spaces are allowed')
  })

  test('REG-805 Delete from a row\'s ⋯ menu asks first: Cancel keeps the project, Delete removes only that one', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await createOnPhone(app, mobile, ['Keep Me', 'Remove Me'])
    await mobile.home.rowAction('Remove Me', 'Delete')
    const dialog = page.getByRole('dialog', { name: 'Delete Project' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expectStoreCount(page, 'projects', 2)

    await mobile.home.rowAction('Remove Me', 'Delete')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(mobile.home.row('Remove Me')).toHaveCount(0)
    await expect(mobile.home.heading).toHaveText('Projects (1)')
    await expect.poll(async () => (await projects(page)).map((p) => p.name)).toEqual(['Keep Me'])
  })

  test('REG-806 Download from a row\'s ⋯ menu saves a backup .zip of exactly that project', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await createOnPhone(app, mobile, ['Field Trip', 'Other Project'])
    const ids = Object.fromEntries((await projects(page)).map((p) => [p.name, p.id]))
    const downloading = page.waitForEvent('download')
    await mobile.home.rowAction('Field Trip', 'Download')
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/^Field_Trip_\d{4}-\d{2}-\d{2}_\d{1,2}-\d{2}-(am|pm)\.zip$/)
    const zip = BackupZip.fromFile(await download.path())
    expect(zip.manifest).toMatchObject({ appName: 'cognitive-canvas', type: 'single', projectIds: [ids['Field Trip']] })
    expect(zip.json<{ name: string }>('project.json').name).toBe('Field Trip')
    expect(JSON.stringify(Object.keys(zip.files))).not.toContain(ids['Other Project'])
  })

  test('REG-807 Select mode on the phone: tap rows to tick them, All / None follow the search, hidden ticks are counted, and Delete removes only the ticked projects', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await createOnPhone(app, mobile, ['Biology Notes', 'History Essay', 'Chemistry Lab'])
    await mobile.home.select.click()
    await expect(mobile.home.selectedCount).toHaveText('0 selected')
    await expect(mobile.home.bulkDelete).toBeDisabled()
    await expect(mobile.home.bulkShare).toHaveCount(0) // signed out: sharing is not offered
    await expect(page.getByRole('button', { name: 'Project actions' })).toHaveCount(0)

    await mobile.home.row('Biology Notes').click()
    await mobile.home.row('History Essay').click()
    await expect(mobile.home.selectedCount).toHaveText('2 selected')
    await mobile.home.all.click()
    await expect(mobile.home.selectedCount).toHaveText('3 selected')
    await mobile.home.none.click()
    await expect(mobile.home.selectedCount).toHaveText('0 selected')

    await mobile.home.row('Biology Notes').click()
    await mobile.home.row('History Essay').click()
    await mobile.home.search.fill('bio')
    await expect(mobile.home.selectedCount).toHaveText('2 selected (1 hidden)')
    await mobile.home.bulkDelete.click()
    const dialog = page.getByRole('dialog', { name: 'Delete 2 Projects' })
    await expect(dialog).toContainText('This will permanently delete 2 projects and all their contents.')
    await expect(dialog).toContainText('Biology Notes')
    await expect(dialog).toContainText('History Essay')
    await dialog.getByRole('button', { name: 'Delete 2', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await projects(page)).map((p) => p.name)).toEqual(['Chemistry Lab'])

    await mobile.home.clearSearch.click()
    await expect(mobile.home.rows).toHaveCount(1)
    await mobile.home.select.click()
    await mobile.home.cancelSelect.click()
    await expect(mobile.home.select).toBeVisible()
    await expect(mobile.home.actions('Chemistry Lab')).toBeVisible()
  })

  test('REG-808 tapping a row opens the project and moves it to the top of the list, by last opened', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await createOnPhone(app, mobile, ['First Made', 'Second Made'])
    await expect(mobile.home.rows.getByRole('heading')).toHaveText(['Second Made', 'First Made'])
    const before = Object.fromEntries((await projects(page)).map((p) => [p.name, p.lastOpenedAt]))
    await mobile.home.row('First Made').click()
    await app.documents.expectOpen('First Made')
    await app.documents.backToProjects.click()
    await expect(mobile.home.rows.getByRole('heading')).toHaveText(['First Made', 'Second Made'])
    const after = Object.fromEntries((await projects(page)).map((p) => [p.name, p.lastOpenedAt]))
    expect(after['First Made']).toBeGreaterThan(before['First Made'])
    expect(after['First Made']).toBeGreaterThan(after['Second Made'])
    expect(after['Second Made']).toBe(before['Second Made'])
  })

  test('REG-809 Upload on the phone home turns two PDFs into one new project, stays on the list and says "Uploaded 2 files"', { tag: '@P2' }, async ({ signedIn: _app, mobile, page }) => {
    const chooser = page.waitForEvent('filechooser')
    await mobile.home.upload.click()
    await (await chooser).setFiles([FIND_PDF.payload(), SECOND_PDF.payload()])
    await expect(mobile.home.status('Uploaded 2 files')).toBeVisible({ timeout: 45_000 })
    await expect(mobile.home.row('New Project 1')).toBeVisible()
    await expect(mobile.home.meta('New Project 1')).toContainText('2 docs')
    const [project] = await projects(page)
    expect(project.name).toBe('New Project 1')
    const docs = await readStore<{ name: string; projectId: string }>(page, 'documents')
    expect(docs.map((d) => [d.name, d.projectId]).sort()).toEqual([[FIND_PDF.displayName, project.id], [SECOND_PDF.displayName, project.id]].sort())
  })

  test('REG-810 the Catalog tab and the Catalog button open the catalog; Library comes back to the list', { tag: '@P2' }, async ({ signedIn: _app, mobile, page }) => {
    await mobile.nav.tab('Catalog').click()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    await expect(mobile.nav.tab('Catalog')).toHaveClass(/text-primary-600/)
    await expect(mobile.nav.tab('Library')).not.toHaveClass(/text-primary-600/)
    await mobile.nav.tab('Library').click()
    await expect(mobile.home.newName).toBeVisible()
    await expect(mobile.nav.tab('Library')).toHaveClass(/text-primary-600/)
    await mobile.home.catalog.click()
    await expect(page.getByText('Failed to load content')).toBeVisible()
    await expect(mobile.nav.tab('Catalog')).toHaveClass(/text-primary-600/)
  })

  test('REG-811 the Assistant tab (the phone\'s only way in) opens the Canvas Assistant full width, and it creates and opens a project', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, mobile, page }) => {
    const bot = new AssistantPanel(page)
    // The desktop edge tab is hidden below 768 px: the bottom bar is the door.
    await expect(bot.tab).toBeHidden()
    await mobile.nav.tab('Assistant').click()
    await expect(bot.panel).toBeVisible()
    await expect(bot.title).toBeVisible()
    const panel = await bot.panel.boundingBox()
    const width = page.viewportSize()!.width
    expect(panel!.x).toBeCloseTo(0, 0)
    expect(panel!.width).toBeCloseTo(width, 0)

    await bot.ask('create project Phone Notes')
    await expect(bot.last).toHaveText('Created project "Phone Notes" and opened it.')
    await app.documents.expectOpen('Phone Notes')
    await expect(mobile.nav.bar).toHaveCount(0) // the workspace has no bottom bar
    await expect.poll(async () => (await projects(page)).map((p) => p.name)).toEqual(['Phone Notes'])
  })
})

test.describe('Phone home in the Legal layout', { tag: ['@regression', '@mobile'] }, () => {
  test.beforeEach(async ({ page }) => {
    // The Legal layout is a stored setting (Settings › Appearance › Layout); seeded before boot.
    await page.addInitScript(() => localStorage.setItem('cc2_app_variant', 'law'))
  })

  test('REG-812 in the Legal layout the bottom bar and the Menu sheet carry Calendar, which opens the court diary where an entry is saved', { tag: '@P3' }, async ({ signedIn: _app, mobile, page }) => {
    await expect(mobile.nav.tabs).toHaveText(['Library', 'Catalog', 'Assistant', 'Calendar'])
    const calendar = new LawCalendarDialog(page)
    await mobile.nav.tab('Calendar').click()
    await expect(calendar.dialog).toBeVisible()
    await expect(calendar.hint).toBeVisible()
    await calendar.close.click()
    await expect(calendar.dialog).toBeHidden()

    await mobile.menu.choose('Calendar')
    await mobile.menu.expectClosed()
    await expect(calendar.dialog).toBeVisible()
    const now = new Date()
    const day = 15
    const label = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day)).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    await calendar.day(day).click()
    const editor = new LawDayDialog(page, label)
    await editor.addEntry({ title: 'Phone hearing' })
    await expectStoreCount(page, 'lawEvents', 1)
    const [entry] = await readStore<{ title: string; date: number; status: string }>(page, 'lawEvents')
    expect(entry).toMatchObject({ title: 'Phone hearing', status: 'pending', date: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day) })
  })
})
