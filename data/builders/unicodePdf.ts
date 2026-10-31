/**
 * A one-page PDF whose text layer is in a non-Latin script, without
 * embedding a font.
 *
 * The page is drawn with standard Helvetica, but the font carries a
 * /ToUnicode CMap that maps each byte to a Unicode code point of the chosen
 * script. pdf.js extracts text through that map, so the app sees e.g.
 * Devanagari text (and offers its virtual keyboard) while the pixels show
 * Latin letters. Only the extracted text matters to the features under test.
 */

/** byte (ASCII letter) -> Unicode code point. */
export type GlyphMap = Record<string, number>

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

export function buildUnicodeTextPdf(lines: string[], map: GlyphMap, title = 'Unicode fixture'): Buffer {
  for (const l of lines) if (/[^ A-Za-z]/.test(l) || [...l].some((c) => c !== ' ' && !(c in map))) throw new Error(`buildUnicodeTextPdf: "${l}" uses a letter outside the map`)
  const entries = Object.entries(map)
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    `${entries.length + 1} beginbfchar`,
    '<20> <0020>',
    ...entries.map(([ch, cp]) => `<${hex2(ch.charCodeAt(0))}> <${hex4(cp)}>`),
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
  const content = ['BT /F1 20 Tf 24 TL 72 700 Td', ...lines.map((l) => `(${l}) Tj T*`), 'ET'].join('\n')

  const objs: string[] = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>'
  objs[5] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  objs[6] = `<< /Length ${Buffer.byteLength(cmap, 'latin1')} >>\nstream\n${cmap}\nendstream`
  objs[7] = `<< /Title (${title}) /Producer (cc2-automation) >>`

  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = Buffer.byteLength(body, 'latin1')
    body += `${n} 0 obj\n${objs[n]}\nendobj\n`
  }
  const xrefAt = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let n = 1; n < objs.length; n++) body += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
