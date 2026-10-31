/**
 * Touch, stylus and multi-finger input that Playwright's own API cannot
 * produce. Playwright offers a mouse and a one-finger tap; the app tells a
 * finger from a pen (pointerType), counts fingers (pinch) and times a
 * press-and-hold, so those inputs are produced here:
 *
 *   Chromium (phone, tablet)  the browser's own DevTools input protocol:
 *                             Input.dispatchMouseEvent with pointerType 'pen'
 *                             gives TRUSTED pen pointer events (real capture,
 *                             real touch-action), Input.dispatchTouchEvent gives
 *                             real fingers. Nothing is faked inside the page.
 *   WebKit (ipad)             no such protocol. Events are dispatched in the
 *                             page: PointerEvents with pointerType 'pen' or
 *                             'touch', and TouchEvents built with
 *                             document.createTouch. They use pointerId 1 - the
 *                             mouse's id, the one id WebKit always treats as an
 *                             active pointer - so the app's setPointerCapture()
 *                             succeeds (any other id throws NotFoundError).
 *
 * A real Apple Pencil (pressure, tilt, Touch.touchType 'stylus', palm contact)
 * is NOT reproduced: this proves the app's pointerType logic, not the iPad.
 */
import type { CDPSession, Page } from '@playwright/test'

export type Point = readonly [number, number]

const sessions = new WeakMap<Page, CDPSession>()

export function isChromium(page: Page): boolean {
  return page.context().browser()?.browserType().name() === 'chromium'
}

async function cdp(page: Page): Promise<CDPSession> {
  let s = sessions.get(page)
  if (!s) {
    s = await page.context().newCDPSession(page)
    sessions.set(page, s)
  }
  return s
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/**
 * In-page dispatch of a pointer sequence (WebKit). Moves and the release go to
 * the element pressed, as capture would route them. One event per animation
 * frame, as real input arrives: the app's handlers read React state that
 * only updates between frames.
 */
async function syntheticPointerDrag(page: Page, pointerType: 'pen' | 'touch', points: Point[]) {
  await page.evaluate(async ({ pointerType, points }) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const [x0, y0] = points[0]
    const target = document.elementFromPoint(x0, y0)
    if (!target) throw new Error(`nothing at ${x0},${y0}`)
    const fire = (type: string, x: number, y: number, buttons: number) => {
      target.dispatchEvent(new PointerEvent(type, {
        pointerType, pointerId: 1, isPrimary: true, clientX: x, clientY: y,
        button: type === 'pointermove' ? -1 : 0, buttons, pressure: buttons ? 0.5 : 0,
        width: pointerType === 'touch' ? 20 : 1, height: pointerType === 'touch' ? 20 : 1,
        bubbles: true, cancelable: true, composed: true,
      }))
    }
    fire('pointerdown', x0, y0, 1)
    await frame()
    for (const [x, y] of points.slice(1)) {
      fire('pointermove', x, y, 1)
      await frame()
    }
    const [xe, ye] = points[points.length - 1]
    fire('pointerup', xe, ye, 0)
    await frame()
  }, { pointerType, points: points.map((p) => [p[0], p[1]]) })
}

function path(from: Point, to: Point, steps: number): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => lerp(from, to, i / steps))
}

/** A stylus stroke from `from` to `to` (viewport px). */
export async function penDrag(page: Page, from: Point, to: Point, steps = 12) {
  if (!isChromium(page)) return syntheticPointerDrag(page, 'pen', path(from, to, steps))
  const s = await cdp(page)
  const pts = path(from, to, steps)
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1], pointerType: 'pen' })
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 })
  for (const [x, y] of pts.slice(1)) {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.5 })
  }
  const [xe, ye] = pts[pts.length - 1]
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xe, y: ye, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
}

/** A one-finger drag from `from` to `to` (viewport px). */
export async function fingerDrag(page: Page, from: Point, to: Point, steps = 12) {
  if (!isChromium(page)) return syntheticPointerDrag(page, 'touch', path(from, to, steps))
  const s = await cdp(page)
  const pts = path(from, to, steps)
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] })
  for (const [x, y] of pts.slice(1)) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** A finger that goes down and stays down (Chromium); finish with fingerMoveAndLift. */
export async function fingerDown(page: Page, at: Point) {
  const s = await cdp(page)
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at[0], y: at[1], id: 1 }] })
}

export async function fingerMoveAndLift(page: Page, from: Point, to: Point, steps = 10) {
  const s = await cdp(page)
  for (const [x, y] of path(from, to, steps).slice(1)) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/**
 * A quick swipe: touchStart, one move, touchEnd (Chromium only). The app's
 * single-page swipe must finish within 300 ms, so the gesture is as short as
 * the protocol allows; three messages normally take well under that.
 */
export async function swipe(page: Page, from: Point, to: Point) {
  await fingerDrag(page, from, to, 1)
}

/**
 * Two fingers on either side of `center`, `fromHalf` px from it, moving
 * apart (or together) to `toHalf`. Chromium: real touches. WebKit: TouchEvents
 * dispatched on the element under the centre (no pointer events, which is
 * all the app's pinch handlers read).
 */
export async function pinch(page: Page, center: Point, fromHalf: number, toHalf: number, steps = 6) {
  const [cx, cy] = center
  const fingers = (half: number) => [{ x: cx - half, y: cy, id: 1 }, { x: cx + half, y: cy, id: 2 }]
  const halves = Array.from({ length: steps }, (_, i) => fromHalf + ((toHalf - fromHalf) * (i + 1)) / steps)
  if (isChromium(page)) {
    const s = await cdp(page)
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(fromHalf) })
    for (const h of halves) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(h) })
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    return
  }
  await page.evaluate(async ({ cx, cy, fromHalf, halves }) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const target = document.elementFromPoint(cx, cy)
    if (!target) throw new Error('nothing under the pinch centre')
    const doc = document as unknown as { createTouch: (...a: unknown[]) => Touch; createTouchList: (...t: Touch[]) => TouchList }
    const touches = (half: number) => [1, 2].map((id) => {
      const x = id === 1 ? cx - half : cx + half
      return doc.createTouch(window, target, id, x + window.scrollX, cy + window.scrollY, x, cy)
    })
    const fire = (type: string, list: Touch[], changed: Touch[]) => {
      target.dispatchEvent(new TouchEvent(type, {
        touches: doc.createTouchList(...list) as unknown as Touch[],
        targetTouches: doc.createTouchList(...list) as unknown as Touch[],
        changedTouches: doc.createTouchList(...changed) as unknown as Touch[],
        bubbles: true, cancelable: true, composed: true,
      }))
    }
    const start = touches(fromHalf)
    fire('touchstart', start, start)
    await frame()
    let last = start
    for (const h of halves) {
      last = touches(h)
      fire('touchmove', last, last)
      await frame()
    }
    fire('touchend', [], last)
    await frame()
  }, { cx, cy, fromHalf, halves })
}

/**
 * Dispatch one cancelable touchstart (one finger) on the element under `at`
 * and report whether the app refused it (preventDefault), which is what keeps
 * the browser from turning the gesture into a native scroll.
 */
export async function touchStartRefused(page: Page, at: Point): Promise<boolean> {
  return page.evaluate(([x, y]) => {
    const target = document.elementFromPoint(x, y)
    if (!target) throw new Error(`nothing at ${x},${y}`)
    // WebKit builds touches with document.createTouch / createTouchList; Chromium with the Touch constructor.
    const doc = document as unknown as { createTouch?: (...a: unknown[]) => Touch; createTouchList?: (...t: Touch[]) => TouchList }
    const webkit = typeof doc.createTouch === 'function' && typeof doc.createTouchList === 'function'
    const touch = webkit ? doc.createTouch!(window, target, 7, x + window.scrollX, y + window.scrollY, x, y) : new Touch({ identifier: 7, target, clientX: x, clientY: y })
    const list = (...t: Touch[]) => (webkit ? doc.createTouchList!(...t) : t) as unknown as Touch[]
    const e = new TouchEvent('touchstart', { touches: list(touch), targetTouches: list(touch), changedTouches: list(touch), bubbles: true, cancelable: true, composed: true })
    target.dispatchEvent(e)
    const ended = new TouchEvent('touchend', { touches: list(), targetTouches: list(), changedTouches: list(touch), bubbles: true, cancelable: true, composed: true })
    target.dispatchEvent(ended)
    return e.defaultPrevented
  }, [at[0], at[1]] as [number, number])
}

/**
 * Press a pen down at `at` and keep it down (no release): in-page dispatch on
 * both engines, so the test can probe what the app does WHILE the stylus is
 * down. Finish with penUp.
 */
export async function penDownInPage(page: Page, at: Point) {
  await page.evaluate(([x, y]) => {
    const target = document.elementFromPoint(x, y)
    if (!target) throw new Error(`nothing at ${x},${y}`)
    ;(window as unknown as { __e2ePenTarget: Element }).__e2ePenTarget = target
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', pointerId: 1, isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1, pressure: 0.5, bubbles: true, cancelable: true, composed: true }))
  }, [at[0], at[1]] as [number, number])
}

export async function penUpInPage(page: Page, at: Point) {
  await page.evaluate(([x, y]) => {
    const target = (window as unknown as { __e2ePenTarget: Element }).__e2ePenTarget
    target.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'pen', pointerId: 1, isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 0, pressure: 0, bubbles: true, cancelable: true, composed: true }))
  }, [at[0], at[1]] as [number, number])
}
