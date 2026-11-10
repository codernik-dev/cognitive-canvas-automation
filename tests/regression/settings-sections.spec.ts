/**
 * Regression: the Settings screen and its sections (SettingsPage.tsx,
 * settings/AppearanceSection, PermissionsSection, PlanSection (signed-out
 * view), ShortcutsSection, ToolGuide), System Check and developer tools.
 *
 * Language and Tutorials have their own specs. Support, Cloud Sync and Team
 * Members belong to the account/backup suites.
 */
import { test, expect } from '../../fixtures/shell.js'
import { FIND_PDF } from '../../data/files.js'
import { FREE_PLAN_ROWS, SHORTCUT_GROUPS } from '../../data/shell-files.js'
import { ACCENTS, STYLES } from '../../data/appearance.js'
import { blockedTo } from '../../helpers/shell.js'
import { guideCards, type GuideList } from '../../helpers/toolGuide.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

const SIGNED_OUT_TABS = ['Appearance', 'Language', 'Plan', 'Permissions', 'Shortcuts', 'Tool Guide', 'Support', 'Tutorials']

const htmlClasses = (page: import('@playwright/test').Page) => page.evaluate(() => [...document.documentElement.classList].filter((c) => /^(dark|style-theme-|color-theme-)/.test(c)).sort())
const storage = (page: import('@playwright/test').Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key)

test.describe('Settings screen', { tag: ['@regression', '@settings'] }, () => {
  test('REG-640 Settings opens on Permissions with the signed-out sections, keeps its tab over a reload, and Back leaves it', { tag: '@P2' }, async ({ signedIn: app, shell, page, context }) => {
    // A library with a project: an empty one reopens the Catalog after every reload (OBS-009).
    await app.home.createProject('Settings Project')
    await app.documents.backToProjects.click()
    await app.header.settings.click()
    await app.settings.expectOpen()
    await expect(shell.sections.railTabs()).toHaveText(SIGNED_OUT_TABS)
    await expect(page.getByText('Some features require browser permissions to work.', { exact: false })).toBeVisible()

    await app.settings.openTab('Shortcuts')
    await expect(page.getByRole('heading', { name: 'Global', exact: true })).toBeVisible()
    expect(await page.evaluate(() => [sessionStorage.getItem('cc2_show_settings'), sessionStorage.getItem('cc2_settings_tab')])).toEqual(['1', 'shortcuts'])
    await app.reload()
    await app.settings.expectOpen()
    await expect(page.getByRole('heading', { name: 'Global', exact: true })).toBeVisible()

    // Per tab: a new tab of the same profile does not inherit the open Settings screen.
    const other = new CognitiveCanvas(await context.newPage())
    await other.open()
    await expect(other.header.home).toBeVisible()
    await expect(other.settings.heading).toBeHidden()
    await other.page.close()

    await app.settings.back.click()
    await expect(app.settings.heading).toBeHidden()
    await expect(app.home.card('Settings Project')).toBeVisible()
  })
})

test.describe('Appearance', { tag: ['@regression', '@settings'] }, () => {
  test.beforeEach(async ({ signedIn: app }) => {
    await app.header.settings.click()
    await app.settings.openTab('Appearance')
  })

  test('REG-641 an accent colour applies to the whole app and survives a reload', { tag: '@P3' }, async ({ app, shell, page }) => {
    expect(await htmlClasses(page)).toEqual([])
    await shell.sections.appearanceTile('Ocean Depth').click()
    await expect.poll(() => htmlClasses(page)).toEqual(['color-theme-ocean-depth'])
    expect(await storage(page, 'cc-color-theme')).toBe('ocean-depth')
    await app.reload()
    await expect.poll(() => htmlClasses(page)).toEqual(['color-theme-ocean-depth'])
    await shell.sections.appearanceTile('Royal Purple (Default)').click()
    await expect.poll(() => htmlClasses(page)).toEqual([])
  })

  test('REG-642 a Style replaces the accent list with its own, its accent is applied and both survive a reload; Default undoes it', { tag: '@P3' }, async ({ app, shell, page }) => {
    await shell.sections.appearanceTile('Ocean Depth').click()
    await shell.sections.appearanceTile('Terminal').click()
    // A Style is a complete skin: the colour-theme class steps aside while it is on.
    await expect.poll(() => htmlClasses(page)).toEqual(['style-theme-terminal'])
    await expect(page.getByRole('heading', { name: 'Accent — tuned for Terminal' })).toBeVisible()
    for (const accent of ['Phosphor', 'Amber', 'Cyan', 'Magenta']) await expect(shell.sections.appearanceTile(accent)).toBeVisible()
    await expect(shell.sections.appearanceTile('Ocean Depth')).toBeHidden()

    await shell.sections.appearanceTile('Amber').click()
    const accentVar = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--color-primary-500'))
    await expect.poll(accentVar).toBe('#ffab1f')
    expect(JSON.parse((await storage(page, 'cc-style-accents'))!)).toEqual({ terminal: 'amber' })
    expect(await storage(page, 'cc-style-theme')).toBe('terminal')

    await app.reload()
    await expect.poll(() => htmlClasses(page)).toEqual(['style-theme-terminal'])
    await expect.poll(accentVar).toBe('#ffab1f')

    await shell.sections.appearanceTile('Default').click()
    await expect.poll(() => htmlClasses(page)).toEqual(['color-theme-ocean-depth'])
    await expect.poll(accentVar).toBe('')
    await expect(page.getByRole('heading', { name: 'Accent Color' })).toBeVisible()
  })

  test('REG-643 Mode System follows the device setting and Light ignores it', { tag: '@P3' }, async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await app.settings.mode('System').click()
    await expect.poll(() => app.settings.isDark()).toBe(true)
    expect(await storage(page, 'cc-theme')).toBe('system')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => app.settings.isDark()).toBe(false)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => app.settings.isDark()).toBe(true)
    await app.settings.mode('Light').click()
    await expect.poll(() => app.settings.isDark()).toBe(false)
  })

  test('REG-644 switching to the law layout asks first, Cancel changes nothing, Switch reloads into Cognitive Canvas Legal with its calendar', { tag: '@P2' }, async ({ app, shell, page }) => {
    await shell.sections.layoutTile('Cognitive Canvas Legal').click()
    await expect(shell.banners.switchLayout).toContainText("You're about to switch to Cognitive Canvas Legal. This changes the layout and the product name. Your projects, documents, and data are not affected, and you can switch back anytime from here.")
    await shell.banners.switchLayout.getByRole('button', { name: 'Cancel' }).click()
    await expect(shell.banners.switchLayout).toBeHidden()
    expect(await storage(page, 'cc2_app_variant')).toBeNull()
    await expect(page.getByText('Law mode is active', { exact: false })).toBeHidden()

    await shell.sections.layoutTile('Cognitive Canvas Legal').click()
    await Promise.all([page.waitForEvent('load'), shell.banners.switchLayout.getByRole('button', { name: 'Switch', exact: true }).click()])
    expect(await storage(page, 'cc2_app_variant')).toBe('law')
    await expect(page.getByText('Law mode is active — a global calendar and court-date reminders are enabled.')).toBeVisible()
    await expect(app.header.home).toHaveText('Cognitive Canvas Legal')
    await expect(page.getByRole('button', { name: 'Open calendar' })).toBeVisible()

    await shell.sections.layoutTile('Cognitive Canvas').click()
    await Promise.all([page.waitForEvent('load'), shell.banners.switchLayout.getByRole('button', { name: 'Switch', exact: true }).click()])
    await expect(app.header.home).toHaveText('Cognitive Canvas')
    await expect(page.getByRole('button', { name: 'Open calendar' })).toBeHidden()
  })

  test('REG-645 a theme picked in one tab is applied in the other tabs at once', { tag: '@P3' }, async ({ app, context }) => {
    const other = new CognitiveCanvas(await context.newPage())
    await other.open()
    await expect(other.header.home).toBeVisible()
    expect(await other.settings.isDark()).toBe(false)
    await app.settings.mode('Dark').click()
    await expect.poll(() => other.settings.isDark()).toBe(true)
    await app.settings.mode('Light').click()
    await expect.poll(() => other.settings.isDark()).toBe(false)
  })

  test('REG-947 every accent colour shows its name and description, themes the app when picked and is remembered; the default one clears it', { tag: '@P3' }, async ({ app, shell, page }) => {
    // The picked tile carries a check mark (the app has no other "selected" state on these tiles).
    const picked = (name: string) => shell.sections.appearanceTile(name).locator('polyline[points="20 6 9 17 4 12"]')
    const [byDefault, ...others] = ACCENTS
    await expect(page.getByRole('heading', { name: 'Accent Color' })).toBeVisible()
    for (const a of ACCENTS) await expect(shell.sections.appearanceTile(a.name), a.name).toContainText(a.description)
    await expect(picked(byDefault.name)).toHaveCount(1)

    for (const a of others) {
      await shell.sections.appearanceTile(a.name).click()
      await expect.poll(() => htmlClasses(page), { message: a.name }).toEqual([`color-theme-${a.id}`])
      expect(await storage(page, 'cc-color-theme'), a.name).toBe(a.id)
      await expect(picked(a.name), a.name).toHaveCount(1)
      await expect(picked(byDefault.name)).toHaveCount(0)
    }
    const last = others[others.length - 1]
    await app.reload()
    await expect.poll(() => htmlClasses(page)).toEqual([`color-theme-${last.id}`])
    await expect(picked(last.name)).toHaveCount(1)

    await shell.sections.appearanceTile(byDefault.name).click()
    await expect.poll(() => htmlClasses(page)).toEqual([])
    await expect(picked(byDefault.name)).toHaveCount(1)
  })

  test('REG-948 every Style shows its name and description and puts on its own skin with its own accents; each accent sets the app\'s primary shades; the choice is remembered, and Default brings the plain accents back', { tag: '@P3' }, async ({ app, shell, page }) => {
    const shades = () => page.evaluate(() => ['300', '400', '500', '600', '700'].map((s) => document.documentElement.style.getPropertyValue(`--color-primary-${s}`)))
    const themeClasses = async () => (await htmlClasses(page)).filter((c) => c !== 'dark')
    const picked = (name: string) => shell.sections.appearanceTile(name).locator('polyline[points="20 6 9 17 4 12"]')
    for (const s of STYLES) await expect(shell.sections.appearanceTile(s.name), s.name).toContainText(s.description)

    for (const s of STYLES.filter((x) => x.id !== 'default')) {
      await shell.sections.appearanceTile(s.name).click()
      await expect.poll(themeClasses, { message: s.name }).toEqual([`style-theme-${s.id}`])
      expect(await storage(page, 'cc-style-theme'), s.name).toBe(s.id)
      await expect(page.getByRole('heading', { name: `Accent — tuned for ${s.name}` })).toBeVisible()
      // The global accents step aside for the Style's own. Until one is picked the first is marked and the
      // Style's stylesheet supplies the colours (hooks/useTheme.ts: only an explicit pick is written inline).
      await expect(shell.sections.appearanceTile(ACCENTS[1].name)).toBeHidden()
      await expect(picked(s.accents[0].name), `${s.name}: its default accent is marked`).toHaveCount(1)
      await expect.poll(shades, { message: `${s.name}: nothing written inline before a pick` }).toEqual(['', '', '', '', ''])
      for (const a of s.accents) {
        await expect(shell.sections.appearanceTile(a.name), `${s.name} › ${a.name}`).toContainText(a.description)
        await shell.sections.appearanceTile(a.name).click()
        await expect.poll(shades, { message: `${s.name} › ${a.name}` }).toEqual(a.shades)
      }
      expect(JSON.parse((await storage(page, 'cc-style-accents'))!)[s.id], s.name).toBe(s.accents[s.accents.length - 1].id)
    }

    const last = STYLES[STYLES.length - 1]
    await app.reload()
    await expect.poll(themeClasses).toEqual([`style-theme-${last.id}`])
    await expect.poll(shades).toEqual(last.accents[last.accents.length - 1].shades)
    await shell.sections.appearanceTile('Default').click()
    await expect.poll(themeClasses).toEqual([])
    await expect.poll(shades).toEqual(['', '', '', '', ''])
    await expect(page.getByRole('heading', { name: 'Accent Color' })).toBeVisible()
  })
})

test.describe('Permissions', { tag: ['@regression', '@settings'] }, () => {
  test('REG-646 granted camera and microphone read Granted; a blocked clipboard explains how to enable it and turns Granted once allowed', { tag: '@P2' }, async ({ signedIn: app, shell, page, context }) => {
    await app.header.settings.click()
    await app.settings.openTab('Permissions')
    for (const name of ['Microphone', 'Camera']) await expect(shell.sections.permission(name)).toContainText('Granted')
    const clipboard = shell.sections.permission('Clipboard')
    await expect(clipboard).toContainText('Blocked')
    await clipboard.getByRole('button', { name: 'How to enable manually?' }).click()
    await expect(clipboard).toContainText('Go to browser Settings > Privacy & Security > Site Settings > Clipboard, and allow this site.')
    await clipboard.getByRole('button', { name: 'Hide guide' }).click()
    await expect(clipboard).not.toContainText('Go to browser Settings')

    // The user allows it in the browser, then presses Try Again.
    await context.grantPermissions(['camera', 'microphone', 'clipboard-read', 'clipboard-write'])
    await clipboard.getByRole('button', { name: 'Try Again' }).click()
    await expect(clipboard).toContainText('Granted')
    await expect(clipboard.getByRole('button')).toHaveCount(0)
    expect(JSON.parse((await storage(page, 'cc2_permission_grants_v1'))!)).toEqual({ microphone: true, camera: true, clipboard: true })
  })

  test('REG-647 Storage Usage counts the app\'s own data against the plan allowance', { tag: '@P3' }, async ({ project: _p, app, shell, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Permissions')
    await expect(page.getByText('0 B of 10.0 GB used (0%)')).toBeVisible()
    await expect(shell.sections.permission('Persistent Storage')).toContainText('Not requested')
    await expect(shell.sections.permission('Persistent Storage').getByRole('button', { name: 'Allow' })).toBeVisible()
    await app.settings.back.click()
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.header.settings.click()
    await app.settings.openTab('Permissions')
    await expect(page.getByText(/^[\d.]+ (B|KB) of 10\.0 GB used \(0%\)$/)).toBeVisible()
    await expect(page.getByText('0 B of 10.0 GB used (0%)')).toBeHidden()
  })
})

test.describe('Permissions the browser refused', { tag: ['@regression', '@settings'] }, () => {
  test.use({ permissions: [] })

  test('REG-648 a camera the browser refuses reads Blocked; allowed in the browser, Try Again turns it Granted and remembers it', { tag: '@P3' }, async ({ signedIn: app, shell, page, context }) => {
    await app.header.settings.click()
    await app.settings.openTab('Permissions')
    const camera = shell.sections.permission('Camera')
    await expect(camera).toContainText('Blocked')
    await camera.getByRole('button', { name: 'How to enable manually?' }).click()
    await expect(camera).toContainText('Go to browser Settings > Privacy & Security > Site Settings > Camera, and allow this site.')
    expect(JSON.parse((await storage(page, 'cc2_permission_grants_v1')) ?? '{}')).not.toHaveProperty('camera')

    await context.grantPermissions(['camera'])
    await camera.getByRole('button', { name: 'Try Again' }).click()
    await expect(camera).toContainText('Granted')
    expect(JSON.parse((await storage(page, 'cc2_permission_grants_v1'))!)).toMatchObject({ camera: true })
    await expect(shell.sections.permission('Microphone')).toContainText('Blocked') // only what was allowed changes
  })
})

test.describe('Plan (signed out)', { tag: ['@regression', '@settings'] }, () => {
  test('REG-649 a signed-out user sees the Free plan, what it includes, and See plans goes to the MuulOrigin pricing page', { tag: '@P2' }, async ({ signedIn: app, shell, page, blockedRequests }) => {
    await app.header.settings.click()
    await app.settings.openTab('Plan')
    await expect(shell.sections.planCard).toContainText('Your plan')
    await expect(shell.sections.planCard).toContainText('Free')
    await expect(shell.sections.planCard.getByRole('status')).toHaveText('Sign in to see and manage your plan.')
    await expect(page.getByRole('heading', { name: 'What Free includes' })).toBeVisible()
    for (const [label, value, included] of FREE_PLAN_ROWS) {
      await expect(shell.sections.planRow(label)).toHaveText(`${included ? '✓' : '–'}${label}${value}`)
    }
    await expect(page.getByText('Reading, annotating, OCR, scanning, the canvas, Timeline and the Assistant are free on every plan.')).toBeVisible()

    const nav = page.waitForRequest((r) => r.url().startsWith('https://www.muulorigin.com/products/'))
    await shell.sections.planCard.getByRole('button', { name: 'See plans' }).click()
    expect((await nav).url()).toBe('https://www.muulorigin.com/products/cognitive-canvas')
    expect(blockedTo(blockedRequests, 'www.muulorigin.com')).toContain('GET https://www.muulorigin.com/products/cognitive-canvas')
  })
})

test.describe('Shortcuts and Tool Guide', { tag: ['@regression', '@settings'] }, () => {
  test('REG-650 the Shortcuts tab lists every group and every key with its description', { tag: '@P3' }, async ({ signedIn: app, shell }) => {
    await app.header.settings.click()
    await app.settings.openTab('Shortcuts')
    const rendered = await shell.sections.shortcutTable()
    expect(rendered).toEqual(SHORTCUT_GROUPS.map((g) => ({ title: g.title, rows: g.rows })))
  })

  test('REG-651 the Tool Guide lists three categories with their entry counts, each opens its cards, Back returns', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Tool Guide')
    const sections = [
      { title: 'Document Tools', count: 11, first: 'Pan', last: 'Pin / Unpin Toolbar' },
      { title: 'Workspace Tools', count: 12, first: 'Pan / Select', last: 'Canvas Assistant' },
      { title: 'Linking & Connections', count: 5, first: 'Item-to-Item Links', last: 'Click to Navigate' },
    ]
    for (const s of sections) await expect(shell.sections.guideCategory(s.title)).toContainText(`${s.count} entries`)
    for (const s of sections) {
      await shell.sections.guideCategory(s.title).click()
      await expect(page.getByRole('heading', { name: s.title, level: 3 })).toBeVisible()
      // Each tool card has a numbered step list.
      const cards = shell.sections.guideCards
      await expect(cards).toHaveCount(s.count)
      await expect(cards.first()).toContainText(s.first)
      await expect(cards.last()).toContainText(s.last)
      await expect(page.getByRole('button', { name: 'Take the tour' })).toHaveCount(s.title === 'Linking & Connections' ? 1 : 0)
      await page.getByRole('button', { name: 'Back', exact: true }).last().click()
      await expect(shell.sections.guideCategory(s.title)).toBeVisible()
    }
  })

  test('REG-652 the document toolbar\'s (i) button opens the Tool Guide on Document Tools', { tag: '@P3' }, async ({ pdfOpen: app, shell, page }) => {
    await shell.sections.docToolbarGuide.click()
    await app.settings.expectOpen()
    await expect(page.getByRole('heading', { name: 'Document Tools', level: 3 })).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).first().click() // the screen's Back, not the guide's
    await app.viewer.pageRendered(1) // the document is still open behind Settings
  })

  test('REG-949 every Tool Guide card says exactly what the app\'s guide holds: its name, description, every step in order, its tip and the "Desktop & tablet" mark', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Tool Guide')
    const categories: [string, GuideList][] = [['Document Tools', 'DOC_TOOLS'], ['Workspace Tools', 'WS_TOOLS'], ['Linking & Connections', 'LINKING_TOOLS']]
    for (const [title, list] of categories) {
      const expected = guideCards(list)
      await shell.sections.guideCategory(title).click()
      await expect(page.getByRole('heading', { name: title, level: 3 })).toBeVisible()
      await expect(shell.sections.guideCards).toHaveCount(expected.length)
      // Each card (ToolGuide.tsx ToolCard): a header with the name (and the mark) and the description, a numbered step list, then an optional "Tip:" box.
      const shown = await shell.sections.guideCards.evaluateAll((cards) => cards.map((card) => {
        const [nameLine, descLine] = Array.from(card.children[0].querySelectorAll('p'))
        const tipBox = card.querySelector('ol + div')
        return {
          name: Array.from(nameLine.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim(),
          desc: (descLine?.textContent ?? '').trim(),
          steps: Array.from(card.querySelectorAll('ol > li')).map((li) => (li.children[1]?.textContent ?? '').trim()),
          tip: tipBox ? (tipBox.children[1]?.textContent ?? '').trim() : undefined,
          desktopOnly: nameLine.querySelector('span')?.textContent === 'Desktop & tablet',
        }
      }))
      expect(shown, title).toEqual(expected)
      await page.getByRole('button', { name: 'Back', exact: true }).last().click()
      await expect(shell.sections.guideCategory(title)).toBeVisible()
    }
  })

  test('REG-950 each Settings section explains itself: the layout switch and Styles, what every permission is for, and what the language setting changes and what stays in English', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Appearance')
    await expect(page.getByText('Switch between the standard experience and the law-focused layout.', { exact: true })).toBeVisible()
    await expect(shell.sections.layoutTile('Cognitive Canvas')).toContainText('Reading & note-taking')
    await expect(shell.sections.layoutTile('Cognitive Canvas Legal')).toContainText('Court diary & date reminders')
    await expect(page.getByText('A complete look — typography, shape and colours. A Style overrides Mode & Accent; pick its accent below.', { exact: true })).toBeVisible()

    await app.settings.openTab('Permissions')
    const purposes: [string, string][] = [
      ['Microphone', 'Required for recording audio notes.'],
      ['Camera', 'Required for recording video notes.'],
      ['Clipboard', 'Used for copy/paste operations with text content.'],
      ['Persistent Storage', 'Prevents the browser from automatically clearing your project data when storage is low.'],
    ]
    for (const [name, purpose] of purposes) await expect(shell.sections.permission(name), name).toContainText(purpose)

    await app.settings.openTab('Language')
    for (const text of [
      'The language of menus, buttons and messages. Your projects and notes are not changed.',
      'With Device language selected, the app also offers to switch when you type in Hindi, Punjabi or Japanese.',
      'Names of products and plans — Cognitive Canvas, MuulOrigin, Free, Economy, Pro — stay in English. Catalog content, shared items and messages from MuulOrigin appear as they were written.',
    ]) await expect(page.getByText(text, { exact: true })).toBeVisible()
  })
})

test.describe('System Check and developer tools', { tag: ['@regression', '@settings'] }, () => {
  test('REG-653 Diagnostics closes Settings and opens System Check with every row for this browser', { tag: '@P3' }, async ({ signedIn: app, shell }) => {
    await app.header.settings.click()
    await app.settings.diagnostics.click()
    await expect(shell.systemCheck.dialog).toBeVisible()
    await expect(app.settings.heading).toBeHidden()
    await expect.poll(() => shell.systemCheck.rows()).toEqual([
      ['Build', expect.stringMatching(/^[0-9a-f]{7}/)],
      ['Browser', 'Supported'],
      ['OCR engine', 'Available'],
      ['IndexedDB', 'Available'],
      ['Service Worker', 'Supported'],
      ['Storage', '0 KB / 10.00 GB (0%) — Not persistent'],
      ['Camera', 'Available'],
      ['Microphone', 'Available'],
      ['WebAssembly', 'Supported (OCR ready)'],
      ['Screen', '1366 x 800px'],
      ['Browser', 'Chrome — Recommended'],
    ])
    await shell.systemCheck.dialog.getByRole('button', { name: 'Close' }).last().click()
    await expect(shell.systemCheck.dialog).toBeHidden()
  })

  test('REG-654 five taps on Build turn the Developer console on, it captures and clears logs, five more hide it', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.header.settings.click()
    await app.settings.diagnostics.click()
    for (let i = 0; i < 4; i++) await shell.systemCheck.buildRow.click()
    expect(await storage(page, 'cc2_dev_mode')).toBeNull()
    await shell.systemCheck.buildRow.click()
    await app.toasts.expectShown('Developer tools enabled — see Settings → Developer')
    expect(await storage(page, 'cc2_dev_mode')).toBe('1')
    await shell.systemCheck.dialog.getByRole('button', { name: 'Close' }).last().click()

    await app.header.settings.click()
    await expect(shell.sections.railTabs()).toHaveText([...SIGNED_OUT_TABS.slice(0, 6), 'Developer', ...SIGNED_OUT_TABS.slice(6)])
    await shell.sections.rail.getByRole('button', { name: 'Developer' }).click()
    // Boot logs and the refused MuulOrigin requests are already captured.
    await expect(page.getByText('[auth-boot]', { exact: false }).first()).toBeVisible()
    await page.getByRole('button', { name: /^Network \d+$/ }).click()
    await expect(page.getByText(/GET FAILED https:\/\/api\.muulorigin\.com/).first()).toBeVisible()
    await expect(page.getByText('[auth-boot]', { exact: false })).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByText('Capturing console, errors and network… nothing yet.')).toBeVisible()

    await app.settings.diagnostics.click()
    for (let i = 0; i < 5; i++) await shell.systemCheck.buildRow.click()
    await app.toasts.expectShown('Developer tools hidden')
    expect(await storage(page, 'cc2_dev_mode')).toBeNull()
    await shell.systemCheck.dialog.getByRole('button', { name: 'Close' }).last().click()
    await app.header.settings.click()
    await expect(shell.sections.railTabs()).toHaveText(SIGNED_OUT_TABS)
  })

  test('REG-655 opening the app with ?dev=1 turns the Developer tab on and remembers it without the parameter', { tag: '@P3' }, async ({ signedIn: app, shell, page }) => {
    await app.open('/?dev=1')
    await app.header.settings.click()
    await expect(shell.sections.rail.getByRole('button', { name: 'Developer' })).toBeVisible()
    expect(await storage(page, 'cc2_dev_mode')).toBe('1')
    await app.open('/')
    await app.header.settings.click()
    await expect(shell.sections.rail.getByRole('button', { name: 'Developer' })).toBeVisible()
  })
})
