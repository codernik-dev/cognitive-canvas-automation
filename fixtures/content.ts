/**
 * `test` for the content area (catalog, deep links, assistant, law mode).
 * Same layers as fixtures/test.ts, plus:
 *
 *   catalog        option: what the mocked catalog list API answers
 *                  (helpers/mocks/contentCatalog.ts). Default: CATALOG_ITEMS.
 *   catalogApi     the installed list mock: inspect `requests`, swap replies.
 *   zips           same-origin catalog ZIP server.
 *   clockAt        option: install page.clock at this instant BEFORE the app
 *                  opens (time then flows normally). Default: real time.
 *   lawMode        option: boot in the Legal layout (localStorage
 *                  cc2_app_variant='law', seeded once per tab so switching
 *                  back in the UI is not undone by the reload). Default false.
 *   catalogShown   booted, PIN created, the first-run catalog listing on screen.
 *
 * `signedIn` is re-declared: with a working catalog the first-run screen shows
 * the listing instead of fixtures/test.ts's offline error, so it waits for
 * whichever the mock produces, then goes Home.
 *
 * `supportTest` is the signed-in variant for Settings › Support: the shared
 * account mock (fixtures/account.ts) plus the stateful support fake
 * (helpers/mocks/supportBackend.ts), both installed before the app opens.
 *   support        the fake: seed tickets, reply as staff, inspect uploads.
 *   withClock      option: page.clock installed before boot (time flows
 *                  normally) so the 45 s / 30 s polls can be fast-forwarded.
 */
import { test as base, expect } from './test.js'
import { test as accountBase } from './account.js'
import { SupportBackend } from '../helpers/mocks/supportBackend.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { CatalogApi, CatalogZips, always, type CatalogResponder } from '../helpers/mocks/contentCatalog.js'
import { CATALOG_ITEMS } from '../data/content-files.js'
import { CatalogScreen } from '../pages/ContentCatalog.js'

interface ContentOptions {
  catalog: CatalogResponder
  clockAt: Date | null
  lawMode: boolean
}

interface ContentFixtures {
  catalogApi: CatalogApi
  zips: CatalogZips
  catalogShown: CognitiveCanvas
}

export const test = base.extend<ContentOptions & ContentFixtures>({
  catalog: [always(CATALOG_ITEMS), { option: true }],
  clockAt: [null, { option: true }],
  lawMode: [false, { option: true }],

  catalogApi: async ({ page, catalog }, provide) => {
    await provide(await CatalogApi.install(page, catalog))
  },

  zips: async ({ page }, provide) => {
    await provide(new CatalogZips(page))
  },

  app: async ({ page, catalogApi: _catalogApi, clockAt, lawMode }, provide) => {
    if (clockAt) await page.clock.install({ time: clockAt })
    if (lawMode) {
      await page.addInitScript(() => {
        if (sessionStorage.getItem('__e2e_law_seeded')) return
        sessionStorage.setItem('__e2e_law_seeded', '1')
        localStorage.setItem('cc2_app_variant', 'law')
      })
    }
    await provide(new CognitiveCanvas(page))
  },

  catalogShown: async ({ app, page }, provide) => {
    await app.open()
    await app.pinSetup.createPin()
    await new CatalogScreen(page).expectSettled()
    await provide(app)
  },

  signedIn: async ({ catalogShown: app }, provide) => {
    await app.home.reach()
    await provide(app)
  },
})

export const supportTest = accountBase.extend<{ withClock: boolean; support: SupportBackend }>({
  withClock: [false, { option: true }],

  support: async ({ muul, page }, provide) => {
    await provide(await SupportBackend.install(muul, page))
  },

  app: async ({ page, muul: _muul, support: _support, withClock }, provide) => {
    if (withClock) await page.clock.install()
    await provide(new CognitiveCanvas(page))
  },
})

export { expect }
