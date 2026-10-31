/**
 * Accessibility helpers for the platform specs.
 *
 *   seriousViolations  axe-core (WCAG 2.0/2.1 A and AA rules) on the page or
 *                      on one region of it; returns the CRITICAL and SERIOUS
 *                      rule ids, and attaches every violation (all impacts,
 *                      with the first few offending nodes) to the report so
 *                      moderate and minor ones are tracked, not hidden.
 *   focusInfo          what has keyboard focus: its accessible label, and
 *                      whether it sits inside a given element.
 *   focusRing          the focused element's outline / box-shadow, to prove a
 *                      visible focus indicator.
 */
import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page, TestInfo } from '@playwright/test'

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

export interface ScanOptions {
  /** Scan only inside this CSS selector (a dialog, say), not the page behind it. */
  include?: string
  /** Leave out this CSS selector (e.g. an off-origin iframe the guard blocks). */
  exclude?: string
}

export async function seriousViolations(page: Page, testInfo: TestInfo, name: string, opts: ScanOptions = {}): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS)
  if (opts.include) builder = builder.include(opts.include)
  if (opts.exclude) builder = builder.exclude(opts.exclude)
  const results = await builder.analyze()
  const lines = results.violations.map((v) => [
    `${v.impact}\t${v.id}\t${v.nodes.length} node(s)\t${v.help}`,
    ...v.nodes.slice(0, 5).map((n) => `\t\t${n.target.join(' ')}  ${n.failureSummary?.split('\n').slice(1, 2).join(' ') ?? ''}`),
  ].join('\n'))
  await testInfo.attach(`axe-${name}.txt`, { body: lines.join('\n') || 'no violations', contentType: 'text/plain' })
  return [...new Set(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id))].sort()
}

/** A CSS selector that matches exactly the element a locator points at, by tagging it. */
export async function markForScan(locator: Locator, mark: string): Promise<string> {
  await locator.evaluate((el, m) => el.setAttribute('data-a11y-scan', m), mark)
  return `[data-a11y-scan="${mark}"]`
}

export interface FocusInfo {
  /** aria-label, else text, else placeholder, else the tag name. */
  label: string
  tag: string
  inside: boolean
}

/** What has focus now, and whether it is inside `container` (when given). */
export async function focusInfo(page: Page, container?: Locator): Promise<FocusInfo> {
  const root = container ? await container.elementHandle() : null
  return page.evaluate((r) => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return { label: '(body)', tag: 'body', inside: false }
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 60) || el.getAttribute('placeholder') || el.tagName.toLowerCase()
    return { label, tag: el.tagName.toLowerCase(), inside: r ? (r as Element).contains(el) : false }
  }, root)
}

export interface Ring { outlineStyle: string; outlineWidth: string; boxShadow: string; focusVisible: boolean }

/** The focused element's own focus styling. */
export async function focusRing(page: Page): Promise<Ring> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow, focusVisible: el.matches(':focus-visible') }
  })
}

/** True when a ring is something a sighted keyboard user can see: an outline of 1px or more, or a box-shadow. */
export function ringVisible(r: Ring): boolean {
  const outline = r.outlineStyle !== 'none' && parseFloat(r.outlineWidth) >= 1
  const shadow = r.boxShadow !== 'none' && r.boxShadow !== ''
  return outline || shadow
}

/** Press Tab until `target` has focus (at most `max` presses); returns how many it took. */
export async function tabTo(page: Page, target: Locator, max = 60, key: 'Tab' | 'Shift+Tab' = 'Tab'): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key)
    if (await target.evaluate((el) => el === document.activeElement)) return i
  }
  throw new Error(`${max} × ${key} never reached the target`)
}
