/**
 * A long, text-heavy PDF for the large-data performance specs, built in
 * memory with the deterministic text-PDF writer (builders/pdf.ts).
 *
 * Every page has a heading, 30 lines of body text (so the text index and
 * Find have real work per page) and one marker that appears on that page
 * only, zero-padded so no marker is a prefix of another (LARGEPAGE007 is
 * not inside LARGEPAGE070). The last page alone carries LASTPAGEMARKER, and
 * every page carries the word "throughput" exactly once.
 */
import { buildTextPdf, type PdfPageSpec } from './pdf.js'

const FILLER = [
  'Spatial notes sit beside the pages they explain, linked by threads.',
  'A reader marks a passage, drags it out, and writes a thought next to it.',
  'Long documents test the viewer, the text index and the search alike.',
]

export interface LargePdfFacts {
  pageCount: number
  /** Marker unique to page n (1-based). */
  marker: (n: number) => string
  /** On the last page only. */
  lastPageMarker: string
  /** Once on every page. */
  everyPageWord: string
}

export function largePdfFacts(pageCount: number): LargePdfFacts {
  const width = String(pageCount).length
  return {
    pageCount,
    marker: (n) => `LARGEPAGE${String(n).padStart(width, '0')}`,
    lastPageMarker: 'LASTPAGEMARKER',
    everyPageWord: 'throughput',
  }
}

export function buildLargePdf(pageCount: number, title = 'Large automation fixture'): { buffer: Buffer; facts: LargePdfFacts } {
  const facts = largePdfFacts(pageCount)
  const pages: PdfPageSpec[] = Array.from({ length: pageCount }, (_, i) => {
    const n = i + 1
    const lines = Array.from({ length: 30 }, (_, l) => `${n}.${l + 1} ${FILLER[(n + l) % FILLER.length]}`)
    lines[3] = `Marker ${facts.marker(n)} sits on page ${n}; measured throughput stays steady.`
    if (n === pageCount) lines[5] = `The final page carries ${facts.lastPageMarker}.`
    return { heading: `Large page ${n}`, lines }
  })
  return { buffer: buildTextPdf(pages, title), facts }
}
