/**
 * A browser context of the test's own, for specs whose permission state must
 * be set when the context is made (browser.newContext({ permissions })),
 * with the same guards fixtures/test.ts puts on every page: every request off
 * the app origin is aborted and recorded, and an uncaught page error is
 * collected for the spec to assert on. Phone emulation (Pixel 5) and the
 * suite's isolation defaults; the touch-device notice counts as dismissed.
 */
import { devices, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test'
import { baseURL } from '../config/env.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { MobileShell } from '../pages/MobileShell.js'
import { MobileWorkspace } from '../components/MobileWorkspace.js'

export interface GuardedPhone {
  context: BrowserContext
  page: Page
  app: CognitiveCanvas
  mobile: MobileShell
  ws: MobileWorkspace
  blocked: string[]
  pageErrors: string[]
}

export async function guardedPhoneContext(browser: Browser, options: BrowserContextOptions): Promise<GuardedPhone> {
  const origin = new URL(baseURL).origin
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    ...options,
  })
  const blocked: string[] = []
  await context.route(
    (url) => url.origin !== origin && url.protocol !== 'data:' && url.protocol !== 'blob:',
    (route) => { blocked.push(`${route.request().method()} ${route.request().url()}`); return route.abort('blockedbyclient') },
  )
  await context.addInitScript((appOrigin) => {
    if (location.origin !== appOrigin) return
    localStorage.setItem('cc2_view_alerted_at', 'mobile-view')
  }, origin)
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
  return { context, page, app: new CognitiveCanvas(page), mobile: new MobileShell(page), ws: new MobileWorkspace(page), blocked, pageErrors }
}
