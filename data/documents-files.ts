/**
 * Test data for the documents area: scanned (image-only) PDFs whose words
 * are known, mixed text+scan PDFs, a PDF with bookmarks, gallery JPEGs and
 * text files at the size limits.
 *
 * Scanned pages are rasterised in the test's own browser (builders/rasterText.ts)
 * and wrapped in a PDF with NO text layer (builders/scannedPdf.ts), so each
 * builder here takes the Playwright page. The words OCR must find, and where
 * they were drawn, are written next to the bytes that produce them.
 *
 * Marker words are upper-case nonsense, so a match can only come from the
 * fixture, and are drawn large and bold on white so OCR has no excuse.
 */
import type { Page } from '@playwright/test'
import type { FilePayload } from './files.js'
import { buildTextPdf } from './builders/pdf.js'
import { buildMixedPdf, type MixedPageSpec } from './builders/scannedPdf.js'
import { rasterisePage, type RasterPageSpec, type WordBox } from './builders/rasterText.js'
import { buildUnicodeTextPdf } from './builders/unicodePdf.js'

export interface ScannedFixture {
  payload: FilePayload
  displayName: string
  pageCount: number
  /** Word boxes drawn on each page (index 0 = page 1); empty for text/blank pages. */
  boxes: WordBox[][]
}

/** Page 1 of the scanned fixture: two words on two lines, an empty corner, and a drawing. */
export const SCAN_PAGE_1: RasterPageSpec = {
  words: [
    { text: 'OCRALPHA', x: 0.1, y: 0.15 },
    { text: 'OCRBRAVO', x: 0.1, y: 0.3 },
  ],
  // A "picture" with no text in it: fills x 0.08-0.42, y 0.55-0.85 (the no-text region).
  shapes: [
    { kind: 'disc', x: 0.18, y: 0.66, size: 0.08, grey: 60 },
    { kind: 'box', x: 0.28, y: 0.58, size: 0.12, grey: 140 },
    { kind: 'disc', x: 0.33, y: 0.78, size: 0.06, grey: 100 },
  ],
}
export const SCAN_PAGE_2: RasterPageSpec = { words: [{ text: 'OCRCHARLIE', x: 0.15, y: 0.2 }] }

/** Regions (page fractions) the area-tool tests drag over on page 1 of SCANNED_PDF. */
export const SCAN_REGIONS = {
  /** Around OCRALPHA only. */
  alpha: [[0.06, 0.08], [0.6, 0.18]] as [[number, number], [number, number]],
  /** White paper, far from any ink. */
  blank: [[0.6, 0.62], [0.92, 0.9]] as [[number, number], [number, number]],
  /** The drawing: plenty of contrast, no letters. */
  picture: [[0.08, 0.56], [0.42, 0.86]] as [[number, number], [number, number]],
}

export const SCANNED_WORDS = { page1: ['OCRALPHA', 'OCRBRAVO'], page2: ['OCRCHARLIE'] } as const

/**
 * Three image-only pages: page 1 OCRALPHA + OCRBRAVO, page 2 OCRCHARLIE,
 * page 3 blank paper (OCR reads nothing: stored as text '' with words []).
 */
export async function scannedPdf(page: Page, name = 'automation-scanned'): Promise<ScannedFixture> {
  const p1 = await rasterisePage(page, SCAN_PAGE_1)
  const p2 = await rasterisePage(page, SCAN_PAGE_2)
  const p3 = await rasterisePage(page, {})
  const pages: MixedPageSpec[] = [p1, p2, p3].map((p) => ({ kind: 'image', jpeg: p.jpeg, width: p.width, height: p.height }))
  return {
    payload: { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: buildMixedPdf(pages, 'Scanned fixture') },
    displayName: name,
    pageCount: 3,
    boxes: [p1.boxes, p2.boxes, []],
  }
}

/** One image-only page holding a single word: the cheapest real OCR job. */
export async function oneWordScan(page: Page, word: string, name: string): Promise<ScannedFixture> {
  const p = await rasterisePage(page, { words: [{ text: word, x: 0.12, y: 0.2 }] })
  return {
    payload: { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: buildMixedPdf([{ kind: 'image', jpeg: p.jpeg, width: p.width, height: p.height }]) },
    displayName: name,
    pageCount: 1,
    boxes: [p.boxes],
  }
}

export const MIXED_TEXT_WORD = 'TEXTLAYERWORD'
export const MIXED_SCAN_WORD = 'OCRDELTA'

/** Page 1 a real text layer (well over 8 characters), page 2 image-only with OCRDELTA. */
export async function mixedPdf(page: Page, name = 'automation-mixed'): Promise<ScannedFixture> {
  const scan = await rasterisePage(page, { words: [{ text: MIXED_SCAN_WORD, x: 0.12, y: 0.2 }] })
  const pages: MixedPageSpec[] = [
    { kind: 'text', heading: 'Typed Page One', lines: [`This page has a real text layer ${MIXED_TEXT_WORD}.`] },
    { kind: 'image', jpeg: scan.jpeg, width: scan.width, height: scan.height },
  ]
  return {
    payload: { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: buildMixedPdf(pages, 'Mixed fixture') },
    displayName: name,
    pageCount: 2,
    boxes: [[], scan.boxes],
  }
}

export const STAMPED_SCAN_WORD = 'OCRECHO'

/**
 * One scanned page whose text layer holds only a printed page number ("7",
 * under the app's 8-character "image-only" threshold), as many scanners write.
 */
export async function stampedScanPdf(page: Page, name = 'automation-stamped'): Promise<ScannedFixture> {
  const scan = await rasterisePage(page, { words: [{ text: STAMPED_SCAN_WORD, x: 0.12, y: 0.2 }] })
  return {
    payload: { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: buildMixedPdf([{ kind: 'image', jpeg: scan.jpeg, width: scan.width, height: scan.height, stamp: '7' }], 'Stamped scan') },
    displayName: name,
    pageCount: 1,
    boxes: [scan.boxes],
  }
}

/** A JPEG photo of a page with known words, for the scanner's "Pick from gallery". */
export async function galleryJpeg(page: Page, word: string, name: string): Promise<FilePayload & { boxes: WordBox[] }> {
  const p = await rasterisePage(page, { words: [{ text: word, x: 0.12, y: 0.22 }] })
  return { name, mimeType: 'image/jpeg', buffer: p.jpeg, boxes: p.boxes }
}

/** Bytes with a .jpg name that no decoder can read (the scanner's per-file refusal). */
export const BROKEN_JPEG = (name = 'automation-broken.jpg'): FilePayload => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from('this is not an image at all, just text bytes', 'latin1') })

/** Three text pages with bookmarks, for the page index "Contents" tab. */
export const OUTLINE_PDF = {
  displayName: 'automation-outline',
  pageCount: 3,
  outline: [
    { title: 'Introduction', page: 1 },
    { title: 'Methods', page: 2 },
    { title: 'Results', page: 3 },
  ],
  payload: (): FilePayload => ({
    name: 'automation-outline.pdf',
    mimeType: 'application/pdf',
    buffer: buildMixedPdf(
      [
        { kind: 'text', heading: 'Introduction', lines: ['Bookmarked page one OUTLINEONE.'] },
        { kind: 'text', heading: 'Methods', lines: ['Bookmarked page two OUTLINETWO.'] },
        { kind: 'text', heading: 'Results', lines: ['Bookmarked page three OUTLINETHREE.'] },
      ],
      'Outline fixture',
      OUTLINE_PDF.outline,
    ),
  }),
}

/** Markdown with structure the viewer must render, and passages to highlight/link. */
export const MD_DOC = {
  name: 'automation-rich.md',
  /** Paragraph text, exactly as it renders (one text node). */
  paragraph: 'The marker MDHIGHLIGHT sits in this sentence for highlighting.',
  second: 'A second paragraph carries MDLINKWORD for linking passages.',
  payload: (): FilePayload => ({
    name: 'automation-rich.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Rich Markdown Heading\n\n' +
        'The marker MDHIGHLIGHT sits in this sentence for highlighting.\n\n' +
        'A second paragraph carries MDLINKWORD for linking passages.\n\n' +
        '- list item one\n- list item two\n\n' +
        '<img src="x" onerror="window.__ccXss = 1">\n\n' +
        '<script>window.__ccXss = 2</script>\n',
    ),
  }),
}

/**
 * Plain text; the text viewer must show it verbatim in a monospace block.
 * The words tests select sit below the first line, clear of the floating
 * text toolbar at the top of the pane.
 */
export const TXT_DOC = {
  name: 'automation-words.txt',
  text: 'Plain text document\n\nFirst line with TXTMARKER inside.\nSecond line keeps   its spacing.\n',
  payload: (): FilePayload => ({ name: 'automation-words.txt', mimeType: 'text/plain', buffer: Buffer.from(TXT_DOC.text) }),
}

/** One byte over the 10 MB limit for .md/.txt uploads. */
export const OVERSIZED_TXT = (): FilePayload => ({ name: 'automation-big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x61) })

/** A one-page PDF named for ordering tests. */
export const namedPdf = (name: string, marker: string): FilePayload => ({
  name: `${name}.pdf`,
  mimeType: 'application/pdf',
  buffer: buildTextPdf([{ heading: name, lines: [`Marker ${marker}.`] }], name),
})

/**
 * A PDF whose text layer is Hindi (Devanagari) - drawn in Latin glyphs, mapped
 * to Devanagari by its ToUnicode table (builders/unicodePdf.ts). "KMR" reads
 * as कमर, which the find bar's Hindi virtual keyboard can type.
 */
export const HINDI_PDF = {
  displayName: 'automation-hindi',
  /** The word as extracted, and the keyboard keys that type it. */
  word: 'कमर',
  keys: ['क', 'म', 'र'],
  payload: (): FilePayload => ({
    name: 'automation-hindi.pdf',
    mimeType: 'application/pdf',
    buffer: buildUnicodeTextPdf(['KMR PLT', 'TLP KMR LMP'], { K: 0x0915, M: 0x092e, R: 0x0930, P: 0x092a, L: 0x0932, T: 0x0924 }, 'Hindi fixture'),
  }),
}
