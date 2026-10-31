/**
 * Deterministic PDF builder for tests.
 *
 * Writes a minimal, valid PDF 1.4 with one Helvetica text stream per page, so
 * every fixture's text, page count and word positions are known in advance and
 * no binary blob has to live in git. pdf.js renders and text-extracts it like
 * any other PDF (Helvetica is one of the 14 standard fonts, never embedded).
 *
 *   setInputFiles({ name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: buildTextPdf([...]) })
 */

export interface PdfPageSpec {
  /** Large heading at the top of the page. */
  heading: string
  /** Body lines, 12 pt, top to bottom. */
  lines?: string[]
}

const PAGE_W = 612
const PAGE_H = 792

/** Escape a string for a PDF literal: backslash and both parentheses. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

function contentStream(p: PdfPageSpec): string {
  const out = [`BT /F1 24 Tf 72 ${PAGE_H - 90} Td (${esc(p.heading)}) Tj ET`]
  if (p.lines?.length) {
    out.push(`BT /F1 12 Tf 16 TL 72 ${PAGE_H - 130} Td`)
    for (const l of p.lines) out.push(`(${esc(l)}) Tj T*`)
    out.push('ET')
  }
  return out.join('\n')
}

/** Build a text-only PDF. Every page must have a heading; text must be ASCII. */
export function buildTextPdf(pages: PdfPageSpec[], title = 'Automation fixture'): Buffer {
  if (!pages.length) throw new Error('buildTextPdf: at least one page is required')
  for (const p of pages) {
    const all = [p.heading, ...(p.lines ?? [])].join('')
    if (/[^\x20-\x7e]/.test(all)) throw new Error(`buildTextPdf: non-ASCII text on page "${p.heading}"`)
  }

  // Object numbering: 1 catalog, 2 pages, 3 font, 4 info, then a (page, content) pair per page.
  const objs: string[] = []
  const pageObjNum = (i: number) => 5 + i * 2
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objs[4] = `<< /Title (${esc(title)}) /Producer (cc2-automation) >>`
  pages.forEach((p, i) => {
    const stream = contentStream(p)
    objs[pageObjNum(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObjNum(i) + 1} 0 R >>`
    objs[pageObjNum(i) + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  })

  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = Buffer.byteLength(body, 'latin1')
    body += `${n} 0 obj\n${objs[n]}\nendobj\n`
  }
  const xrefAt = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let n = 1; n < objs.length; n++) body += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
