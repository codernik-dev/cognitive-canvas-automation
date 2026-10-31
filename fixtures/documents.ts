/**
 * Documents-area fixture: the shared `test` (fixtures/test.ts) plus the
 * documents-area component objects, and one setup layer:
 *
 *   homeScan   signedIn + the three-page scanned PDF uploaded from HOME and
 *              opened. A Home upload does not queue background OCR (an
 *              in-project upload does), so the document starts with no
 *              text at all and every OCR entry point can be tested from a
 *              clean state.
 *
 * OCR is CPU-bound: specs that run it set their own test timeout with a
 * comment, sized from the timings in the report.
 */
import { test as base, expect } from './test.js'
import { OcrDialog, OcrToast } from '../components/DocumentsOcr.js'
import { DocToolbar, LinkDocPicker, IndexPanel, DocumentSwitcher, TextDocTools } from '../components/DocumentsTools.js'
import { ScannerModal, ScannerNotePad } from '../pages/DocumentsScanner.js'
import { DocumentList } from '../pages/DocumentsList.js'
import { scannedPdf, type ScannedFixture } from '../data/documents-files.js'
import { documentByName, type DocRow } from '../helpers/documents.js'

export interface HomeScan {
  scan: ScannedFixture
  doc: DocRow
}

interface DocumentsFixtures {
  ocrDialog: OcrDialog
  ocrToast: OcrToast
  toolbar: DocToolbar
  linkDocPicker: LinkDocPicker
  indexPanel: IndexPanel
  switcher: DocumentSwitcher
  textTools: TextDocTools
  scanner: ScannerModal
  notePad: ScannerNotePad
  docList: DocumentList
  homeScan: HomeScan
}

export const test = base.extend<DocumentsFixtures>({
  ocrDialog: async ({ page }, provide) => provide(new OcrDialog(page)),
  ocrToast: async ({ page }, provide) => provide(new OcrToast(page)),
  toolbar: async ({ page }, provide) => provide(new DocToolbar(page)),
  linkDocPicker: async ({ page }, provide) => provide(new LinkDocPicker(page)),
  indexPanel: async ({ page }, provide) => provide(new IndexPanel(page)),
  switcher: async ({ page }, provide) => provide(new DocumentSwitcher(page)),
  textTools: async ({ page }, provide) => provide(new TextDocTools(page)),
  scanner: async ({ page }, provide) => provide(new ScannerModal(page)),
  notePad: async ({ page }, provide) => provide(new ScannerNotePad(page)),
  docList: async ({ page }, provide) => provide(new DocumentList(page)),

  homeScan: async ({ signedIn: app, page }, provide) => {
    const scan = await scannedPdf(page)
    await app.home.upload(scan.payload)
    await app.documents.openDocument(scan.displayName)
    await app.viewer.expectDocumentOpen(scan.displayName, scan.pageCount)
    await provide({ scan, doc: await documentByName(page, scan.displayName) })
  },
})

export { expect }
