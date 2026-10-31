/**
 * PDF writer for scanned (image-only) and mixed documents.
 *
 * Like builders/pdf.ts it writes a minimal, valid PDF 1.4 by hand, but a page
 * can be:
 *   - 'text'  : a Helvetica text stream (a real text layer, as pdf.ts writes);
 *   - 'image' : one JPEG drawn over the whole page as a DCTDecode image
 *               XObject, with NO text at all - what a scanner produces;
 *               optionally plus a few characters of real text (`stamp`),
 *               the way scanners print a page number into the text layer.
 * An optional outline (bookmarks) points at pages, for the page-index
 * "Contents" tab.
 *
 * pdf.js renders the JPEG and reports zero text items for an image page, so
 * the app treats it exactly as a camera or flatbed scan.
 */

export type MixedPageSpec =
  | { kind: 'text'; heading: string; lines?: string[] }
  | { kind: 'image'; jpeg: Buffer; width: number; height: number; stamp?: string }

export interface OutlineEntry {
  title: string
  /** 1-based page the bookmark opens. */
  page: number
}

const PAGE_W = 612
const PAGE_H = 792

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

function textStream(heading: string, lines: string[] = []): string {
  const out = [`BT /F1 24 Tf 72 ${PAGE_H - 90} Td (${esc(heading)}) Tj ET`]
  if (lines.length) {
    out.push(`BT /F1 12 Tf 16 TL 72 ${PAGE_H - 130} Td`)
    for (const l of lines) out.push(`(${esc(l)}) Tj T*`)
    out.push('ET')
  }
  return out.join('\n')
}

/**
 * Build the PDF. Objects are written as latin1 strings except JPEG streams,
 * which are spliced in as raw bytes so offsets stay exact.
 */
export function buildMixedPdf(pages: MixedPageSpec[], title = 'Automation scanned fixture', outline: OutlineEntry[] = []): Buffer {
  if (!pages.length) throw new Error('buildMixedPdf: at least one page is required')
  for (const p of pages) {
    const txt = p.kind === 'text' ? [p.heading, ...(p.lines ?? [])].join('') : (p.stamp ?? '')
    if (/[^\x20-\x7e]/.test(txt)) throw new Error('buildMixedPdf: text must be printable ASCII')
    if (p.kind === 'image' && !(p.jpeg[0] === 0xff && p.jpeg[1] === 0xd8)) throw new Error('buildMixedPdf: image pages need JPEG bytes')
  }

  // 1 catalog, 2 pages, 3 font, 4 info, 5 outlines root, then per page: page, content, image (unused for text pages).
  type Obj = string | Buffer[]
  const objs: Obj[] = []
  const pageNum = (i: number) => 6 + i * 3
  const contentNum = (i: number) => pageNum(i) + 1
  const imageNum = (i: number) => pageNum(i) + 2
  const firstOutline = 6 + pages.length * 3

  objs[1] = `<< /Type /Catalog /Pages 2 0 R${outline.length ? ' /Outlines 5 0 R /PageMode /UseOutlines' : ''} >>`
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objs[4] = `<< /Title (${esc(title)}) /Producer (cc2-automation) >>`
  objs[5] = outline.length
    ? `<< /Type /Outlines /First ${firstOutline} 0 R /Last ${firstOutline + outline.length - 1} 0 R /Count ${outline.length} >>`
    : '<< /Type /Outlines /Count 0 >>'

  pages.forEach((p, i) => {
    if (p.kind === 'text') {
      const stream = textStream(p.heading, p.lines)
      objs[pageNum(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum(i)} 0 R >>`
      objs[contentNum(i)] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
      objs[imageNum(i)] = '<< >>' // keeps the numbering regular
    } else {
      const draw = [`q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q`]
      if (p.stamp) draw.push(`BT /F1 10 Tf ${PAGE_W / 2 - 10} 24 Td (${esc(p.stamp)}) Tj ET`)
      const stream = draw.join('\n')
      const font = p.stamp ? ' /Font << /F1 3 0 R >>' : ''
      objs[pageNum(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im0 ${imageNum(i)} 0 R >>${font} >> /Contents ${contentNum(i)} 0 R >>`
      objs[contentNum(i)] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
      objs[imageNum(i)] = [
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, 'latin1'),
        p.jpeg,
        Buffer.from('\nendstream', 'latin1'),
      ]
    }
  })

  outline.forEach((o, k) => {
    const n = firstOutline + k
    const prev = k > 0 ? ` /Prev ${n - 1} 0 R` : ''
    const next = k < outline.length - 1 ? ` /Next ${n + 1} 0 R` : ''
    objs[n] = `<< /Title (${esc(o.title)}) /Parent 5 0 R${prev}${next} /Dest [${pageNum(o.page - 1)} 0 R /XYZ 0 ${PAGE_H} 0] >>`
  })

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]
  let length = chunks[0].length
  const offsets: number[] = []
  const push = (b: Buffer) => { chunks.push(b); length += b.length }
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = length
    push(Buffer.from(`${n} 0 obj\n`, 'latin1'))
    const o = objs[n]
    if (typeof o === 'string') push(Buffer.from(o, 'latin1'))
    else for (const part of o) push(part)
    push(Buffer.from('\nendobj\n', 'latin1'))
  }
  const xrefAt = length
  let tail = `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let n = 1; n < objs.length; n++) tail += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  tail += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  push(Buffer.from(tail, 'latin1'))
  return Buffer.concat(chunks)
}
