# Test data

| Fixture | Source | Facts tests rely on |
|---|---|---|
| `FIND_PDF` (`automation-find.pdf`) | `builders/pdf.ts`, in memory | 4 pages; "canvas" once on each of pages 1-3; `AUTOMATIONALPHA` p1, `BRAVOTWO` p2, `ZULUFOUR` p4; page 1 line 1 "The quick brown fox…" |
| `SECOND_PDF` | `builders/pdf.ts` | 1 page |
| `LONG_PDF` | `builders/pdf.ts` | 40 pages; marker `LONGPAGE<n>` on page n |
| `BAD_FILES.*` | inline bytes | corrupt PDF header, 0-byte PDF, text named `.pdf`, `.exe` |
| `IMAGES.png` | `builders/png.ts` | 64×64, red with a blue centre square |
| `TEXT_FILES.*` | inline bytes | `MARKDOWNMARKER`, `PLAINMARKER` |
| `BINARY.legacyPdf`, `BINARY.toneMp3` | `e2e/fixtures/` (legacy suite, reused) | 6 pages; MP3 of 319,422 bytes |
| `BINARY.encryptedPdf` | `static/encrypted.pdf` | AES-256, user password `secret`, owner `owner-secret`, 1 page |

The generated PDFs were checked with PyMuPDF: the xref is valid (no repair needed), the text extracts, and the match counts are as stated.

`static/encrypted.pdf` was made once with PyMuPDF and committed:

```python
import pymupdf
d = pymupdf.open(); p = d.new_page(); p.insert_text((72, 72), 'Encrypted fixture ENCRYPTEDMARKER', fontsize=14)
d.save('encrypted.pdf', encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw='secret', owner_pw='owner-secret', permissions=0)
```

`test-inventory.csv` is the source of truth for test cases; `npm run inventory` renders docs 04 and 05 from it.

## Documents area (`data/documents-files.ts`)

| Fixture | Source | Facts tests rely on |
|---|---|---|
| `scannedPdf(page)` (`automation-scanned.pdf`) | `builders/rasterText.ts` (words drawn on a canvas in the test's browser, JPEG) + `builders/scannedPdf.ts` (DCTDecode image pages, no text layer) | 3 image-only pages; p1 `OCRALPHA`, `OCRBRAVO` (two lines) and a drawing with no letters; p2 `OCRCHARLIE`; p3 blank paper. Every word's box is returned (`boxes`) for position checks |
| `oneWordScan(page, word, name)` | same | 1 image-only page with one word |
| `mixedPdf(page)` | same + Helvetica text page | p1 real text layer with `TEXTLAYERWORD`; p2 image-only `OCRDELTA` |
| `stampedScanPdf(page)` | same | 1 image-only page `OCRECHO` whose text layer holds only "7" |
| `galleryJpeg(page, word, name)` | `builders/rasterText.ts` | 1275 x 1650 JPEG photo of a page with one word, for the scanner's gallery |
| `OUTLINE_PDF` | `builders/scannedPdf.ts` (text pages + /Outlines) | 3 pages, bookmarks Introduction / Methods / Results -> pages 1 / 2 / 3 |
| `HINDI_PDF` | `builders/unicodePdf.ts` (Helvetica + /ToUnicode CMap) | text layer extracts as Devanagari; "KMR" = कमर appears twice |
| `MD_DOC`, `TXT_DOC` | inline bytes | Markdown with heading, list, `MDHIGHLIGHT`, `MDLINKWORD`, plus `<img onerror>` / `<script>` that must not run; text with `TXTMARKER` and preserved spacing |
| `OVERSIZED_TXT` | inline bytes | 10 MB + 1 byte `.txt` (over the text-document limit) |
| `BROKEN_JPEG` | inline bytes | text bytes named `.jpg` (no decoder can read it) |

All are generated per test; no binaries were added. OCR on the scanned fixtures was checked against the app: the stored words match exactly and their boxes fall within 0.001 of the drawn positions.

## Content area (`content-files.ts`)

| Fixture | Source | Facts tests rely on |
|---|---|---|
| `CATALOG` / `CATALOG_ITEMS` | inline, served by `helpers/mocks/contentCatalog.ts` | 8 items in 4 categories (Class 11, Class 12, History, Science); Science has Biology (2), Physics (1) and one direct item; "Chapter 2" exists in Class 11 and Class 12 |
| `PROJECT_NAME` | inline | the name the importer must give each item (category · subcategory — title, minus parts the title already says) |
| `CELL_BIOLOGY_ZIP`, `pdfZip`, `singlePdfZip` | `builders/pdf.ts` + fflate, in memory | PDF entries become documents named after the file; markers `MEMBRANEMARKER` (Membranes p1), `ORGANELLEMARKER` (Organelles p1) |
| `cc2BackupZip`, `emptyZip`, `HTML_NOT_A_ZIP` | fflate, in memory | a single-project CC2 backup with one PDF; a ZIP with no documents; an HTML page served in place of a ZIP |

## Canvas area (`canvas-files.ts`, `helpers/canvasMedia.ts`)

| Fixture | Source | Facts tests rely on |
|---|---|---|
| `TONE_MP3` | the committed legacy `e2e/fixtures/tone.mp3` (reused, not copied) | 319 422 bytes, `audio/mpeg`, about 19 s; plays in Chromium |
| `recordClip(context, 2, 'mp4')` | recorded at run time by MediaRecorder from Chromium's fake camera in a throwaway page of the test's context | a real ISO-BMFF `video/mp4` (`ftyp` header) of about 2 s that the browser decodes; cached per worker |
| `HEADER_ONLY_MP4` | inline bytes | the 24-byte `ftyp isom` header: sniffed as MP4, but no browser can play it |
| `PNG_NAMED(name, type)` | `builders/png.ts` | an 8x8 PNG wearing a media file's name, for the content-sniffer refusals |
| `MOV_FILE` | inline bytes | `holiday.mov`, refused by name before its bytes are read |
| `bigFile(path, bytes)` | `ftruncate` in the test's output folder, removed after use | a file just over a size limit (100 MB audio, 450 MB video); only its size is read by the app |

No binary was added for the canvas area.

## Platform area (`builders/largePdf.ts`, `helpers/platformDb.ts`, `helpers/platformContent.ts`)

| Fixture | Source | Facts tests rely on |
|---|---|---|
| `buildLargePdf(200)` | `builders/pdf.ts`, in memory | 200 text pages of 30 lines; `LARGEPAGE001`..`LARGEPAGE200` each on its own page only (zero-padded, so none is inside another); `LASTPAGEMARKER` on page 200 only; `throughput` once on every page |
| 500 notes / 100 projects (performance) | one note or project made through the UI, its IndexedDB row copied with new ids (`putRows`) | every copy has exactly the fields the app writes; notes laid out 25 per row, 260 x 190 world units apart |
| older-build databases (migration) | a real session's rows (`dumpDb`), laid out again at v6 / v11 / v12 / v14 with that version's stores and indexes (`SCHEMA`, `seedDb`) | rows of stores older builds did not timestamp lose `updatedAt`; a legacy PIN is the bare SHA-256 of the test PIN |
| every-kind project (persistence sweep) | `buildEveryKind`, through the UI, the same set REG-488 backs up | notes, text box, link, pen stroke, line, area links, 3 highlights, extracted image, MP3 audio, recorded MP4 video, a second PDF, a Markdown document with a text highlight |

No binary was added for the platform area.
