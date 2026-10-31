/**
 * Regression: the Canvas Assistant (components/ChatWidget.tsx). It runs fully
 * offline: a vendored deterministic engine (services/cc-bot/engine.js) reads
 * the compiled intents in cc2.compiled.json and calls the sockets in
 * services/cc-bot/sockets.ts. Supported intents: open catalog, class 9-12,
 * search the catalog, download an item, create / open / close a project, open
 * a subject. All are low risk, so no Yes/No confirmation is ever asked.
 * The catalog it browses is MOCKED (fixtures/content.ts).
 */
import { test, expect } from '../../fixtures/content.js'
import { AssistantPanel, ASSISTANT_GREETING, ASSISTANT_ABSTAIN } from '../../components/ContentAssistant.js'
import { CatalogScreen } from '../../pages/ContentCatalog.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { always, type CatalogEntry } from '../../helpers/mocks/contentCatalog.js'
import { CATALOG, CATALOG_ITEMS, PROJECT_NAME, singlePdfZip } from '../../data/content-files.js'

interface ProjectRow {
  id: string; userId: string; name: string; description: string; createdAt: number; updatedAt: number; lastOpenedAt: number
  thumbnailDataUrl: string | null; settings: unknown; catalogItemId?: string
}
const DOCK_KEY = 'cc2_bot_dock_v1'
/** A chapter whose title no other item shares. */
const CHAPTER_5: CatalogEntry = { id: 'e2e-c12-ch5', title: 'Chapter 5', description: 'Magnetism and matter', category: 'Class 12', subcategory: 'Physics', zipUrl: 'catalog-e2e/c12-physics-chapter-5.zip' }

test.describe('Canvas Assistant', { tag: ['@regression', '@assistant'] }, () => {
  test('REG-099 the assistant creates a project from a typed request and opens it', { tag: ['@P2', '@sanity'] }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await expect(bot.title).toBeVisible()
    await expect(bot.bubbles).toHaveText([ASSISTANT_GREETING])
    await bot.ask('create project Biology Notes')
    await expect(bot.bubbles).toHaveText([ASSISTANT_GREETING, 'create project Biology Notes', 'Created project "Biology Notes" and opened it.'])
    await app.documents.expectOpen('Biology Notes')

    const [user] = await readStore<{ id: string }>(page, 'users')
    const rows = await readStore<ProjectRow>(page, 'projects')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: user.id, name: 'Biology Notes', description: '', thumbnailDataUrl: null, settings: { noiseWords: [], includeWords: [] } })
    expect(rows[0].updatedAt).toBeGreaterThanOrEqual(rows[0].createdAt)
    expect(rows[0].lastOpenedAt).toBeGreaterThanOrEqual(rows[0].createdAt)
    // No Yes/No step for this low-risk intent.
    await expect(bot.choice('Yes')).toHaveCount(0)
    await expect(bot.panel).toBeVisible()
  })

  test('REG-740 asked to create a project without a name, it asks for one and uses the next message', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('create project')
    await expect(bot.last).toHaveText('Give me a project name.')
    expect(await readStore(page, 'projects')).toHaveLength(0)
    await bot.ask('Chemistry Lab')
    await expect(bot.last).toHaveText('Created project "Chemistry Lab" and opened it.')
    await app.documents.expectOpen('Chemistry Lab')
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.name)).toEqual(['Chemistry Lab'])
  })

  test('REG-741 the Create Project quick action asks for a name; inside a project it becomes Close Project, which returns Home', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await expect(bot.quickAction('Close Project')).toHaveCount(0)
    await bot.press(bot.quickAction('Create Project'))
    await expect(bot.bubbles.nth(1)).toHaveText('create project')
    await expect(bot.last).toHaveText('Give me a project name.')
    await bot.ask('Physics Lab')
    await app.documents.expectOpen('Physics Lab')

    await expect(bot.quickAction('Create Project')).toHaveCount(0)
    await bot.press(bot.quickAction('Close Project'))
    await expect(bot.last).toHaveText('Closed the project. You\'re back on the home screen.')
    await expect(app.home.newProjectName).toBeVisible()
    await expect(app.home.card('Physics Lab')).toBeVisible()
    await expect(bot.quickAction('Create Project')).toBeVisible()
    // Closing is navigation only.
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.name)).toEqual(['Physics Lab'])
  })

  test('REG-742 a project name the app does not allow is refused and nothing is created', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('create project')
    await bot.ask('Lab #1!')
    await expect(bot.last).toHaveText('Only letters, numbers, and spaces are allowed')
    await bot.ask(`create project ${'a'.repeat(101)}`)
    await expect(bot.last).toHaveText('Name is too long (max 100 characters)')
    await expect(app.home.newProjectName).toBeVisible()
    expect(await readStore(page, 'projects')).toHaveLength(0)
  })

  test('REG-743 "create a project called <name>" names the project <name>', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-701')
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('create a project called Lab Book')
    await expect(bot.last).toHaveText('Created project "Lab Book" and opened it.')
    await app.documents.expectOpen('Lab Book')
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.name)).toEqual(['Lab Book'])
  })

  test('REG-744 a request it does not understand gets the list of what it can do, and nothing changes', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('what is the weather like')
    await expect(bot.last).toHaveText(ASSISTANT_ABSTAIN)
    await expect(app.home.newProjectName).toBeVisible()
    await expect(new CatalogScreen(page).hero).toBeHidden()
    expect(await readStore(page, 'projects')).toHaveLength(0)
    // The input stays available for another try.
    await expect(bot.input).toBeEditable()
  })

  test('REG-745 Open Product Catalog opens the catalog and offers category, subject and item buttons that end in a download', { tag: '@P2' }, async ({ signedIn: _app, page, zips }) => {
    const bot = new AssistantPanel(page)
    const catalog = new CatalogScreen(page)
    await zips.serve(CATALOG.genetics.zipUrl, singlePdfZip('Inheritance', 'GENETICSMARKER'))
    await bot.open()
    await bot.press(bot.quickAction('Open Product Catalog'))
    await expect(bot.last).toHaveText('Product Catalog — pick a category:')
    await expect(catalog.hero).toBeVisible()
    for (const c of ['Class 11', 'Class 12', 'History', 'Science']) await expect(bot.choice(c)).toBeVisible()
    // While it waits for a button the free-text box is hidden.
    await expect(bot.input).toHaveCount(0)

    await bot.press(bot.choice('Science'))
    await expect(bot.bubbles.nth((await bot.bubbles.count()) - 2), 'the button label, not its internal value').toHaveText('Science')
    await expect(bot.last).toHaveText('Science — pick a subject:')
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science')

    await bot.press(bot.choice('Biology'))
    await expect(bot.last).toHaveText('Science → Biology — pick a chapter to download:')
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Science/Biology')
    await expect(bot.choice(CATALOG.cellBiology.title)).toBeVisible()

    await bot.press(bot.choice(CATALOG.genetics.title))
    await expect(bot.last).toHaveText(`Downloaded "${CATALOG.genetics.title}".`)
    await expectStoreCount(page, 'projects', 1)
    const [project] = await readStore<ProjectRow>(page, 'projects')
    expect(project).toMatchObject({ name: PROJECT_NAME.genetics, catalogItemId: CATALOG.genetics.id })
    await expect(catalog.downloadButton(CATALOG.genetics.title)).toHaveText('Downloaded')
    await expect(bot.input).toBeVisible()
  })

  test('REG-746 "class 11" opens the catalog on Class 11 and lists its subjects, and an unsupported class is refused', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    const bot = new AssistantPanel(page)
    const catalog = new CatalogScreen(page)
    await bot.open()
    await bot.ask('class 11')
    await expect(bot.last).toHaveText('Opening Class 11. Subjects available:\n• Physics (1 item)')
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Class 11')
    await expect(catalog.cardTitles).toHaveText(['Physics'])

    await bot.ask('class 8')
    await expect(bot.last).toHaveText('"8" isn\'t a supported class. Try 9, 10, 11, or 12.')
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Class 11')
  })

  test('REG-790 "class 12 physics" opens the chapters of that subject and says so', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    knownDefect('DEF-707')
    const bot = new AssistantPanel(page)
    const catalog = new CatalogScreen(page)
    await bot.open()
    await bot.ask('class 12 physics')
    // The catalog does go there...
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Class 12/Physics')
    await expect(catalog.itemTitles).toHaveText(['Chapter 2'])
    // ...and the reply should name the class, the subject and its chapters.
    await expect(bot.last).toHaveText('Opening Class 12 → Physics. Chapters:\n• Chapter 2')
  })

  test('REG-792 "open physics" offers the subject; it asks for a class when several have it, and opens the chapters once a class is chosen', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    const bot = new AssistantPanel(page)
    const catalog = new CatalogScreen(page)
    await bot.open()
    await bot.ask('open physics')
    await expect(bot.last).toHaveText('Did you mean to open the "physics" subject?')
    await bot.press(bot.choice('Open subject "Physics"'))
    await expect(bot.last).toHaveText('"Physics" is in multiple classes:\n• Class 11 (1 item)\n• Class 12 (1 item)\n• Science (1 item)\nSay "class 11 physics" or similar to narrow down.')

    await bot.ask('class 11')
    await bot.ask('open physics')
    await bot.press(bot.choice('Open subject "Physics"'))
    await expect(bot.last).toHaveText('Opening Class 11 → Physics. Chapters:\n• Chapter 2')
    await expect(catalog.breadcrumb).toHaveText('Product Catalog/Class 11/Physics')
    await expect(catalog.itemTitles).toHaveText(['Chapter 2'])
  })

  test('REG-747 "search the catalog for <words>" opens the catalog with the search filled in', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    const bot = new AssistantPanel(page)
    const catalog = new CatalogScreen(page)
    await bot.open()
    await bot.ask('search the catalog for genetics')
    await expect(bot.last).toHaveText('Opening the catalog and searching for "genetics".')
    await expect(catalog.search).toHaveValue('genetics')
    await expect(catalog.itemTitles).toHaveText([CATALOG.genetics.title])
  })

  test('REG-748 "download <title>" imports the item, and asking again says it is already in your projects', { tag: '@P2' }, async ({ signedIn: _app, page, zips }) => {
    const bot = new AssistantPanel(page)
    await zips.serve(CATALOG.genetics.zipUrl, singlePdfZip('Inheritance', 'GENETICSMARKER'))
    await bot.open()
    await bot.ask('download genetics basics')
    await expect(bot.last).toHaveText(`Downloaded "${CATALOG.genetics.title}".`)
    await expectStoreCount(page, 'projects', 1)
    await bot.ask('download genetics basics')
    await expect(bot.last).toHaveText(`"${CATALOG.genetics.title}" is already in your projects.`)
    expect(await readStore(page, 'projects')).toHaveLength(1)
    expect(zips.requests).toEqual([`/${CATALOG.genetics.zipUrl}`])

    await bot.ask('download zebra crossing manual')
    await expect(bot.last).toHaveText('Couldn\'t find "zebra crossing manual" in the catalog.')
  })

  test('REG-749 when two items share a title, the second offered button imports the second item', { tag: '@P3' }, async ({ signedIn: _app, page, zips }) => {
    knownDefect('DEF-704')
    const bot = new AssistantPanel(page)
    await zips.serve(CATALOG.class11Ch2.zipUrl, singlePdfZip('Units', 'CLASS11MARKER'))
    await zips.serve(CATALOG.class12Ch2.zipUrl, singlePdfZip('Potential', 'CLASS12MARKER'))
    await bot.open()
    await bot.ask('import chapter')
    await expect(bot.last).toHaveText('Multiple items match "chapter" — pick one to download:')
    const choices = bot.panel.getByRole('button', { name: 'Chapter 2', exact: true })
    await expect(choices).toHaveCount(2)
    await bot.press(choices.nth(1))
    await expectStoreCount(page, 'projects', 1)
    const [project] = await readStore<ProjectRow>(page, 'projects')
    // The two buttons look the same; the second must still mean the second item.
    expect(project.catalogItemId).toBe(CATALOG.class12Ch2.id)
  })

  test.describe('a uniquely titled chapter', () => {
    test.use({ catalog: always([...CATALOG_ITEMS, CHAPTER_5]) })

    test('REG-791 "download chapter 5" downloads the chapter of that name', { tag: '@P3' }, async ({ signedIn: _app, page, zips }) => {
      knownDefect('DEF-708')
      const bot = new AssistantPanel(page)
      await zips.serve(CHAPTER_5.zipUrl, singlePdfZip('Magnetism', 'CHAPTER5MARKER'))
      await bot.open()
      await bot.ask('download chapter 5')
      await expect(bot.last).toHaveText('Downloaded "Chapter 5".')
      await expectStoreCount(page, 'projects', 1)
      expect((await readStore<ProjectRow>(page, 'projects'))[0].catalogItemId).toBe(CHAPTER_5.id)
    })
  })

  test('REG-750 "open project <name>" opens it and moves its last-opened time; an unknown name is reported', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.home.createProject('Astronomy Log')
    await app.documents.expectOpen('Astronomy Log')
    await app.documents.backToProjects.click()
    await expect(app.home.card('Astronomy Log')).toBeVisible()
    const before = (await readStore<ProjectRow>(page, 'projects'))[0].lastOpenedAt

    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('open project zebra notes')
    await expect(bot.last).toHaveText('Couldn\'t find a project called "zebra notes".')
    await bot.ask('open project astronomy log')
    await expect(bot.last).toHaveText('Opened project "Astronomy Log".')
    await app.documents.expectOpen('Astronomy Log')
    await expect.poll(async () => (await readStore<ProjectRow>(page, 'projects'))[0].lastOpenedAt).toBeGreaterThan(before)
  })

  test('REG-751 "open <name>" without the word project asks whether the project was meant, and the button opens it', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    await app.home.createProject('Astronomy Log')
    await app.documents.expectOpen('Astronomy Log')
    await app.documents.backToProjects.click()
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('open astronomy log')
    await expect(bot.last).toHaveText('Did you mean to open the "astronomy log" project?')
    await expect(new CatalogScreen(page).hero).toBeHidden()
    await bot.press(bot.choice('Open project "Astronomy Log"'))
    await expect(bot.last).toHaveText('Opened project "Astronomy Log".')
    await app.documents.expectOpen('Astronomy Log')
  })

  test('REG-752 with no projects, "open project" and "close project" each explain why nothing happened', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('open project my notes')
    await expect(bot.last).toHaveText('No projects yet. Try "create project my notes" first.')
    await bot.ask('close project')
    await expect(bot.last).toHaveText('No project is currently open.')
    await expect(app.home.newProjectName).toBeVisible()
  })

  test('REG-753 Clear chat empties the conversation but keeps a pending question; Start new session forgets it', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('create project')
    await bot.menuButton.click()
    await bot.menuItem('Clear chat').click()
    await expect(bot.bubbles).toHaveText([ASSISTANT_GREETING])
    await expect(bot.menuItem('Clear chat')).toHaveCount(0)
    // The engine is still waiting for the name.
    await bot.ask('Kept Question')
    await expect(bot.last).toHaveText('Created project "Kept Question" and opened it.')
    await app.documents.expectOpen('Kept Question')

    await bot.ask('create project')
    await expect(bot.last).toHaveText('Give me a project name.')
    await bot.menuButton.click()
    await bot.menuItem('Start new session').click()
    await expect(bot.bubbles).toHaveText([ASSISTANT_GREETING])
    await bot.ask('Forgotten Question')
    await expect(bot.last).toHaveText(ASSISTANT_ABSTAIN)
    expect((await readStore<ProjectRow>(page, 'projects')).map((p) => p.name)).toEqual(['Kept Question'])
  })

  test('REG-754 closing and reopening keeps the conversation, and a reload starts a fresh one', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    await bot.open()
    await bot.ask('hello')
    await bot.close.click()
    await expect(bot.panel).toBeHidden()
    await expect(bot.tab).toBeVisible()
    await bot.open()
    await expect(bot.bubbles).toHaveText([ASSISTANT_GREETING, 'hello', ASSISTANT_ABSTAIN])
    await app.reload()
    // No projects yet, so the catalog opens again after the reload.
    await new CatalogScreen(page).expectSettled()
    await bot.open()
    await expect(bot.bubbles).toHaveText([ASSISTANT_GREETING])
  })

  test('REG-755 the assistant is offered on Home, the catalog and inside a project, but not on Settings or the PIN screen', { tag: '@P3' }, async ({ app, page }) => {
    const bot = new AssistantPanel(page)
    const catalog = new CatalogScreen(page)
    await app.open()
    await app.pinSetup.expectVisible()
    await expect(bot.tab).toHaveCount(0)
    await app.pinSetup.createPin()
    await catalog.expectSettled()
    await expect(bot.tab).toBeVisible()
    await app.home.reach()
    await expect(bot.tab).toBeVisible()
    await app.home.createProject('Assistant Places')
    await app.documents.expectOpen('Assistant Places')
    await expect(bot.tab).toBeVisible()
    await app.header.settings.click()
    await app.settings.expectOpen()
    await expect(bot.tab).toHaveCount(0)
    await expect(bot.panel).toHaveCount(0)
  })

  test('REG-756 the edge tab can be dragged to the left edge and stays there after a reload', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const bot = new AssistantPanel(page)
    const box = (await bot.tab.boundingBox())!
    expect(box.x + box.width, 'docked on the right edge by default').toBeGreaterThan(1300)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(600, 300, { steps: 8 })
    await page.mouse.move(80, 300, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), DOCK_KEY)) ?? '{}').edge).toBe('left')
    const dock = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), DOCK_KEY))!) as { y: number; edge: string }
    expect(dock.y).toBeCloseTo(300 / 800, 2)
    // A drag is not a click: the panel did not open.
    await expect(bot.panel).toHaveCount(0)

    await app.reload()
    await new CatalogScreen(page).expectSettled()
    await expect.poll(async () => (await bot.tab.boundingBox())?.x).toBe(0)
    await bot.open()
  })
})
