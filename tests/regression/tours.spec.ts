/**
 * Regression: the guided tours (GuidedTour.tsx, tours/tourSteps.ts).
 *
 * Six tours: project (Home), doclist (a project's document list), document
 * (the workspace), doc-tools and workspace-tools (the toolbars' own "?"
 * buttons) and linking (Settings › Tool Guide › Linking). Every step's title
 * and position are checked, and for a step with a target the highlight
 * outline must sit on that element: GuidedTour draws it 4 px outside the
 * target's box, so each edge is compared within 1.5 px (sub-pixel layout).
 * Tours never start on their own; the entry buttons pulse until first used,
 * and that is remembered in localStorage.
 */
import type { Page } from '@playwright/test'
import { test, expect, type Shell } from '../../fixtures/shell.js'
import { TOURS, type TourName, type TourStepFact } from '../../data/shell-files.js'
import { FIND_PDF } from '../../data/files.js'
import type { Box } from '../../pages/ShellPages.js'

const OUTLINE = 4
const TOLERANCE = 1.5

/** Assert the highlight outline(s) of the current step sit on `selector`'s visible element(s). */
async function expectHighlightOn(shell: Shell, selector: string, single = false) {
  await expect
    .poll(async () => {
      const [want, got] = await Promise.all([shell.tour.targetBoxes(selector, single), shell.tour.highlights()])
      if (want.length === 0) return `no visible element matches ${selector}`
      if (got.length !== want.length) return `${got.length} outlines for ${want.length} targets`
      const off = want.map((w: Box, i) => {
        const g = got[i]
        return Math.max(Math.abs(g.x - (w.x - OUTLINE)), Math.abs(g.y - (w.y - OUTLINE)), Math.abs(g.width - (w.width + 2 * OUTLINE)), Math.abs(g.height - (w.height + 2 * OUTLINE)))
      })
      return off.every((d) => d <= TOLERANCE) ? 'on target' : `outline off its target by ${Math.max(...off).toFixed(1)} px`
    }, { message: `highlight for ${selector}` })
    .toBe('on target')
}

/** Walk a tour from its first step to Finish, checking every step. */
async function walkTour(shell: Shell, name: TourName) {
  const steps: TourStepFact[] = TOURS[name]
  for (const [i, step] of steps.entries()) {
    await shell.tour.expectStep(i + 1, steps.length, step.title)
    if (i === 0) await expect(shell.tour.back).toBeHidden()
    else await expect(shell.tour.back).toBeVisible()
    if (step.target) await expectHighlightOn(shell, step.target, step.single)
    else await expect.poll(() => shell.tour.highlights(), { message: `step "${step.title}" is a centred card` }).toEqual([])
    if (i < steps.length - 1) {
      await expect(shell.tour.finish).toBeHidden()
      await shell.tour.next.click()
    }
  }
  await shell.tour.finish.click()
  await expect(shell.tour.card).toBeHidden()
}

async function tourStorage(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('cc2_tour_')).map((k) => [k, localStorage.getItem(k)])))
}

test.describe('Guided tours', { tag: ['@regression', '@tours'] }, () => {
  test('REG-098 the Home tour walks all six steps with Next and Back, points at each part, and Finish closes it', { tag: ['@P2', '@sanity'] }, async ({ signedIn: app, shell, page }) => {
    await app.header.guidedTour.click()
    await shell.tour.expectStep(1, 6, 'Welcome to Cognitive Canvas')
    await expect(shell.tour.body).toHaveText('This is your project hub. Create projects, upload documents, browse the content catalog, and manage backups — all from here.')
    // An empty library still has a card to point at: the tour's own "Sample Project".
    await expect(page.getByText('Sample Project', { exact: true })).toBeVisible()
    await shell.tour.next.click()
    await shell.tour.expectStep(2, 6, 'Create a Project')
    await shell.tour.back.click()
    await shell.tour.expectStep(1, 6, 'Welcome to Cognitive Canvas')
    await walkTour(shell, 'project')
    await expect(page.getByText('Sample Project', { exact: true })).toBeHidden()
    await expect(app.home.emptyState).toBeVisible()
  })

  test('REG-680 with real projects the Home tour boxes only the first project card', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    for (const name of ['Tour One', 'Tour Two']) {
      await app.home.createProject(name)
      await app.documents.backToProjects.click()
    }
    await app.header.guidedTour.click()
    // Each Next is a 200 ms card transition; a press inside it is not queued, so wait for the step.
    await shell.tour.next.click()
    await shell.tour.expectStep(2, 6, TOURS.project[1].title)
    await shell.tour.next.click()
    await shell.tour.expectStep(3, 6, 'Your Projects')
    await expectHighlightOn(shell, TOURS.project[2].target!, true)
    await expect(page.getByText('Sample Project', { exact: true })).toBeHidden()
    const [outline] = await shell.tour.highlights()
    const first = (await app.home.cards.first().boundingBox())!
    expect(Math.abs(outline.x - (first.x - OUTLINE))).toBeLessThanOrEqual(TOLERANCE)
  })

  test('REG-681 the document-list tour points at Upload and Scan together, the first card and quick search', { tag: '@P3' }, async ({ project: _p, app, shell }) => {
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.viewer.backToDocuments.click()
    await expect(app.documents.card(FIND_PDF.displayName)).toBeVisible()
    await app.header.guidedTour.click()
    await walkTour(shell, 'doclist')
  })

  test('REG-682 the workspace tour walks its eight steps over the header, both panes and the canvas controls', { tag: '@P2' }, async ({ pdfOpen: app, shell }) => {
    await app.header.guidedTour.click()
    await walkTour(shell, 'document')
  })

  test('REG-683 the document toolbar\'s tour button walks every document tool', { tag: '@P2' }, async ({ pdfOpen: _app, shell }) => {
    await shell.tour.docToolsEntry.click()
    await walkTour(shell, 'doc-tools')
  })

  test('REG-684 the workspace palette\'s tour button walks every workspace tool', { tag: '@P2' }, async ({ pdfOpen: _app, shell }) => {
    await shell.tour.wsToolsEntry.click()
    await walkTour(shell, 'workspace-tools')
  })

  test('REG-685 the linking tour opens from Settings › Tool Guide › Linking and leaves Settings', { tag: '@P3' }, async ({ signedIn: app, shell }) => {
    await app.header.settings.click()
    await app.settings.openTab('Tool Guide')
    await shell.sections.guideCategory('Linking & Connections').click()
    await app.page.getByRole('button', { name: 'Take the tour' }).click()
    await expect(app.settings.heading).toBeHidden()
    await walkTour(shell, 'linking')
  })

  test('REG-686 Enter goes forward, Backspace back, Escape ends the tour; × ends it too and a click beside the card does not', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.header.guidedTour.click()
    await shell.tour.expectStep(1, 6, TOURS.project[0].title)
    await page.keyboard.press('Enter')
    await shell.tour.expectStep(2, 6, TOURS.project[1].title)
    await page.keyboard.press('Enter')
    await shell.tour.expectStep(3, 6, TOURS.project[2].title)
    await page.keyboard.press('Backspace')
    await shell.tour.expectStep(2, 6, TOURS.project[1].title)
    // A press on the dimmed backdrop, away from the card, must not throw the tour away.
    await page.mouse.click(20, 780)
    await shell.tour.expectStep(2, 6, TOURS.project[1].title)
    await page.keyboard.press('Escape')
    await expect(shell.tour.card).toBeHidden()

    await app.header.guidedTour.click()
    await shell.tour.expectStep(1, 6, TOURS.project[0].title) // a new run starts again at step 1
    await shell.tour.next.click()
    await shell.tour.close.click()
    await expect(shell.tour.card).toBeHidden()
  })

  test('REG-687 the Tour button pressed on Settings or the Catalog leaves that screen and tours Home', { tag: '@P3' }, async ({ signedIn: app, shell }) => {
    await app.header.settings.click()
    await app.settings.expectOpen()
    await app.header.guidedTour.click()
    await expect(app.settings.heading).toBeHidden()
    await shell.tour.expectStep(1, 6, TOURS.project[0].title)
    await shell.tour.close.click()

    await app.header.exploreContent.click()
    await expect(app.page.getByText('Failed to load content')).toBeVisible()
    await app.header.guidedTour.click()
    await shell.tour.expectStep(1, 6, TOURS.project[0].title)
    await expect(app.page.getByText('Failed to load content')).toBeHidden()
    await shell.tour.next.click()
    await expectHighlightOn(shell, TOURS.project[1].target!)
  })

  test('REG-688 tours never start by themselves; the entry buttons pulse until first used and stay quiet after a reload', { tag: '@P2' }, async ({ pdfOpen: app, shell, page }) => {
    const docTour = shell.tour.docToolsEntry
    const wsTour = shell.tour.wsToolsEntry
    await expect(shell.tour.card).toBeHidden()
    for (const b of [app.header.guidedTour, docTour, wsTour]) await expect(b).toHaveClass(/tour-entry-pulse/)
    expect(await tourStorage(page)).toEqual({})

    await app.header.guidedTour.click()
    await shell.tour.close.click()
    await docTour.click()
    await shell.tour.close.click()
    await wsTour.click()
    await shell.tour.close.click()
    for (const b of [app.header.guidedTour, docTour, wsTour]) await expect(b).not.toHaveClass(/tour-entry-pulse/)
    expect(await tourStorage(page)).toEqual({ 'cc2_tour_global-tour_clicked': '1', 'cc2_tour_doc-tools_clicked': '1', 'cc2_tour_workspace-tools_clicked': '1' })

    await app.reload()
    await app.viewer.pageRendered(1)
    await expect(shell.tour.card).toBeHidden()
    for (const b of [app.header.guidedTour, docTour, wsTour]) await expect(b).not.toHaveClass(/tour-entry-pulse/)
  })
})
