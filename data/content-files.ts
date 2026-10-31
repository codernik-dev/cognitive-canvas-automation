/**
 * Test data for the content area: the mocked Product Catalog and the ZIPs its
 * items download as, all built in memory (no binaries in git).
 *
 * ZIP formats the importer accepts (src/services/catalog/importCatalogZip.ts):
 *   - any .pdf entries        -> one document per PDF (name = file name minus
 *                                ".pdf") plus one searchText row per page;
 *   - a CC2 backup            -> manifest.json + project.json + documents/<id>/;
 *   - nothing recognisable    -> an empty project.
 */
import { zipSync, strToU8 } from 'fflate'
import { buildTextPdf, type PdfPageSpec } from './builders/pdf.js'
import type { CatalogEntry } from '../helpers/mocks/contentCatalog.js'

/**
 * The catalog every content spec browses. Facts the specs rely on:
 *   - 4 categories (sorted naturally): Class 11, Class 12, History, Science;
 *   - Science has subcategories Biology (2) and Physics (1) plus one direct item;
 *   - History is flat (no subcategories); its "History - Unit 1" already names
 *     its category, so the project name gets no prefix;
 *   - "Chapter 2" exists twice (Class 11 and Class 12 Physics): an ambiguous slug.
 */
export const CATALOG = {
  cellBiology: { id: 'e2e-bio-cells', title: 'Cell Biology', description: 'Cells, membranes and organelles', category: 'Science', subcategory: 'Biology', zipUrl: 'catalog-e2e/cell-biology.zip', itemCount: 2, sortOrder: 1 },
  genetics: { id: 'e2e-bio-genetics', title: 'Genetics Basics', description: 'Genes and inheritance', category: 'Science', subcategory: 'Biology', zipUrl: 'catalog-e2e/genetics-basics.zip', itemCount: 1, sortOrder: 2 },
  motion: { id: 'e2e-phy-motion', title: 'Laws of Motion', description: 'Newton and friends', category: 'Science', subcategory: 'Physics', zipUrl: 'catalog-e2e/laws-of-motion.zip', itemCount: 1, sortOrder: 3 },
  labSafety: { id: 'e2e-sci-lab', title: 'Lab Safety', description: 'Rules for the laboratory', category: 'Science', zipUrl: 'catalog-e2e/lab-safety.zip', itemCount: 1, sortOrder: 4 },
  rome: { id: 'e2e-hist-rome', title: 'Ancient Rome', description: 'The republic and the empire', category: 'History', zipUrl: 'catalog-e2e/ancient-rome.zip', itemCount: 1, sortOrder: 5 },
  historyUnit: { id: 'e2e-hist-unit-1', title: 'History - Unit 1', description: 'Introduction to the course', category: 'History', zipUrl: 'catalog-e2e/history-unit-1.zip', itemCount: 1, sortOrder: 6 },
  class11Ch2: { id: 'e2e-c11-ch2', title: 'Chapter 2', description: 'Units and measurement', category: 'Class 11', subcategory: 'Physics', zipUrl: 'catalog-e2e/c11-physics-chapter-2.zip', itemCount: 1, sortOrder: 7 },
  class12Ch2: { id: 'e2e-c12-ch2', title: 'Chapter 2', description: 'Electrostatic potential', category: 'Class 12', subcategory: 'Physics', zipUrl: 'catalog-e2e/c12-physics-chapter-2.zip', itemCount: 1, sortOrder: 8 },
} satisfies Record<string, CatalogEntry>

export const CATALOG_ITEMS: CatalogEntry[] = Object.values(CATALOG)

/**
 * What the importer must name each project (catalogProjectName: category ·
 * subcategory — title, leaving out any part the title already contains, so
 * "Cell Biology" under Science › Biology is "Science — Cell Biology").
 */
export const PROJECT_NAME = {
  cellBiology: 'Science — Cell Biology',
  genetics: 'Science · Biology — Genetics Basics',
  motion: 'Science · Physics — Laws of Motion',
  labSafety: 'Science — Lab Safety',
  rome: 'History — Ancient Rome',
  historyUnit: 'History - Unit 1',
  class11Ch2: 'Class 11 · Physics — Chapter 2',
  class12Ch2: 'Class 12 · Physics — Chapter 2',
} satisfies Record<keyof typeof CATALOG, string>

export const IMPORTED_DESCRIPTION = 'Imported from Product Catalog'

export interface ZipPdf {
  /** Entry path inside the ZIP, e.g. "Lesson One.pdf" or "docs/Lesson Two.pdf". */
  path: string
  pages: PdfPageSpec[]
}

/** A ZIP of text PDFs (plus optional raw extra entries). */
export function pdfZip(pdfs: ZipPdf[], extra: Record<string, string | Uint8Array> = {}): Buffer {
  const entries: Record<string, Uint8Array> = {}
  for (const p of pdfs) entries[p.path] = new Uint8Array(buildTextPdf(p.pages, p.path))
  for (const [k, v] of Object.entries(extra)) entries[k] = typeof v === 'string' ? strToU8(v) : v
  return Buffer.from(zipSync(entries))
}

/** A valid ZIP holding nothing the importer recognises. */
export function emptyZip(): Buffer {
  return Buffer.from(zipSync({ 'readme.txt': strToU8('This catalog item has no documents yet.') }))
}

/** The standard two-document ZIP for "Cell Biology", with known words on known pages. */
export const CELL_BIOLOGY_ZIP = {
  docs: [
    { name: 'Membranes', pages: 2, marker: 'MEMBRANEMARKER' },
    { name: 'Organelles', pages: 1, marker: 'ORGANELLEMARKER' },
  ],
  build: (): Buffer => pdfZip([
    { path: 'Membranes.pdf', pages: [{ heading: 'Membranes', lines: ['The cell membrane MEMBRANEMARKER is a lipid bilayer.'] }, { heading: 'Transport', lines: ['Diffusion moves small molecules.'] }] },
    { path: 'lessons/Organelles.pdf', pages: [{ heading: 'Organelles', lines: ['Mitochondria ORGANELLEMARKER make energy.'] }] },
  ]),
}

/** A one-PDF ZIP for any other item; the document is named after `docName`. */
export function singlePdfZip(docName: string, marker: string): Buffer {
  return pdfZip([{ path: `${docName}.pdf`, pages: [{ heading: docName, lines: [`Marker ${marker} for ${docName}.`] }] }])
}

/**
 * A single-project CC2 backup (backupService format) carrying one PDF:
 *   manifest.json {version, appName:'cognitive-canvas', type:'single', projectIds}
 *   project.json, documents/<docId>/{meta.json,file.pdf}
 */
export function cc2BackupZip(opts: { projectName: string; description: string; docName: string; marker: string }): Buffer {
  const projectId = 'e2e-cc2-project'
  const docId = 'e2e-cc2-doc'
  const now = Date.UTC(2026, 0, 15)
  const pdf = buildTextPdf([{ heading: opts.docName, lines: [`Backup marker ${opts.marker}.`] }], opts.docName)
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify({ version: 1, appName: 'cognitive-canvas', type: 'single', projectIds: [projectId], exportedAt: now })),
    'project.json': strToU8(JSON.stringify({ id: projectId, userId: 'someone-else', name: opts.projectName, description: opts.description, createdAt: now, updatedAt: now, lastOpenedAt: now, thumbnailDataUrl: null, settings: { noiseWords: [], includeWords: [] } })),
    [`documents/${docId}/meta.json`]: strToU8(JSON.stringify({ id: docId, projectId, name: opts.docName, pageCount: 1, fileSize: pdf.length, compressedSize: null, createdAt: now, updatedAt: now, lastReadPage: 1, lastReadScrollY: 0 })),
    [`documents/${docId}/file.pdf`]: new Uint8Array(pdf),
  }
  return Buffer.from(zipSync(files))
}

/** The HTML a misconfigured host returns instead of the ZIP. */
export const HTML_NOT_A_ZIP = '<!doctype html><html><body><h1>Page not found</h1></body></html>'
