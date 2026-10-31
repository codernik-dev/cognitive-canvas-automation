/**
 * The one `test` every spec imports.
 *
 * Fixture layers (each builds on the one before; a spec asks for the
 * furthest it needs and gets a fresh, isolated browser context):
 *
 *   app        the page objects, nothing booted
 *   signedIn   PIN set up on a fresh profile, on the (empty) projects screen
 *   project    signedIn + one empty project, open on its document list
 *   pdfOpen    project + the four-page FIND_PDF uploaded and open
 *
 * Two automatic guards run for every test:
 *
 *   network    every request that leaves the app's own origin is aborted and
 *              recorded. The app is offline-first, so this is its normal
 *              mode, and it means no test can touch muulorigin.com, GitHub
 *              or S3 by accident. A spec that needs a server mocks it with
 *              page.route (helpers/mockApi.ts), which takes precedence.
 *   pageErrors an uncaught exception in the page fails the test, unless the
 *              spec lists it in `allowedPageErrors` with a reason.
 */
import { test as base, expect } from '@playwright/test'
import { baseURL } from '../config/env.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { FIND_PDF } from '../data/files.js'

export interface ProjectContext {
  name: string
}

interface Options {
  /** 'block' (default): abort every request off the app origin. 'allow': let them through (never in CI). */
  externalNetwork: 'block' | 'allow'
  /** Uncaught page errors this spec tolerates, each a regex. Default none. */
  allowedPageErrors: RegExp[]
  /** Project name the `project` fixture creates. Letters, digits and spaces only (the app's rule). */
  projectName: string
}

interface Fixtures {
  /** Requests the network guard aborted, for assertions about what the app tried to reach. */
  blockedRequests: string[]
  app: CognitiveCanvas
  signedIn: CognitiveCanvas
  project: ProjectContext
  pdfOpen: CognitiveCanvas
}

const APP_ORIGIN = new URL(baseURL).origin

export const test = base.extend<Options & Fixtures>({
  externalNetwork: ['block', { option: true }],
  allowedPageErrors: [[], { option: true }],
  projectName: ['Automation Project', { option: true }],

  blockedRequests: [
    async ({ context, externalNetwork }, provide, testInfo) => {
      const blocked: string[] = []
      if (externalNetwork === 'block') {
        await context.route(
          (url) => url.origin !== APP_ORIGIN && url.protocol !== 'data:' && url.protocol !== 'blob:',
          (route) => {
            blocked.push(`${route.request().method()} ${route.request().url()}`)
            return route.abort('blockedbyclient')
          },
        )
      }
      await provide(blocked)
      if (blocked.length) {
        await testInfo.attach('blocked-external-requests.txt', { body: [...new Set(blocked)].join('\n'), contentType: 'text/plain' })
      }
    },
    { auto: true },
  ],

  page: async ({ page, allowedPageErrors }, provide, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (e) => {
      const msg = `${e.name}: ${e.message}`
      if (!allowedPageErrors.some((re) => re.test(msg))) errors.push(msg)
    })
    await provide(page)
    if (errors.length) await testInfo.attach('page-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
    // Skip the check when the test already failed: the first failure is the useful one.
    if (testInfo.status === testInfo.expectedStatus) {
      expect(errors, 'uncaught exceptions in the page (allow-list them with allowedPageErrors if intended)').toEqual([])
    }
  },

  app: async ({ page }, provide) => {
    await provide(new CognitiveCanvas(page))
  },

  signedIn: async ({ app }, provide) => {
    await app.open()
    await app.pinSetup.createPin()
    await app.firstRunCatalogShown()
    await app.home.reach()
    await provide(app)
  },

  project: async ({ signedIn, projectName }, provide) => {
    await signedIn.home.createProject(projectName)
    await signedIn.documents.expectOpen(projectName)
    await provide({ name: projectName })
  },

  pdfOpen: async ({ app, project: _project }, provide) => {
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await provide(app)
  },
})

export { expect }
