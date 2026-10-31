/**
 * `test` for the signed-in / plan-dependent backup specs: fixtures/account.ts
 * (a mocked MuulOrigin account, plan `muulPlan`, default 'pro') plus
 *
 *   cloud      the stateful fake cloud backup store (helpers/mocks/cloudBackups.ts),
 *              installed before the app opens on every test of this file
 *   moBrowser  option: a BridgeSeed (repositories, folders) to run the test
 *              "inside MoBrowser", or null (default) for an ordinary browser
 *   bridge     the MoBrowser host stub (helpers/mocks/moBrowserBridge.ts);
 *              only wired into the page when `moBrowser` is set
 *   ui         the Data Center panels and the other backup screens
 *
 * Specs that need no account (the Local .zip export/restore) keep using
 * fixtures/test.ts, so the app runs exactly as a signed-out browser.
 */
import { test as base, expect } from './account.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { CloudBackupStore } from '../helpers/mocks/cloudBackups.js'
import { MoBrowserBridge, type BridgeSeed } from '../helpers/mocks/moBrowserBridge.js'
import { BackupUi } from '../pages/BackupScreens.js'

interface BackupOptions {
  moBrowser: BridgeSeed | null
}

interface BackupFixtures {
  cloud: CloudBackupStore
  bridge: MoBrowserBridge
  ui: BackupUi
}

export const test = base.extend<BackupOptions & BackupFixtures>({
  moBrowser: [null, { option: true }],

  cloud: async ({ muul, page }, provide) => {
    await provide(await CloudBackupStore.install(muul, page))
  },

  bridge: async ({ context, moBrowser }, provide) => {
    await provide(moBrowser ? await MoBrowserBridge.install(context, moBrowser) : await MoBrowserBridge.detached())
  },

  ui: async ({ page }, provide) => {
    await provide(new BackupUi(page))
  },

  // Re-declared so every booted layer waits for the cloud store and the bridge.
  app: async ({ page, muul: _muul, cloud: _cloud, bridge: _bridge }, provide) => {
    await provide(new CognitiveCanvas(page))
  },
})

export { expect }
