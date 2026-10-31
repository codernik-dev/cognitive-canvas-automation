/**
 * `test` for the platform specs that need a MuulOrigin account with every
 * network feature mocked at once (offline checks of cloud backup, sharing
 * and support in one file): fixtures/backup.ts (the account `muul`, plan
 * `muulPlan`, the fake cloud store `cloud`, the MoBrowser `bridge`, the
 * backup screens `ui`) plus
 *
 *   sharing   the stateful sharing fake (helpers/mocks/sharingBackend.ts)
 *   support   the stateful support fake (helpers/mocks/supportBackend.ts)
 *   network   switch the device offline the way a lost connection looks to
 *             the app: the browser's own offline switch (navigator.onLine
 *             false, `offline` event) AND every call to api.muulorigin.com
 *             dying unanswered. Routed requests are not cut by Playwright's
 *             offline emulation, so without the second half the mocks would
 *             keep answering. `online()` undoes both.
 *
 * Every mock is installed before the app opens.
 */
import { test as base, expect } from './backup.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { SharingBackend } from '../helpers/mocks/sharingBackend.js'
import { SupportBackend } from '../helpers/mocks/supportBackend.js'
import { MUUL_API } from '../helpers/mocks/muulAccount.js'

export interface NetworkSwitch {
  offline: () => Promise<void>
  online: () => Promise<void>
}

interface PlatformFixtures {
  sharing: SharingBackend
  support: SupportBackend
  network: NetworkSwitch
}

export const test = base.extend<PlatformFixtures>({
  sharing: async ({ muul }, provide) => {
    const backend = new SharingBackend()
    await backend.attach(muul)
    await provide(backend)
  },

  support: async ({ muul, page }, provide) => {
    await provide(await SupportBackend.install(muul, page))
  },

  network: async ({ context, page }, provide) => {
    const dead = (url: URL) => url.origin === MUUL_API
    let off = false
    await provide({
      offline: async () => {
        await page.route(dead, (route) => route.abort('internetdisconnected'))
        await context.setOffline(true)
        off = true
      },
      online: async () => {
        await page.unroute(dead)
        await context.setOffline(false)
        off = false
      },
    })
    if (off) await context.setOffline(false)
  },

  // Re-declared so every booted layer waits for every mock.
  app: async ({ page, muul: _muul, cloud: _cloud, bridge: _bridge, sharing: _sharing, support: _support }, provide) => {
    await provide(new CognitiveCanvas(page))
  },
})

export { expect }
