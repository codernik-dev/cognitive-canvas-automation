/**
 * The test-data catalogue: every file a spec uploads, with the facts a test
 * asserts about it written next to the bytes that produce them.
 *
 * Generated files are built in memory (no binaries in git). The two
 * committed binaries are the legacy e2e PDF/MP3 (reused, not copied) and an
 * encrypted PDF that needs a real security handler to produce.
 */
import path from 'node:path'
import { buildTextPdf, type PdfPageSpec } from './builders/pdf.js'
import { buildPng } from './builders/png.js'

export interface FilePayload {
  name: string
  mimeType: string
  buffer: Buffer
}

const ROOT = path.resolve(import.meta.dirname, '..', '..')

/** Committed binaries. */
export const BINARY = {
  /** The legacy e2e fixture: 6 pages, a "Singleton Pattern" article. Card name "cc2-e2e-doc". */
  legacyPdf: path.join(ROOT, 'e2e', 'fixtures', 'cc2-e2e-doc.pdf'),
  /** 319 422-byte MP3 tone (legacy e2e fixture). */
  toneMp3: path.join(ROOT, 'e2e', 'fixtures', 'tone.mp3'),
  /** AES-256 encrypted, user password "secret" (made once with PyMuPDF; see data/README.md). */
  encryptedPdf: path.join(ROOT, 'automation', 'data', 'static', 'encrypted.pdf'),
}

/** Four pages whose words are known, for find, navigation and highlight specs. */
export const FIND_PDF_PAGES: PdfPageSpec[] = [
  { heading: 'Chapter One', lines: ['The quick brown fox jumps over the lazy dog.', 'Alpha marker AUTOMATIONALPHA appears only here.', 'Spatial canvas notes connect ideas.'] },
  { heading: 'Chapter Two', lines: ['Canvas threads link highlights to notes.', 'Nothing unique here except BRAVOTWO.'] },
  { heading: 'Chapter Three', lines: ['A third page keeps the canvas word count at three.'] },
  { heading: 'Chapter Four', lines: ['The final page has the marker ZULUFOUR.'] },
]

export const FIND_PDF = {
  /** Card name the app shows: the file name without ".pdf". */
  displayName: 'automation-find',
  pageCount: FIND_PDF_PAGES.length,
  /** "canvas", any case, appears once on each of pages 1-3. */
  canvasMatches: 3,
  uniqueWords: { AUTOMATIONALPHA: 1, BRAVOTWO: 2, ZULUFOUR: 4 } as Record<string, number>,
  payload: (): FilePayload => ({ name: 'automation-find.pdf', mimeType: 'application/pdf', buffer: buildTextPdf(FIND_PDF_PAGES, 'Automation find fixture') }),
}

/** A second, one-page PDF for multi-document specs. */
export const SECOND_PDF = {
  displayName: 'automation-second',
  pageCount: 1,
  payload: (): FilePayload => ({
    name: 'automation-second.pdf',
    mimeType: 'application/pdf',
    buffer: buildTextPdf([{ heading: 'Second Document', lines: ['This document exists to test switching between documents.'] }], 'Second'),
  }),
}

/** A long PDF for page-navigation boundaries and the render-time smoke budget. */
export const LONG_PDF = {
  displayName: 'automation-long',
  pageCount: 40,
  payload: (): FilePayload => ({
    name: 'automation-long.pdf',
    mimeType: 'application/pdf',
    buffer: buildTextPdf(Array.from({ length: 40 }, (_, i) => ({ heading: `Long page ${i + 1}`, lines: [`Marker LONGPAGE${i + 1} sits on page ${i + 1}.`] })), 'Long'),
  }),
}

/** Files the app must refuse or report on, never crash on. */
export const BAD_FILES = {
  /** A PDF header followed by garbage: parses as PDF, fails to load. */
  corruptPdf: (): FilePayload => ({ name: 'automation-corrupt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R\nthis is not a pdf body\n', 'latin1') }),
  /** Zero bytes. */
  emptyPdf: (): FilePayload => ({ name: 'automation-empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) }),
  /** Plain text with a .pdf name. */
  textAsPdf: (): FilePayload => ({ name: 'automation-text-as.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Hello, I am not a PDF at all.\n') }),
  /** An executable-looking file the upload should not accept as a document. */
  exe: (): FilePayload => ({ name: 'automation-program.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1') }),
}

export const IMAGES = {
  /** 64x64 red square with a blue centre. */
  png: (): FilePayload => ({ name: 'automation-image.png', mimeType: 'image/png', buffer: buildPng(64, 64, [220, 30, 30], [30, 30, 220]) }),
}

/** Text files the upload accepts as documents (if supported): see the analysis doc. */
export const TEXT_FILES = {
  markdown: (): FilePayload => ({ name: 'automation-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Markdown Fixture\n\nA paragraph with the word MARKDOWNMARKER.\n') }),
  plain: (): FilePayload => ({ name: 'automation-plain.txt', mimeType: 'text/plain', buffer: Buffer.from('Plain text fixture with PLAINMARKER.\n') }),
}

export const LEGACY_PDF = { displayName: 'cc2-e2e-doc', pageCount: 6 }

/** Anything a file chooser accepts: a committed file path or an in-memory payload, one or many. */
export type UploadInput = string | string[] | FilePayload | FilePayload[]
