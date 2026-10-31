/**
 * Keyboard-only use (WCAG 2.1.1 Keyboard, 2.4.3 Focus Order, 2.4.7 Focus
 * Visible, 2.1.2 No Keyboard Trap / modal focus containment).
 *
 * Every journey here is driven with Tab, Shift+Tab, Enter, Space and Escape
 * only: no mouse clicks after the fixture has booted the app. (A file
 * chooser is the operating system's own dialog; Playwright answers it for
 * the user, exactly as the keyboard-opened OS dialog would.)
 *
 * Freehand drawing (highlighter, pen, area drags) is path-based and exempt
 * from 2.1.1, so a tool is proved here through Find, which is fully
 * keyboard-driven.
 */
import { test, expect } from '../../fixtures/test.js'
import { knownDefect } from '../../helpers/defects.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { focusInfo, focusRing, ringVisible, tabTo } from '../../helpers/platformA11y.js'
import { StorageScreens } from '../../pages/BackupScreens.js'
import { FIND_PDF } from '../../data/files.js'
import type { Locator, Page } from '@playwright/test'

/** Press Tab `n` times and Shift+Tab `n` times; every stop must stay inside `dialog`. Returns where focus went outside, if anywhere. */
async function escapesFrom(page: Page, dialog: Locator, n = 20): Promise<string[]> {
  const outside: string[] = []
  for (const key of ['Tab', 'Shift+Tab'] as const) {
    for (let i = 0; i < n; i++) {
      await page.keyboard.press(key)
      const f = await focusInfo(page, dialog)
      if (!f.inside) outside.push(`${key} #${i + 1}: ${f.tag} "${f.label}"`)
    }
  }
  return outside
}

/**
 * The three things a modal owes a keyboard user: focus goes into it when it
 * opens, Tab and Shift+Tab stay inside it, and closing it returns focus to
 * the control that opened it.
 */
async function expectModalFocus(page: Page, opener: Locator, dialog: Locator, close: () => Promise<void>) {
  await expect(dialog).toBeVisible()
  await expect.poll(async () => (await focusInfo(page, dialog)).inside, { message: 'focus moved into the dialog' }).toBe(true)
  expect(await escapesFrom(page, dialog), 'Tab / Shift+Tab left the dialog').toEqual([])
  await close()
  await expect(dialog).toBeHidden()
  await expect(opener, 'focus came back to the control that opened the dialog').toBeFocused()
}

test.describe('Keyboard journeys', { tag: ['@regression', '@a11y'] }, () => {
  test('A11Y-038 a project can be created with the keyboard alone', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page }) => {
    await tabTo(page, app.home.newProjectName)
    await page.keyboard.type('Keyboard Project')
    await page.keyboard.press('Enter')
    await app.documents.expectOpen('Keyboard Project')
    expect((await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual(['Keyboard Project'])
  })

  test('A11Y-039 a project on Home can be opened with the keyboard alone', { tag: '@P1' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-906')
    await app.home.createProject('Open Me')
    await app.documents.backToProjects.click()
    const card = app.home.card('Open Me')
    await expect(card).toBeVisible()
    // Tab until focus lands on the card itself or a control in it that opens it (its menu button does not).
    let reached = false
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab')
      const f = await focusInfo(page, card)
      reached = f.inside && f.label !== 'More actions'
    }
    expect(reached, 'Tab reaches the project card').toBe(true)
    await page.keyboard.press('Enter')
    await app.documents.expectOpen('Open Me')
  })

  test('A11Y-040 a PDF can be uploaded into a project with the keyboard alone, and it opens', { tag: '@P1' }, async ({ project: _p, app, page }) => {
    await tabTo(page, app.documents.upload)
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    await (await chooser).setFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expectStoreCount(page, 'documents', 1)
  })

  test('A11Y-041 a document on the project\'s list can be opened with the keyboard alone', { tag: '@P1' }, async ({ pdfOpen: app, page }) => {
    knownDefect('DEF-906')
    await tabTo(page, app.viewer.backToDocuments)
    await page.keyboard.press('Enter')
    const card = app.documents.card(FIND_PDF.displayName)
    await expect(card).toBeVisible()
    let reached = false
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab')
      const f = await focusInfo(page, card)
      reached = f.inside && f.label !== 'Delete document'
    }
    expect(reached, 'Tab reaches the document card').toBe(true)
    await page.keyboard.press('Enter')
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
  })

  test('A11Y-042 Find is used with the keyboard alone: open it, type, step through matches, close it', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    await tabTo(page, app.viewer.tool('find'))
    await page.keyboard.press('Enter')
    await expect(app.find.input).toBeFocused()
    await page.keyboard.type('canvas')
    await app.find.expectCount(1, FIND_PDF.canvasMatches)
    await page.keyboard.press('Enter')
    await app.find.expectCount(2, FIND_PDF.canvasMatches)
    await page.keyboard.press('Shift+Enter')
    await app.find.expectCount(1, FIND_PDF.canvasMatches)
    await page.keyboard.press('Escape')
    await expect(app.find.input).toBeHidden()
  })

  test('A11Y-043 the document and canvas tool buttons tell assistive technology which tool is switched on', { tag: '@P2' }, async ({ pdfOpen: app, page }) => {
    knownDefect('DEF-907')
    await tabTo(page, app.viewer.tool('highlight'))
    await page.keyboard.press('Enter')
    await expect(app.viewer.tool('highlight')).toHaveAttribute('aria-pressed', 'true')
    await tabTo(page, app.canvas.tool('note'))
    await page.keyboard.press('Enter')
    await expect(app.canvas.tool('note')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('Dialogs and focus', { tag: ['@regression', '@a11y'] }, () => {
  test('A11Y-044 the Storage dialog takes focus, keeps Tab inside, and gives focus back to the storage chip when closed', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const storage = new StorageScreens(page)
    await tabTo(page, app.header.storage)
    await page.keyboard.press('Enter')
    await expectModalFocus(page, app.header.storage, storage.dialog, () => page.keyboard.press('Escape'))
  })

  test('A11Y-045 the Delete Project confirmation takes focus, keeps Tab inside, and gives focus back when cancelled', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-915')
    await app.home.createProject('Keep Me')
    await app.documents.backToProjects.click()
    const more = app.home.card('Keep Me').getByRole('button', { name: 'More actions' })
    await tabTo(page, more)
    await page.keyboard.press('Enter')
    const del = page.getByRole('button', { name: 'Delete', exact: true })
    await tabTo(page, del)
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Delete Project' })
    await expectModalFocus(page, more, dialog, () => page.keyboard.press('Escape'))
    expect((await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual(['Keep Me'])
  })

  test('A11Y-046 the Change PIN dialog takes focus, keeps Tab inside, and gives focus back to the profile button when cancelled', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    knownDefect('DEF-915')
    await tabTo(page, app.header.profile)
    await page.keyboard.press('Enter')
    await expect(app.profileMenu.menu).toBeVisible()
    await tabTo(page, app.profileMenu.item('Change PIN'))
    await page.keyboard.press('Enter')
    // Change PIN is a persistent dialog (Escape is ignored on purpose, so a half-typed PIN is not lost): close it with Cancel.
    await expectModalFocus(page, app.header.profile, app.changePin.dialog, async () => {
      await tabTo(page, app.changePin.dialog.getByRole('button', { name: 'Cancel', exact: true }))
      await page.keyboard.press('Enter')
    })
  })

  test('A11Y-047 the Data Center takes focus, keeps Tab inside, and gives focus back to Backup & Restore when closed', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await tabTo(page, app.header.backupRestore)
    await page.keyboard.press('Enter')
    await expectModalFocus(page, app.header.backupRestore, app.dataCenter.dialog, async () => {
      await tabTo(page, app.dataCenter.close)
      await page.keyboard.press('Enter')
    })
  })

  test('A11Y-048 quick search takes focus on Ctrl+K and gives it back where it was when closed with Escape', { tag: '@P3' }, async ({ pdfOpen: app, page }) => {
    knownDefect('DEF-915')
    await tabTo(page, app.viewer.tool('find'))
    await page.keyboard.press('Control+k')
    const input = page.getByPlaceholder('Search documents, notes...')
    await expect(input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(input).toBeHidden()
    await expect(app.viewer.tool('find')).toBeFocused()
  })
})

test.describe('Visible focus', { tag: ['@regression', '@a11y'] }, () => {
  /** Tab through `stops` controls and list the ones whose focus has no visible ring (text fields excluded: caret + border by design, effects.css). */
  async function unringed(page: Page, stops: number): Promise<string[]> {
    const missing: string[] = []
    for (let i = 0; i < stops; i++) {
      await page.keyboard.press('Tab')
      const f = await focusInfo(page)
      if (f.tag === 'body' || ['input', 'textarea', 'select'].includes(f.tag)) continue
      if (!ringVisible(await focusRing(page))) missing.push(`${f.tag} "${f.label}"`)
    }
    return [...new Set(missing)]
  }

  test('A11Y-049 every control reached with Tab on Home shows a visible focus ring', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.home.createProject('Ringed Project')
    await app.documents.backToProjects.click()
    await expect(app.home.card('Ringed Project')).toBeVisible()
    expect(await unringed(page, 30)).toEqual([])
  })

  test('A11Y-050 every control reached with Tab in the workspace shows a visible focus ring', { tag: '@P2' }, async ({ pdfOpen: _app, page }) => {
    expect(await unringed(page, 45)).toEqual([])
  })
})
