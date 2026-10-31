/**
 * Read-only state helpers for the documents area: the text index (searchText,
 * where OCR writes), the OCR engine's language cache (IndexedDB keyval-store),
 * image bytes the area tools save, and the toolbar's localStorage switch.
 *
 * Like helpers/idb.ts, nothing here writes: tests change state through the
 * UI and check it here.
 */
import { expect, type Page } from '@playwright/test'
import { readStore } from './idb.js'
import type { WordBox } from '../data/builders/rasterText.js'

/** One recognised word as the app stores it: [text, x, y, width, height], fractions of the page. */
export type StoredWord = [string, number, number, number, number]

export interface SearchRow {
  id: string
  documentId: string
  projectId: string
  pageNumber: number
  text: string
  /** Present only on rows OCR wrote. Text-layer rows have none. */
  words?: StoredWord[]
}

export interface DocRow {
  id: string
  name: string
  pageCount: number
  projectId: string
  createdAt: number
  textIndexedAt?: number
  lastReadPage: number
}

export async function documentByName(page: Page, name: string): Promise<DocRow> {
  const docs = await readStore<DocRow>(page, 'documents')
  const doc = docs.find((d) => d.name === name)
  if (!doc) throw new Error(`no document named "${name}" (have: ${docs.map((d) => d.name).join(', ')})`)
  return doc
}

export async function searchRows(page: Page, documentId?: string): Promise<SearchRow[]> {
  const rows = await readStore<SearchRow>(page, 'searchText')
  return rows.filter((r) => !documentId || r.documentId === documentId).sort((a, b) => a.pageNumber - b.pageNumber)
}

/**
 * Wait until a document's text index has a row for every listed page. OCR
 * writes each page the moment it is read, so this is the app's own progress
 * signal; the timeout covers CPU-bound recognition on a loaded machine.
 */
export async function waitForPages(page: Page, documentId: string, pages: number[], timeout: number) {
  await expect
    .poll(async () => (await searchRows(page, documentId)).map((r) => r.pageNumber).filter((p) => pages.includes(p)).sort(), {
      message: `text index rows for pages ${pages.join(', ')}`,
      timeout,
      intervals: [500, 1000],
    })
    .toEqual([...pages].sort())
}

/** OCR text is free-form: compare words, ignoring case and spacing. */
export function wordsOf(text: string): string[] {
  return text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
}

/**
 * The stored box for `word` lies where it was drawn. OCR boxes are tight to
 * the ink as Tesseract sees it after rendering and thresholding, so they can
 * differ from the canvas measurement by a few pixels of a 1275 px page; 0.02
 * of the page (about 25 px on the source image) allows for that and still
 * fails a word attributed to the wrong line or column.
 */
export function expectWordAt(words: StoredWord[] | undefined, drawn: WordBox, tolerance = 0.02) {
  expect(words, `stored word boxes for ${drawn.text}`).toBeTruthy()
  const hit = words!.find((w) => w[0].toUpperCase() === drawn.text)
  expect(hit, `"${drawn.text}" among the stored words ${JSON.stringify(words!.map((w) => w[0]))}`).toBeTruthy()
  const [, x, y, w, h] = hit!
  for (const v of [x, y, w, h]) {
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(1)
  }
  expect(Math.abs(x - drawn.x), `left edge of ${drawn.text}`).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(y - drawn.y), `top edge of ${drawn.text}`).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(x + w - (drawn.x + drawn.width)), `right edge of ${drawn.text}`).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(y + h - (drawn.y + drawn.height)), `bottom edge of ${drawn.text}`).toBeLessThanOrEqual(tolerance)
}

/** Every word box in a row is inside the page. */
export function expectBoxesNormalised(words: StoredWord[]) {
  for (const [text, x, y, w, h] of words) {
    expect(typeof text).toBe('string')
    for (const v of [x, y, w, h]) {
      expect(v, `box of "${text}"`).toBeGreaterThanOrEqual(0)
      expect(v, `box of "${text}"`).toBeLessThanOrEqual(1)
    }
    expect(x + w, `right edge of "${text}"`).toBeLessThanOrEqual(1.0001)
    expect(y + h, `bottom edge of "${text}"`).toBeLessThanOrEqual(1.0001)
  }
}

/** Keys in the OCR engine's language cache (tesseract.js uses idb-keyval: db "keyval-store", store "keyval"). */
export async function ocrCacheKeys(page: Page): Promise<string[] | null> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    if (!dbs.some((d) => d.name === 'keyval-store')) return null
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('keyval-store')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      if (!conn.objectStoreNames.contains('keyval')) return []
      return await new Promise<string[]>((res, rej) => {
        const q = conn.transaction('keyval', 'readonly').objectStore('keyval').getAllKeys()
        q.onsuccess = () => res(q.result.map(String))
        q.onerror = () => rej(q.error)
      })
    } finally {
      conn.close()
    }
  })
}

/** Width and height from the PNG header of a saved media blob. */
export async function pngSizeOf(page: Page, blobId: string): Promise<{ width: number; height: number; signature: string }> {
  return page.evaluate(async (id) => {
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('cognitive-canvas')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      const row = await new Promise<{ data: ArrayBuffer | Blob } | undefined>((res, rej) => {
        const q = conn.transaction('mediaBlobs', 'readonly').objectStore('mediaBlobs').get(id)
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      if (!row) throw new Error(`media blob ${id} not found`)
      const buf = row.data instanceof Blob ? await row.data.arrayBuffer() : row.data
      const v = new DataView(buf)
      const sig = Array.from(new Uint8Array(buf, 0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('')
      return { width: v.getUint32(16), height: v.getUint32(20), signature: sig }
    } finally {
      conn.close()
    }
  }, blobId)
}

/**
 * Compare a stored image blob with a region of a rendered PDF page canvas.
 * Both are scaled to the same coarse grid (which evens out the page canvas
 * being rendered sharper or softer than the extract), then compared pixel by
 * pixel. Returns the mean absolute difference per channel (0-255) and the
 * share of dark pixels in the stored image (0-1), so a blank or mis-cropped
 * image cannot pass by being uniformly similar.
 */
export async function compareBlobWithPage(page: Page, blobId: string, pageNumber: number, region: { x: number; y: number; width: number; height: number }): Promise<{ meanDiff: number; darkShare: number }> {
  return page.evaluate(async ({ id, pageNumber, region }) => {
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('cognitive-canvas')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    let data: ArrayBuffer | Blob
    try {
      const row = await new Promise<{ data: ArrayBuffer | Blob; mimeType: string } | undefined>((res, rej) => {
        const q = conn.transaction('mediaBlobs', 'readonly').objectStore('mediaBlobs').get(id)
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      if (!row) throw new Error(`media blob ${id} not found`)
      data = row.data
    } finally {
      conn.close()
    }
    const stored = await createImageBitmap(data instanceof Blob ? data : new Blob([data]))
    const src = document.querySelector<HTMLCanvasElement>(`[data-page="${pageNumber}"]:not([data-placeholder="true"]) canvas.pdf-page-canvas`)
    if (!src) throw new Error(`page ${pageNumber} has no canvas`)
    const [w, h] = [80, Math.max(8, Math.round((80 * region.height * src.height) / (region.width * src.width)))]
    const grid = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      draw(ctx)
      return ctx.getImageData(0, 0, w, h).data
    }
    const a = grid((ctx) => ctx.drawImage(stored, 0, 0, w, h))
    const b = grid((ctx) => ctx.drawImage(src, region.x * src.width, region.y * src.height, region.width * src.width, region.height * src.height, 0, 0, w, h))
    let diff = 0
    let dark = 0
    for (let i = 0; i < a.length; i += 4) {
      diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      if (a[i] + a[i + 1] + a[i + 2] < 3 * 128) dark++
    }
    return { meanDiff: diff / ((a.length / 4) * 3), darkShare: dark / (a.length / 4) }
  }, { id: blobId, pageNumber, region })
}

export async function localStorageValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key)
}

/**
 * The box of the current find match as fractions of its page, read from the
 * find layer (PdfFindHighlightLayer draws it in % of the page).
 */
export async function currentMatchBox(page: Page): Promise<{ page: number; x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-find-current]') as HTMLElement | null
    if (!el) throw new Error('no current find match')
    const pageEl = el.closest('[data-page]')!
    const s = el.style
    return {
      page: Number(pageEl.getAttribute('data-page')),
      x: parseFloat(s.left) / 100,
      y: parseFloat(s.top) / 100,
      width: parseFloat(s.width) / 100,
      height: parseFloat(s.height) / 100,
    }
  })
}

/**
 * Record what the OCR queue runner decided for each job: the console line
 * "[OCR] Range: <from> - <to> Already have text: [...] Will OCR: [...]" it
 * writes before reading anything. Used as a readiness signal for silent
 * jobs, which show nothing on screen.
 */
export function recordOcrDecisions(page: Page): Array<{ have: number[]; willOcr: number[] }> {
  const out: Array<{ have: number[]; willOcr: number[] }> = []
  page.on('console', async (msg) => {
    if (!msg.text().startsWith('[OCR] Range:')) return
    const args = await Promise.all(msg.args().map((a) => a.jsonValue()))
    out.push({ have: args[5] as number[], willOcr: args[7] as number[] })
  })
  return out
}
