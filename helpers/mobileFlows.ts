/**
 * Small journeys the phone / tablet / iPad specs share. The desktop
 * `pdfOpen` fixture waits on the floating page-nav dock, which a phone does
 * not have (MobileDocStatusBar replaces it), so the phone opens its PDF here.
 */
import { expect } from '@playwright/test'
import type { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import type { MobileWorkspace } from '../components/MobileWorkspace.js'
import type { FilePayload } from '../data/files.js'
import { FIND_PDF } from '../data/files.js'
import type { Point } from './mobileInput.js'

/** In an open project: upload one PDF and wait until page 1 is drawn and the phone status bar reads "Page 1 / n". */
export async function openPdfOnPhone(app: CognitiveCanvas, ws: MobileWorkspace, file: FilePayload = FIND_PDF.payload(), pages = FIND_PDF.pageCount) {
  await app.documents.uploadFiles(file)
  await app.viewer.pageRendered(1)
  await expect(ws.pageLabel).toHaveText(`Page 1 / ${pages}`)
  await uploadToastGone(app, file)
}

/**
 * The '"<name>" uploaded' toast (shown as the document opens, 3.5 s) lies
 * over the top of the page on a phone (full width) and over the canvas on a
 * tablet, and takes the touches that land on it. A finger drawing there must
 * wait for it to go, as a person would.
 */
async function uploadToastGone(app: CognitiveCanvas, file: FilePayload) {
  await expect(app.toasts.withText(`"${file.name.replace(/\.pdf$/i, '')}" uploaded`)).toHaveCount(0)
}

/**
 * Tablet / iPad: upload one PDF into the open project and wait until the
 * document is open and, unless `drawn` is null, page `drawn` is rendered.
 * On the tablet layout a page of a freshly opened PDF is sometimes never drawn
 * (page 1 about 1 open in 8; reported as an intermittent application defect
 * in the mobile report), so specs that need no page pass null, and the touch
 * specs that draw on a page use page 2 (default), which has stayed reliable.
 */
export async function openPdfOnTablet(app: CognitiveCanvas, drawn: number | null = 2, file: FilePayload = FIND_PDF.payload(), name = FIND_PDF.displayName) {
  await app.documents.uploadFiles(file)
  await expect(app.viewer.documentTitle(name)).toBeVisible({ timeout: 30_000 })
  await expect(app.viewer.scroller).toBeVisible()
  if (drawn !== null) await app.viewer.pageRendered(drawn)
  await uploadToastGone(app, file)
}

/** Viewport point at a fraction of page n's drawn canvas (scrolled into view first). */
export async function pagePoint(app: CognitiveCanvas, n: number, fx: number, fy: number): Promise<Point> {
  await app.viewer.pageRendered(n)
  await app.viewer.canvasOf(n).scrollIntoViewIfNeeded()
  const box = await app.viewer.canvasOf(n).boundingBox()
  if (!box) throw new Error(`page ${n} has no box`)
  return [box.x + box.width * fx, box.y + box.height * fy]
}

/** The two corners of a page region, as viewport points. */
export async function pageRegion(app: CognitiveCanvas, n: number, from: [number, number], to: [number, number]): Promise<[Point, Point]> {
  return [await pagePoint(app, n, ...from), await pagePoint(app, n, ...to)]
}

/** Viewport point at a fraction of the canvas surface. */
export async function canvasPoint(app: CognitiveCanvas, fx: number, fy: number): Promise<Point> {
  return app.canvas.pointAt(fx, fy)
}

/** Whether the document is currently armed with `tool` according to the phone dial's tile. */
export async function tileArmed(ws: MobileWorkspace, id: string): Promise<boolean> {
  return ws.docDial.tileFace(id).evaluate((el) => el.classList.contains('bg-primary-500'))
}
