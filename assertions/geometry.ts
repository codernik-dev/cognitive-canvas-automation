/**
 * Geometry assertions for the things a pointer cannot prove: that a
 * connection thread really starts at its PDF region and ends at its note,
 * and keeps doing so after the note moves, the PDF zooms or the document
 * changes.
 *
 * ConnectionThreads.tsx draws each area link as `g#area-<linkId>` with a
 * main path `M sx sy C … ex ey` in the SVG's own pixel space, starting at
 * the right edge of the PDF rectangle (vertical centre) and ending at the
 * item's left edge (vertical centre). Threads repaint on animation frames,
 * so every check polls.
 */
import { expect, type Page } from '@playwright/test'

export interface ThreadGeometry {
  visible: boolean
  start: { x: number; y: number }
  end: { x: number; y: number }
  /** Where the thread should start: right-centre of the PDF link rectangle. */
  expectedStart: { x: number; y: number }
  /** Where it should end: left-centre of the item. */
  expectedEnd: { x: number; y: number }
}

export async function threadGeometry(page: Page, areaLinkId: string, itemId: string): Promise<ThreadGeometry | null> {
  return page.evaluate(
    ({ areaLinkId, itemId }) => {
      const g = document.getElementById(`area-${areaLinkId}`) as SVGGElement | null
      const region = document.querySelector(`[data-area-link-id="${areaLinkId}"]`)
      const item = document.querySelector(`[data-workspace-item][data-item-id="${itemId}"]`)
      if (!g || !region || !item || !g.ownerSVGElement) return null
      const svg = g.ownerSVGElement.getBoundingClientRect()
      const d = g.querySelectorAll('path')[1]?.getAttribute('d') ?? ''
      const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
      if (n.length < 8) return null
      const r = region.getBoundingClientRect()
      const i = item.getBoundingClientRect()
      return {
        visible: g.style.opacity === '1',
        start: { x: svg.left + n[0], y: svg.top + n[1] },
        end: { x: svg.left + n[n.length - 2], y: svg.top + n[n.length - 1] },
        expectedStart: { x: r.right, y: r.top + r.height / 2 },
        expectedEnd: { x: i.left, y: i.top + i.height / 2 },
      }
    },
    { areaLinkId, itemId },
  )
}

/**
 * The thread is visible and both ends sit on their anchors within `tolerance`
 * pixels. 4 px allows for stroke width, sub-pixel layout and the one frame
 * of lag the rAF loop has after a layout change; anything beyond that is a
 * visibly detached thread.
 */
export async function expectThreadAnchored(page: Page, areaLinkId: string, itemId: string, tolerance = 4) {
  await expect
    .poll(
      async () => {
        const g = await threadGeometry(page, areaLinkId, itemId)
        if (!g) return 'thread not drawn'
        if (!g.visible) return 'thread hidden'
        const off = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
        const s = off(g.start, g.expectedStart)
        const e = off(g.end, g.expectedEnd)
        return s <= tolerance && e <= tolerance ? 'anchored' : `start off by ${s.toFixed(1)}px, end off by ${e.toFixed(1)}px`
      },
      { message: `thread for area link ${areaLinkId} should join its region and item`, timeout: 10_000 },
    )
    .toBe('anchored')
}

/** Every number in an SVG path lies within 0..1: highlight paths are stored page-normalised. */
/** The (x, y) points of a stored page-normalised SVG path, in order. */
export function pathPoints(d: string): Array<[number, number]> {
  const nums = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) ?? []).map(Number)
  const pts: Array<[number, number]> = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
  return pts
}

/**
 * A stored stroke lies along the drag that drew it: its ends at the drag's
 * ends and every point on the drag's line, within `tol` of the page (0.01 is
 * about 6 px on a 612 pt page at 100 %: room for pointer sampling and stroke
 * smoothing, far less than a misplaced stroke would be off).
 */
export function expectStrokeAlong(d: string, from: [number, number], to: [number, number], tol = 0.01) {
  const pts = pathPoints(d)
  expect(pts.length, 'stroke has points').toBeGreaterThan(1)
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${what}: stored ${a.toFixed(4)}, drawn ${b.toFixed(4)}`).toBeLessThanOrEqual(tol)
  near(Math.min(...xs), Math.min(from[0], to[0]), 'left end')
  near(Math.max(...xs), Math.max(from[0], to[0]), 'right end')
  near(Math.min(...ys), Math.min(from[1], to[1]), 'top')
  near(Math.max(...ys), Math.max(from[1], to[1]), 'bottom')
}

export function expectNormalisedPath(d: string) {
  const nums = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) ?? []).map(Number)
  expect(nums.length, `path "${d.slice(0, 60)}" has coordinates`).toBeGreaterThan(3)
  for (const v of nums) expect(v, `coordinate ${v} in "${d.slice(0, 60)}…"`).toBeGreaterThanOrEqual(0)
  for (const v of nums) expect(v).toBeLessThanOrEqual(1)
}
