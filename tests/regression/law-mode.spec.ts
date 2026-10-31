/**
 * Regression: the Legal layout ("Cognitive Canvas Legal"), switched in
 * Settings › Appearance › Layout (stored in localStorage cc2_app_variant,
 * applied by a reload), and the document classification badge it adds.
 * Calendar and reminders: law-calendar.spec.ts.
 */
import { test, expect } from '../../fixtures/content.js'
import { LayoutSwitch, LawCalendarDialog, ClassificationChip, CLASSIFICATIONS, LAW_NAME, STANDARD_NAME } from '../../pages/ContentLaw.js'
import { readStore } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

interface DocRow { id: string; name: string; classification?: string; updatedAt: number }
/** The badge menu, in the order the app lists it. */
const MENU = ['Unclassified', 'Contract', 'Case File', 'Notice', 'Pleading', 'Discovery', 'Report', 'Other']
const docs = async (page: import('@playwright/test').Page) => readStore<DocRow>(page, 'documents')

/** Two documents, so the list stays open after the upload (one would open itself). */
async function twoDocuments(app: CognitiveCanvas) {
  await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
}

test.describe('Law mode layout', { tag: ['@regression', '@law'] }, () => {
  test('REG-110 switching to Cognitive Canvas Legal shows the calendar and classification badges and keeps the data', { tag: ['@P2', '@sanity'] }, async ({ project: _project, app, page }) => {
    const layout = new LayoutSwitch(page)
    const calendar = new LawCalendarDialog(page)
    await twoDocuments(app)
    // Standard layout: no calendar, no badges.
    await expect(layout.headerName).toContainText(STANDARD_NAME)
    await expect(layout.headerName).not.toContainText(LAW_NAME)
    await expect(calendar.openButton).toHaveCount(0)
    await expect(app.documents.card(FIND_PDF.displayName).getByRole('button', { name: 'Unclassified' })).toHaveCount(0)

    await layout.open()
    await expect(layout.notice).toHaveCount(0)
    await layout.law.click()
    await expect(layout.dialog).toContainText(`You're about to switch to ${LAW_NAME}. This changes the layout and the product name. Your projects, documents, and data are not affected, and you can switch back anytime from here.`)
    await Promise.all([page.waitForEvent('load'), layout.confirm.click()])

    expect(await layout.variant()).toBe('law')
    // The reload comes back on Settings › Appearance, now showing the notice.
    await expect(layout.notice).toBeVisible()
    await expect(layout.headerName).toContainText(LAW_NAME)
    await expect(calendar.openButton).toBeVisible()
    // Back in the project, every document carries a badge and nothing was lost.
    await app.settings.back.click()
    await expect(app.documents.cards).toHaveCount(2)
    for (const name of [FIND_PDF.displayName, SECOND_PDF.displayName]) {
      await expect(new ClassificationChip(app.documents.card(name)).badge).toHaveText('Unclassified')
    }
    expect(await docs(page)).toHaveLength(2)
  })

  test('REG-776 Cancel keeps the standard layout, Escape does not dismiss the warning, and the active layout cannot be re-picked', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    const layout = new LayoutSwitch(page)
    await layout.open()
    await page.evaluate(() => { (window as unknown as { __e2eNoReload: boolean }).__e2eNoReload = true })
    await layout.standard.click()
    await expect(layout.dialog).toHaveCount(0)

    await layout.law.click()
    await expect(layout.dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(layout.dialog).toBeVisible()
    await layout.cancel.click()
    await expect(layout.dialog).toBeHidden()
    expect(await layout.variant()).toBeNull()
    await expect(layout.notice).toHaveCount(0)
    await expect(layout.headerName).not.toContainText(LAW_NAME)
    expect(await page.evaluate(() => (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload), 'the page was not reloaded').toBe(true)
  })

  test.describe('in law mode', () => {
    test.use({ lawMode: true })

    test('REG-777 switching back to standard removes the calendar and badges but keeps the stored classifications', { tag: '@P2' }, async ({ project: _project, app, page }) => {
      const layout = new LayoutSwitch(page)
      await twoDocuments(app)
      const chip = new ClassificationChip(app.documents.card(FIND_PDF.displayName))
      // Keyboard path (the mouse path is REG-019).
      await chip.badge.press('Enter')
      await chip.option('Contract').press('Enter')
      await expect(chip.badge).toHaveText('Contract')

      await layout.open()
      await expect(layout.notice).toBeVisible()
      await layout.switchTo('standard')
      expect(await layout.variant()).toBe('standard')
      await expect(layout.headerName).not.toContainText(LAW_NAME)
      await expect(new LawCalendarDialog(page).openButton).toHaveCount(0)
      await expect(layout.notice).toHaveCount(0)
      await app.settings.back.click()
      await expect(app.documents.cards).toHaveCount(2)
      await expect(app.documents.card(FIND_PDF.displayName).getByRole('button', { name: 'Contract' })).toHaveCount(0)
      const find = (await docs(page)).find((d) => d.name === FIND_PDF.displayName)
      expect(find?.classification, 'the classification is kept for a later switch back').toBe('contract')
    })

    test('REG-019 a document\'s classification badge opens its menu and the choice is saved, without opening the document', { tag: '@P3' }, async ({ project: _project, app, page }) => {
      knownDefect('DEF-706')
      await twoDocuments(app)
      const chip = new ClassificationChip(app.documents.card(FIND_PDF.displayName))
      await chip.badge.click()
      await expect(chip.menu).toBeVisible()
      await expect(chip.options).toHaveText(MENU)
      await chip.option('Case File').click()
      await expect(chip.badge).toHaveText('Case File')
      // Still on the list: the click on the badge must not open the document.
      await expect(app.documents.cards).toHaveCount(2)
      const rows = await docs(page)
      expect(rows.find((d) => d.name === FIND_PDF.displayName)?.classification).toBe('case-file')
      expect(rows.find((d) => d.name === SECOND_PDF.displayName)?.classification).toBeUndefined()
    })

    test('REG-778 every classification can be chosen from the keyboard, is saved on the document and survives a reload', { tag: '@P3' }, async ({ project: _project, app, page }) => {
      await twoDocuments(app)
      const chip = new ClassificationChip(app.documents.card(FIND_PDF.displayName))
      await chip.badge.press('Enter')
      await expect(chip.options).toHaveText(MENU)
      // The chip toggles its menu.
      await chip.badge.press('Enter')
      await expect(chip.menu).toBeHidden()
      for (const c of CLASSIFICATIONS) {
        await chip.badge.press('Enter')
        await expect(chip.menu).toBeVisible()
        const before = (await docs(page)).find((d) => d.name === FIND_PDF.displayName)!
        await chip.option(c.label).press('Enter')
        await expect(chip.menu).toBeHidden()
        await expect(chip.badge).toHaveText(c.label)
        await expect.poll(async () => (await docs(page)).find((d) => d.name === FIND_PDF.displayName)?.classification, { message: c.label }).toBe(c.value)
        const after = (await docs(page)).find((d) => d.name === FIND_PDF.displayName)!
        expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
      }
      // The other document was never touched.
      expect((await docs(page)).find((d) => d.name === SECOND_PDF.displayName)?.classification).toBeUndefined()

      await chip.badge.press('Enter')
      await chip.option('Pleading').press('Enter')
      await expect.poll(async () => (await docs(page)).find((d) => d.name === FIND_PDF.displayName)?.classification).toBe('pleading')
      await app.reload()
      await expect(new ClassificationChip(app.documents.card(FIND_PDF.displayName)).badge).toHaveText('Pleading')
      await expect(new ClassificationChip(app.documents.card(SECOND_PDF.displayName)).badge).toHaveText('Unclassified')
    })
  })
})
