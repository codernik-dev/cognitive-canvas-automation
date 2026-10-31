/**
 * `test` for specs that need a MuulOrigin account (cloud backup, plans,
 * sharing, support). Same fixture layers as fixtures/test.ts (app, signedIn,
 * project, pdfOpen), plus:
 *
 *   muulPlan  option: the entitlements scenario to sign in with ('pro' by
 *             default; 'dev' is Economy, 'free', 'pro-paused', ...), or null
 *             for a signed-out user. Set per file or describe:
 *             test.use({ muulPlan: 'dev' })
 *   muul      the mocked api.muulorigin.com (helpers/mocks/muulAccount.ts):
 *             register endpoint handlers with muul.on(...) and inspect what
 *             the app sent with muul.calls / callsTo / waitForCall.
 *
 * The mock is installed before the app opens, so the very first boot already
 * sees the signed-in token and the mocked plan.
 */
import { test as base, expect } from './test.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { MuulApiMock, type PlanScenario } from '../helpers/mocks/muulAccount.js'

interface AccountOptions {
  muulPlan: PlanScenario | null
  /** Automatic cloud sync; off by default (it uploads 15 s after boot). */
  muulCloudSync: boolean
}

interface AccountFixtures {
  muul: MuulApiMock
}

export const test = base.extend<AccountOptions & AccountFixtures>({
  muulPlan: ['pro', { option: true }],
  muulCloudSync: [false, { option: true }],

  muul: async ({ page, muulPlan, muulCloudSync }, provide) => {
    await provide(await MuulApiMock.install(page, { plan: muulPlan, cloudSync: muulCloudSync }))
  },

  // Re-declared so every booted layer (signedIn, project, pdfOpen) waits for the mock.
  app: async ({ page, muul: _muul }, provide) => {
    await provide(new CognitiveCanvas(page))
  },
})

export { expect }
