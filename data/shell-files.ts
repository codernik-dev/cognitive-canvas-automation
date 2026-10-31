/**
 * Expected content for the app shell specs (tours, tutorials, shortcuts,
 * settings), copied from the source it describes so a test fails when the
 * product changes a step, a video or a shortcut without telling anyone.
 *
 *   tours       src/components/tours/tourSteps.ts (desktop wording/targets)
 *   tutorials   src/config/tutorialVideos.ts
 *   shortcuts   src/components/shared/settings/shortcutsData.ts (non-Mac: Ctrl)
 *   locales     src/i18n/locales.ts
 *
 * Only facts a test asserts live here; the strings are the English source
 * text (the catalogs are keyed by it, see helpers/shell.ts `tr`).
 */

export interface TourStepFact {
  title: string
  /** CSS selector the step highlights; null = centred card, no cutout. */
  target: string | null
  /** Only the first match is boxed (a list of cards). */
  single?: boolean
}

export const TOURS = {
  project: [
    { title: 'Welcome to Cognitive Canvas', target: null },
    { title: 'Create a Project', target: '[data-tour="project-create"]' },
    { title: 'Your Projects', target: '[data-tour="project-card"]', single: true },
    { title: 'Upload Files', target: '[data-tour="upload-card"]' },
    { title: 'Global Bar', target: '[data-tour="global-bar"]' },
    { title: "You're Ready!", target: null },
  ],
  doclist: [
    { title: 'Document Library', target: null },
    { title: 'Upload & Scan', target: '[data-tour="upload-btn"], [data-tour="scan-btn"]' },
    { title: 'Document Cards', target: '[data-tour="document-card"]', single: true },
    { title: 'Quick Search', target: '[data-tour="header-quicksearch"]' },
  ],
  document: [
    { title: 'Welcome to Your Workspace', target: null },
    { title: 'Header Bar', target: '[data-tour="header-bar"]' },
    { title: 'Document Pane', target: '[data-tour="doc-pane"]' },
    { title: 'Walk Through the Document Tools', target: '[data-tour="doc-tools-tour"]' },
    { title: 'Workspace Pane', target: '[data-tour="ws-pane"]' },
    { title: 'Walk Through the Workspace Tools', target: '[data-tour="ws-tools-tour"]' },
    { title: 'Canvas Controls', target: '[data-tour="canvas-controls"]' },
    { title: "You're All Set!", target: null },
  ],
  'doc-tools': [
    { title: 'Select Area', target: '[data-tool="select-area"]' },
    { title: 'Highlight', target: '[data-tool="highlight"]' },
    { title: 'Highlight Eraser', target: '[data-tool="highlight-eraser"]' },
    { title: 'Extract Image', target: '[data-tool="extract-image"]' },
    { title: 'Link Area', target: '[data-tool="link-area"]' },
    { title: 'OCR', target: '[data-tool="ocr"]' },
    { title: 'Link Document', target: '[data-tool="link-doc"]' },
    { title: 'Find in Document', target: '[data-tool="find"]' },
    { title: 'Pin / Unpin Toolbar', target: '[data-tour="toolbar-pin"]' },
    { title: 'Page Navigation', target: '[data-tour="page-nav"]' },
    { title: 'That covers the document tools', target: null },
  ],
  'workspace-tools': [
    { title: 'Pan / Select', target: '[data-ws-tool="pan"]' },
    { title: 'Note', target: '[data-ws-tool="note"]' },
    { title: 'Text', target: '[data-ws-tool="text"]' },
    { title: 'Pen / Ink', target: '[data-ws-tool="ink"]' },
    { title: 'Eraser', target: '[data-ws-tool="eraser"]' },
    { title: 'Line', target: '[data-ws-tool="line"]' },
    { title: 'Audio', target: '[data-ws-tool="audio"]' },
    { title: 'Video', target: '[data-ws-tool="video"]' },
    { title: 'Document', target: '[data-ws-tool="document"]' },
    { title: 'That covers the workspace tools', target: null },
  ],
  linking: [
    { title: 'Linking & Connections Tour', target: null },
    { title: 'Item-to-Item Links', target: null },
    { title: 'Area Links (Document → Workspace)', target: null },
    { title: 'Highlight-Stroke Links', target: null },
    { title: 'Hover to Reveal', target: null },
    { title: 'Click to Navigate', target: null },
    { title: 'Exiting Link Mode', target: null },
  ],
} satisfies Record<string, TourStepFact[]>

export type TourName = keyof typeof TOURS

export interface TutorialFact {
  /** Bold label in Settings › Tutorials. */
  label: string
  /** Player title and button tooltip. */
  title: string
  /** YouTube id; the player embeds https://www.youtube.com/embed/<id>. */
  youtubeId: string
}

export const TUTORIAL_LIBRARY: { group: string; entries: TutorialFact[] }[] = [
  {
    group: 'Getting started',
    entries: [
      { label: 'Setting up your PIN', title: 'Set up your private, local PIN (offline & per-device)', youtubeId: '7eZ9BAZnjvY' },
      { label: 'Home screen', title: 'Your home screen', youtubeId: 'V8ZHQZVoIOg' },
      { label: 'Top bar', title: 'The top bar explained: a quick header tour', youtubeId: 'FT6aTAshdnk' },
      { label: 'Content catalog', title: 'Explore the content catalog', youtubeId: 'nYxeKry6SsE' },
      { label: 'Appearance', title: 'Layouts, styles & accent colours', youtubeId: 'ALXat2IUm_w' },
      { label: 'Shortcuts', title: 'Keyboard, mouse & editing controls', youtubeId: 'oouO5YZ2TJs' },
      { label: 'Tool Guide', title: 'Step-by-step instructions for every tool', youtubeId: 'bOlwyTtpcHg' },
    ],
  },
  {
    group: 'Working with documents',
    entries: [
      { label: 'Document tools', title: 'PDF document tools: extract, highlight & OCR', youtubeId: 'pK9Yr2-LEeI' },
      { label: 'Linking', title: 'Link your documents and canvas items', youtubeId: 'EwqXfNwVwXI' },
    ],
  },
  {
    group: 'Backup & restore',
    entries: [
      { label: 'Local backup & restore', title: 'Export a backup to this device and restore it', youtubeId: 'qPQuxGv28ZU' },
      { label: 'Automatic local backup', title: 'Back up to this device on a schedule', youtubeId: 'yFZD-WsUbh0' },
      { label: 'Automatic cloud backup', title: 'Keep your projects backed up in the cloud', youtubeId: '_o8cywMRF-M' },
      { label: 'Restore from cloud', title: 'Complete cloud restore guide', youtubeId: '0YZqYfLmrUg' },
      { label: 'GitHub backup & restore', title: 'Save and recover project versions on GitHub', youtubeId: 'zONdGYwHJKk' },
      { label: 'Automatic GitHub backup', title: 'Schedule automatic GitHub backups', youtubeId: 'ssaqqSajhhI' },
      { label: 'Restore from GitHub', title: 'Recover projects from your GitHub repository', youtubeId: 'Fj88aS9R05w' },
    ],
  },
]

/** The per-screen header videos (TUTORIAL_VIDEOS). */
export const SCREEN_TUTORIALS = {
  pin: TUTORIAL_LIBRARY[0].entries[0],
  home: TUTORIAL_LIBRARY[0].entries[1],
  catalog: TUTORIAL_LIBRARY[0].entries[3],
  workspace: TUTORIAL_LIBRARY[1].entries[0],
}

/** The URL the player loads for a tutorial (TutorialVideoModal: toEmbedUrl + player params). */
export const embedSrc = (id: string) => `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`

/** Settings › Shortcuts, as rendered on a non-Mac (MOD = Ctrl). */
export const SHORTCUT_GROUPS: { title: string; rows: [keys: string, description: string][] }[] = [
  {
    title: 'Global',
    rows: [
      ['Ctrl+K', 'Open quick search (documents, notes)'],
      ['Ctrl+F', 'Open find bar in document'],
      ['Escape', 'Close any open modal, panel, or cancel current action'],
    ],
  },
  {
    title: 'Document Pane',
    rows: [
      ['Scroll', 'Scroll through pages'],
      ['Ctrl+F', 'Search text within document'],
      ['Enter', 'Next find match'],
      ['Shift+Enter', 'Previous find match'],
      ['Escape', 'Deactivate current tool / close find bar'],
    ],
  },
  {
    title: 'Workspace Canvas',
    rows: [
      ['Scroll wheel', 'Zoom in / out'],
      ['Ctrl+Scroll / trackpad pinch', 'Fine zoom'],
      ['Shift+Scroll', 'Pan sideways'],
      ['Drag empty canvas', 'Pan canvas (Pan tool)'],
      ['Middle-click + Drag', 'Pan canvas (any tool)'],
      ['Right-click', 'Context menu: duplicate, order, align, select all, reset view'],
      ['Shift / Ctrl + Drag empty canvas', 'Box-select several items'],
      ['Delete', 'Delete selected items'],
      ['Ctrl+A', 'Select all items'],
      ['Ctrl+D', 'Duplicate selection'],
      ['Shift+Click item, then click another', 'Link two items (Shift only on the first)'],
      ['Escape', 'Cancel pending link'],
    ],
  },
  {
    title: 'Document Tools',
    rows: [
      ['Highlight tool', 'Draw freehand highlights on the PDF (highlighter or pen tip)'],
      ['Highlight eraser', 'Erase parts of highlights'],
      ['Select Area', 'Draw a rectangle to pull its text into a linked note'],
      ['Extract Image', 'Draw a rectangle to put that region on the workspace as an image'],
      ['Link Area', 'Draw an area on the PDF to link to the selected workspace item'],
      ['OCR', 'Read scanned pages so Find can search them'],
      ['Click a highlight (Highlight tool off)', 'It pulses; pen strokes you draw next link to it'],
    ],
  },
  {
    title: 'Workspace Tools',
    rows: [
      ['Pan tool (default)', 'Click items to select, drag to move, click empty to deselect'],
      ['Note tool', 'Click canvas to place a sticky note'],
      ['Text tool', 'Click canvas to place a text box'],
      ['Ink tool', 'Draw freehand on canvas'],
      ['Eraser tool', 'Erase pen strokes by dragging over them'],
      ['Line tool', 'Click and drag to draw straight lines'],
      ['Audio tool', 'Upload, record, or link an audio note'],
      ['Video tool', 'Upload, record, or link a video note'],
      ['Document tool', 'Embed a link to another document in the project'],
    ],
  },
  {
    title: 'Editing Items',
    rows: [
      ['Double-click note', 'Open note editor'],
      ['Double-click image', 'Open image editor (rotate, crop, adjust, etc.)'],
      ['Double-click text', 'Edit text content'],
      ['Drag item edges', 'Resize notes and images'],
      ['Drag line endpoints', 'Reposition line tool endpoints'],
    ],
  },
  {
    title: 'Linking & Connections',
    rows: [
      ['Shift+Click, then click', 'Item-to-item link: Shift+click the first item, plain click the second (or use the item’s Link button)'],
      ['Click highlight + draw', 'With the Highlight tool off, click a highlight, then draw with the pen on the workspace — auto-links them'],
      ['Hover linked highlight/stroke', 'Shows bridge line across panes + glow effect'],
      ['Click linked highlight', 'Navigate workspace to connected strokes'],
      ['Click linked strokes', 'Navigate document to connected highlight'],
      ['Note selected + hover image', 'Shows link button on excerpted image to connect note'],
    ],
  },
]

export type LocaleCode = 'en' | 'hi' | 'pa' | 'fr' | 'de' | 'ja'

export const LOCALES: { code: LocaleCode; nativeName: string; englishName: string; intl: string }[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', intl: 'en' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', intl: 'hi-IN' },
  { code: 'pa', nativeName: 'ਪੰਜਾਬੀ', englishName: 'Punjabi', intl: 'pa-IN' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', intl: 'fr' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', intl: 'de' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', intl: 'ja' },
]

/** Settings › Plan rows for a signed-out (Free) user: label, value, included (planSummary.ts + caps for Free). */
export const FREE_PLAN_ROWS: [label: string, value: string, included: boolean][] = [
  ['Catalog downloads', 'Unlimited', true],
  ['Receive shares and join live classes', 'Included', true],
  ['Send a copy', 'Not included', false],
  ['Live sharing and classes', 'Not included', false],
  ['Team members', 'Not included', false],
  ['Private notes', 'Not included', false],
  ['GitHub backup and restore', 'Not included', false],
  ['Scheduled backup', 'To a folder on this device', true],
  ['Cloud backup and sync', 'Not included', false],
  ['Support', 'Help panel and guide', true],
]

/** Typed text the language suggestion reacts to (scriptDetect.ts: 8+ letters of one script, at least half the letters). */
export const SCRIPT_SAMPLES = {
  hindi: 'नमस्ते दुनिया यह परीक्षण है',
  punjabi: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਦੁਨੀਆ ਪਰਖ',
  japanese: 'こんにちは世界のテストです',
  /** Kanji only: also Chinese, so no Japanese offer. */
  kanjiOnly: '漢字漢字漢字漢字漢字',
  /** One Hindi word inside an English sentence: under half the letters. */
  mostlyEnglish: 'This English sentence quotes नमस्ते दुनिया once and is otherwise plain English text',
}
