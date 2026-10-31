/**
 * Page/component objects for the app shell that the shared objects in
 * pages/ and components/ do not cover: the guided-tour card, tutorial
 * player, language controls, Settings sections, System Check, quick search,
 * the projects screen's select mode, and the shell's banners and dialogs.
 *
 * Structural locators (no role, no product hook) are kept here with the
 * reason next to each one.
 */
import { expect, type Locator, type Page } from '@playwright/test'

/* ── Guided tour (GuidedTour.tsx) ────────────────────────────────────────── */

export interface Box { x: number; y: number; width: number; height: number }

export class TourCard {
  /** The tour card has no role or label: `.tour-tooltip` is the component's own class, the only stable hook. */
  readonly card: Locator
  /** The full-screen overlay the card lives in (portalled to <body>, z-250). */
  readonly overlay: Locator
  constructor(private readonly page: Page) {
    this.card = page.locator('.tour-tooltip')
    this.overlay = page.locator('div.fixed.inset-0', { has: page.locator('.tour-tooltip') })
  }

  get title() { return this.card.getByRole('heading', { level: 3 }) }
  get body() { return this.card.locator('p').first() }
  get counter() { return this.card.getByText(/^\d+ of \d+$/) }
  get next() { return this.card.getByRole('button', { name: 'Next', exact: true }) }
  get back() { return this.card.getByRole('button', { name: 'Back', exact: true }) }
  get finish() { return this.card.getByRole('button', { name: 'Finish', exact: true }) }
  get close() { return this.card.getByRole('button', { name: 'Close tour' }) }
  /** The "?" tour buttons on the document toolbar and the workspace palette (product hooks). */
  get docToolsEntry() { return this.page.locator('[data-tour="doc-tools-tour"]') }
  get wsToolsEntry() { return this.page.locator('[data-tour="ws-tools-tour"]') }

  async expectStep(n: number, total: number, title: string) {
    await expect(this.counter).toHaveText(`${n} of ${total}`)
    await expect(this.title).toHaveText(title)
  }

  /**
   * The highlight outlines drawn around the step's target(s): the stroked
   * <rect>s in the overlay's SVG (the mask's own rects are unstroked).
   * Each is the target's rect grown by 4 px on every side.
   */
  async highlights(): Promise<Box[]> {
    return this.overlay.locator('svg > rect[stroke]').evaluateAll((rects) =>
      rects.map((r) => ({
        x: Number(r.getAttribute('x')),
        y: Number(r.getAttribute('y')),
        width: Number(r.getAttribute('width')),
        height: Number(r.getAttribute('height')),
      })),
    )
  }

  /** Visible boxes of the elements a step targets (what GuidedTour measures). */
  async targetBoxes(selector: string, single = false): Promise<Box[]> {
    const boxes = await this.page.locator(selector).evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map((r) => ({ x: r.left, y: r.top, width: r.width, height: r.height })),
    )
    return single ? boxes.slice(0, 1) : boxes
  }
}

/* ── Tutorial video (TutorialVideoButton / TutorialVideoModal) ───────────── */

export class TutorialPlayer {
  constructor(private readonly page: Page) {}

  /** The header button of a screen: "Watch tutorial: <title>". */
  button(title: string) { return this.page.getByRole('button', { name: `Watch tutorial: ${title}`, exact: true }) }
  dialog(title: string) { return this.page.getByRole('dialog', { name: title, exact: true }) }
  frame(title: string) { return this.dialog(title).locator(`iframe[title="${title.replace(/"/g, '\\"')}"]`) }
  loading(title: string) { return this.dialog(title).getByText('Loading the video…') }
  failed(title: string) { return this.dialog(title).getByText("This video didn't load") }
  openOnYouTube(title: string) { return this.dialog(title).getByRole('link', { name: 'Open on YouTube' }) }
  /** Settings › Tutorials: group headings (h4) and the video buttons listed under them. */
  get libraryGroups() { return this.page.getByRole('heading', { level: 4 }) }
  get libraryEntries() { return this.page.locator('h4 ~ button') }
}

/* ── Language (LanguageMenuButton, Settings › Language, LanguageSuggestion) ─ */

export class LanguageMenu {
  constructor(private readonly page: Page) {}

  /**
   * Globe button on the PIN screens. Its accessible name is translated
   * ("Language: English", "Sprache: Deutsch"…), so it is found as the
   * screens' only menu button.
   */
  get button() { return this.page.locator('button[aria-haspopup="menu"]') }
  get menu() { return this.page.getByRole('menu') }
  option(nativeName: string) { return this.menu.getByRole('menuitemradio', { name: new RegExp(`^${nativeName}`) }) }
}

export class LanguageSettings {
  constructor(private readonly page: Page) {}

  /** Every choice is a toggle button (aria-pressed): "Device language" first, then one tile per language. */
  get choices() { return this.page.locator('button[aria-pressed]') }
  /** The choice currently in force (aria-pressed=true). */
  get selected() { return this.page.locator('button[aria-pressed="true"]') }
  get deviceLanguage() { return this.choices.first() }
  /** A language tile, found by its own (native) name. */
  tile(nativeName: string) { return this.choices.filter({ has: this.page.getByText(nativeName, { exact: true }) }) }
}

export class LanguageOffer {
  /** The suggestion is a role=dialog without a name; it is the only dialog marked aria-live. */
  readonly dialog: Locator
  constructor(page: Page) {
    this.dialog = page.locator('[role="dialog"][aria-live="polite"]')
  }
}

/* ── Settings sections ───────────────────────────────────────────────────── */

export class SettingsSections {
  constructor(private readonly page: Page) {}

  /** The left rail (desktop). */
  get rail() { return this.page.getByRole('navigation') }
  railTabs() { return this.rail.getByRole('button') }

  /** Appearance: a theme/style/accent tile, named by its title then description. */
  appearanceTile(name: string) { return this.page.getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}( |$)`) }) }
  layoutTile(name: 'Cognitive Canvas' | 'Cognitive Canvas Legal') {
    return this.page.getByRole('button', { name: new RegExp(`^${name} (Reading|Court)`) })
  }

  /** Permissions: the card for one permission (a bordered box with its name as the first paragraph). */
  permission(name: string) {
    return this.page.locator('div.rounded-lg.border').filter({ has: this.page.locator('p', { hasText: new RegExp(`^${name}$`) }) })
  }

  /** Plan: the card with "Your plan". */
  get planCard() { return this.page.locator('div.rounded-lg.border').filter({ hasText: 'Your plan' }) }
  planRow(label: string) { return this.page.locator('div.flex.items-center.gap-3.px-3.py-2').filter({ hasText: label }) }

  /** Shortcuts: the group heading and its rows (kbd + description). */
  shortcutGroup(title: string) { return this.page.locator('div').filter({ has: this.page.getByRole('heading', { name: title, exact: true, level: 3 }) }).last() }

  /** Shortcuts, as rendered: each h3 group title with its [keys, description] rows. */
  async shortcutTable(): Promise<{ title: string | null; rows: (string | null | undefined)[][] }[]> {
    return this.page.locator('h3').evaluateAll((hs) =>
      hs.map((h) => ({
        title: h.textContent,
        rows: [...(h.nextElementSibling?.children ?? [])].map((row) => [row.querySelector('kbd')?.textContent, row.querySelector('span')?.textContent]),
      })),
    )
  }

  /** Tool Guide detail page: one bordered card per tool, each with a numbered step list. */
  get guideCards() { return this.page.locator('div.rounded-lg.border', { has: this.page.locator('ol') }) }
  /** The (i) "Tool guide" button on the document toolbar (product hook). */
  get docToolbarGuide() { return this.page.locator('[data-tour="info-doc"]') }

  /** Tool Guide category card ("<title> <desc> <n> entries"). */
  guideCategory(title: string) { return this.page.getByRole('button', { name: new RegExp(`^${title} `) }) }
}

/* ── System Check (SystemCheckModal) ─────────────────────────────────────── */

export class SystemCheck {
  readonly dialog: Locator
  constructor(private readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'System Check' })
  }

  /** Row labels in order (each row: label paragraph + detail paragraph). */
  async rows(): Promise<[string, string][]> {
    return this.dialog.locator('div.flex.items-center.gap-3.py-1\\.5').evaluateAll((rows) =>
      rows.map((r) => {
        const ps = r.querySelectorAll('p')
        return [ps[0]?.textContent ?? '', ps[1]?.textContent ?? ''] as [string, string]
      }),
    )
  }

  /** The Build row is the developer-mode switch (five taps). */
  get buildRow() { return this.dialog.locator('div.flex.items-center.gap-3').filter({ has: this.page.getByText('Build', { exact: true }) }) }
}

/* ── Quick search (GlobalSearchModal) ────────────────────────────────────── */

export class QuickSearch {
  constructor(private readonly page: Page) {}

  get input() { return this.page.getByPlaceholder('Search documents, notes...') }
  /** The modal has no dialog role; its result rows are the buttons under the input's panel. */
  get panel() { return this.page.locator('div.relative.w-full.max-w-lg', { has: this.input }) }
  get results() { return this.panel.locator('div.overflow-y-auto > button') }
  result(title: string) { return this.results.filter({ has: this.page.getByText(title, { exact: true }) }) }
  get empty() { return this.panel.getByText(/^(No results found|Start typing to search)$/) }
  /** The highlighted row carries the selection tint class. */
  get selected() { return this.results.and(this.page.locator('.bg-primary-500\\/15')) }
}

/* ── Projects screen extras (select mode, rename, empty state) ───────────── */

export class ProjectsScreen {
  constructor(private readonly page: Page) {}

  get selectButton() { return this.page.getByRole('button', { name: 'Select', exact: true }) }
  get cancelSelect() { return this.page.getByRole('button', { name: 'Cancel', exact: true }) }
  /** Floating action bar shown in select mode (desktop): fixed, bottom-centre, no role. */
  get selectionBar() { return this.page.locator('div.fixed.bottom-4', { has: this.page.getByRole('button', { name: /^(Select all|Deselect all)$/ }) }) }
  get selectAll() { return this.selectionBar.getByRole('button', { name: 'Select all', exact: true }) }
  get deselectAll() { return this.selectionBar.getByRole('button', { name: 'Deselect all', exact: true }) }
  get deleteSelected() { return this.selectionBar.getByRole('button', { name: 'Delete', exact: true }) }
  /** "N selected" plus, when the search hides some, "(M hidden by search · clear all)": the bar's first span. */
  get selectedCount() { return this.selectionBar.locator('span').first() }
  get clearHidden() { return this.selectionBar.getByRole('button', { name: 'clear all' }) }
  get clearSearch() { return this.page.getByRole('button', { name: 'Clear search' }) }
  get createProjectCta() { return this.page.getByRole('button', { name: 'Create Project', exact: true }) }
  get emptyStateUpload() { return this.page.getByRole('button', { name: 'Upload', exact: true }) }
  /** In-flight catalog imports (PendingProjectCard): aria-disabled cards. */
  get pendingCards() { return this.page.locator('[aria-disabled="true"][aria-busy]') }

  bulkDialog(title: string | RegExp) { return this.page.getByRole('dialog', { name: title }) }
  /** Card rename input (ProjectCard swaps the title for a textbox). */
  renameInput(card: Locator) { return card.getByRole('textbox') }
  renameError(card: Locator) { return card.getByRole('alert') }
  /** A card's open ⋯ menu (a plain popover of buttons, no menu role). */
  cardMenu(card: Locator) { return card.locator('div.absolute.right-0.top-full') }
  /** The hover tip (HoverTip.tsx, portalled, role=tooltip). */
  get tooltip() { return this.page.getByRole('tooltip') }
}

/* ── Banners and dialogs owned by the shell ──────────────────────────────── */

export class ShellBanners {
  constructor(private readonly page: Page) {}

  /** ApiOfflineBanner: role=status with its title. */
  get apiOffline() { return this.page.getByRole('status').filter({ hasText: "Can't reach MuulOrigin" }) }
  /** ViewModeNotification (touch hardware only). */
  get viewMode() { return this.page.getByRole('status').filter({ hasText: /You're viewing in (desktop|mobile) view\./ }) }
  get viewModeDismiss() { return this.page.getByRole('button', { name: 'Dismiss view-mode notification' }) }
  /** InstallHintModal is a dialog without an accessible name; its heading identifies it. */
  get install() { return this.page.getByRole('dialog').filter({ has: this.page.getByRole('heading', { name: 'Install Cognitive Canvas' }) }) }
  get signOut() { return this.page.getByRole('dialog', { name: 'Sign out?' }) }
  get leave() { return this.page.getByRole('dialog', { name: 'Leave Cognitive Canvas?' }) }
  get switchLayout() { return this.page.getByRole('dialog', { name: 'Switch layout?' }) }
  /** EscHint is aria-hidden by design (a visual hint), so it is found by its text. */
  get escHint() { return this.page.getByText('to close', { exact: false }).filter({ has: this.page.locator('kbd', { hasText: 'Esc' }) }) }
}

/** Resize handles: drawn on a canvas note or image only while it is selected (WorkspaceCanvas.tsx). */
export function selectionHandles(item: Locator) {
  return item.locator('[data-resize-handle]')
}
