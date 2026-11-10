/**
 * `test` for the sharing specs: the shared account fixture (fixtures/account.ts:
 * `muul`, `muulPlan`, app / signedIn / project / pdfOpen) plus
 *
 *   sharing      one stateful fake of the sharing API (helpers/mocks/sharingBackend.ts),
 *                served to the main page as its signed-in identity. Seed it, or
 *                inspect what the app sent, from the test.
 *   secondUser   open another browser context signed in as a different
 *                MuulOrigin identity, served by the SAME fake, so a share sent
 *                by one really reaches the other. Same guards as the main page:
 *                every off-origin request is aborted and an uncaught page error
 *                fails the test. Closed at teardown.
 *
 * The fake is attached before the app opens, so the first boot already sees it.
 */
import { devices, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { test as base, expect } from './account.js'
import { baseURL } from '../config/env.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { MuulApiMock, type MuulIdentity, type PlanScenario } from '../helpers/mocks/muulAccount.js'
import { SharingBackend } from '../helpers/mocks/sharingBackend.js'

/** The teacher is the account fixture's TEST_IDENTITY (Automation User). Students: reserved-TLD identities. */
export const STUDENT: MuulIdentity = { sub: 'e2e-student-0001', email: 'sam.student@example.invalid', firstName: 'Sam', lastName: 'Student', orgId: 'e2e-org-0101' }
export const STUDENT_2: MuulIdentity = { sub: 'e2e-student-0002', email: 'riya.reader@example.invalid', firstName: 'Riya', lastName: 'Reader', orgId: 'e2e-org-0102' }
export const STUDENT_3: MuulIdentity = { sub: 'e2e-student-0003', email: 'omar.owl@example.invalid', firstName: 'Omar', lastName: 'Owl', orgId: 'e2e-org-0103' }
export const COLLEAGUE: MuulIdentity = { sub: 'e2e-teacher-0002', email: 'tara.teacher@example.invalid', firstName: 'Tara', lastName: 'Teacher', orgId: 'e2e-org-0201' }

export interface SecondUser {
  context: BrowserContext
  page: Page
  app: CognitiveCanvas
  muul: MuulApiMock
  blocked: string[]
  /** PIN setup + first-run Catalog + Home, like the `signedIn` fixture. */
  signIn: () => Promise<CognitiveCanvas>
}

interface SharingFixtures {
  sharing: SharingBackend
  secondUser: (identity: MuulIdentity, plan?: PlanScenario | null) => Promise<SecondUser>
}

async function openSecond(browser: Browser, sharing: SharingBackend, identity: MuulIdentity, plan: PlanScenario | null, errors: string[]): Promise<SecondUser> {
  const origin = new URL(baseURL).origin
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 800 },
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  const blocked: string[] = []
  await context.route(
    (url) => url.origin !== origin && url.protocol !== 'data:' && url.protocol !== 'blob:',
    (route) => { blocked.push(`${route.request().method()} ${route.request().url()}`); return route.abort('blockedbyclient') },
  )
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`[${identity.email}] ${e.name}: ${e.message}`))
  const muul = await MuulApiMock.install(page, { plan, identity })
  await sharing.attach(muul)
  const app = new CognitiveCanvas(page)
  return {
    context, page, app, muul, blocked,
    signIn: async () => {
      await app.open()
      await app.pinSetup.createPin()
      await app.firstRunCatalogShown()
      await app.home.reach()
      return app
    },
  }
}

export const test = base.extend<SharingFixtures>({
  sharing: async ({ muul }, provide) => {
    const backend = new SharingBackend()
    await backend.attach(muul)
    await provide(backend)
    backend.releaseAll()
  },

  // Re-declared so every booted layer waits for the fake to be attached.
  app: async ({ page, sharing: _sharing }, provide) => {
    await provide(new CognitiveCanvas(page))
  },

  secondUser: async ({ browser, sharing }, provide, testInfo) => {
    const opened: SecondUser[] = []
    const errors: string[] = []
    await provide(async (identity, plan = 'free') => {
      const u = await openSecond(browser, sharing, identity, plan, errors)
      opened.push(u)
      return u
    })
    sharing.releaseAll() // before the contexts close, so nothing they asked for is left held
    for (const u of opened) await u.context.close()
    if (errors.length) await testInfo.attach('second-user-page-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
    if (testInfo.status === testInfo.expectedStatus) expect(errors, 'uncaught exceptions in a second user\'s page').toEqual([])
  },
})

export { expect }
