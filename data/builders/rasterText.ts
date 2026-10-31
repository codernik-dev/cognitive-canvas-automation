/**
 * Rasterise known words into a JPEG, in the test's own browser.
 *
 * A "scanned" page must carry NO text layer, only pixels, and those pixels
 * must hold words OCR can read. Drawing real glyphs needs a font rasteriser,
 * which Node does not have without a dependency, so the drawing happens in a
 * detached <canvas> of the page the test already drives (nothing is attached
 * to the DOM, nothing leaves the browser). The canvas measures every word as
 * it draws it, so each word's box on the page is known exactly and a test can
 * check that OCR put the word where it was drawn.
 *
 *   const scan = await rasterisePage(page, { words: [{ text: 'OCRALPHA', x: 0.1, y: 0.15 }] })
 *   scan.jpeg   -> Buffer (baseline JPEG, white paper, black ink)
 *   scan.boxes  -> [{ text, x, y, width, height }] as fractions of the page
 */
import type { Page } from '@playwright/test'

/** One word: its left edge and BASELINE as fractions of the page, size in canvas px. */
export interface RasterWord {
  text: string
  x: number
  y: number
  size?: number
}

/** A non-text "picture" so a region is not blank yet holds nothing to read. */
export interface RasterShape {
  kind: 'disc' | 'box'
  /** Centre (disc) or top-left (box), fractions of the page. */
  x: number
  y: number
  /** Radius (disc) or side (box), fraction of the page width. */
  size: number
  /** Grey level 0-255. */
  grey: number
}

export interface RasterPageSpec {
  words?: RasterWord[]
  shapes?: RasterShape[]
}

export interface WordBox {
  text: string
  /** Fractions of the page: left, top, width, height of the inked glyphs. */
  x: number
  y: number
  width: number
  height: number
}

export interface RasterPage {
  jpeg: Buffer
  /** Pixel size of the JPEG. */
  width: number
  height: number
  boxes: WordBox[]
}

/** US Letter at 150 dpi: the same shape as the 612 x 792 pt PDF page it fills. */
export const SCAN_PX = { width: 1275, height: 1650 } as const

/** Fonts every CI image has one of; bold, so strokes survive JPEG and thresholding. */
const FONT_STACK = 'Arial, "Liberation Sans", "DejaVu Sans", Helvetica, sans-serif'

export async function rasterisePage(page: Page, spec: RasterPageSpec, quality = 0.92): Promise<RasterPage> {
  const out = await page.evaluate(
    ({ spec, size, font, quality }) => {
      const c = document.createElement('canvas')
      c.width = size.width
      c.height = size.height
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      for (const s of spec.shapes ?? []) {
        ctx.fillStyle = `rgb(${s.grey},${s.grey},${s.grey})`
        if (s.kind === 'disc') {
          ctx.beginPath()
          ctx.arc(s.x * c.width, s.y * c.height, s.size * c.width, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(s.x * c.width, s.y * c.height, s.size * c.width, s.size * c.width)
        }
      }
      ctx.fillStyle = '#000000'
      ctx.textBaseline = 'alphabetic'
      const boxes = (spec.words ?? []).map((w) => {
        ctx.font = `bold ${w.size ?? 72}px ${font}`
        const left = w.x * c.width
        const base = w.y * c.height
        ctx.fillText(w.text, left, base)
        const m = ctx.measureText(w.text)
        const top = base - m.actualBoundingBoxAscent
        const bottom = base + m.actualBoundingBoxDescent
        const x0 = left - m.actualBoundingBoxLeft
        const x1 = left + m.actualBoundingBoxRight
        return { text: w.text, x: x0 / c.width, y: top / c.height, width: (x1 - x0) / c.width, height: (bottom - top) / c.height }
      })
      return { dataUrl: c.toDataURL('image/jpeg', quality), boxes, width: c.width, height: c.height }
    },
    { spec, size: SCAN_PX, font: FONT_STACK, quality },
  )
  return { jpeg: Buffer.from(out.dataUrl.split(',')[1], 'base64'), width: out.width, height: out.height, boxes: out.boxes }
}
