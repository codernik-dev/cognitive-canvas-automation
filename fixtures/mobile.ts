/**
 * `test` for the phone / tablet / iPad specs (tests/responsive/*). Same
 * layers as fixtures/test.ts (app, signedIn, project, pdfOpen), plus:
 *
 *   mobile          page objects for the phone shell (pages/MobileShell.ts)
 *   ws              the phone workspace: mode switch, status bar, tool dials
 *                   (components/MobileWorkspace.ts)
 *   viewNoticeSeen  option, default true: the touch-device "You're viewing in
 *                   … view" notice (ViewModeNotification) counts as already
 *                   dismissed, by writing the app's own dismissal key before
 *                   boot. On a phone the notice sits over the header for 7 s
 *                   and would cover the Menu button; the one spec about the
 *                   notice sets this to false.
 *
 * `backupTest` is the same on top of fixtures/backup.ts (mocked MuulOrigin
 * account `muul` with `muulPlan`, the fake cloud store `cloud`, the MoBrowser
 * host stub `bridge` with option `moBrowser`), for the signed-in and Data
 * Center specs; with option `muulAndroid` it runs inside the stubbed
 * Muul-Android WebView host (`android`, helpers/mocks/mobileAndroid.ts).
 * `sharingTest` is the same on top of fixtures/sharing.ts (the sharing fake
 * `sharing`, `secondUser`).
 */
import type { Page } from '@playwright/test'
import { test as base, expect } from './test.js'
import { test as backupBase } from './backup.js'
import { test as sharingBase } from './sharing.js'
import { MuulAndroidHost, type MuulAndroidOptions } from '../helpers/mocks/mobileAndroid.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { baseURL } from '../config/env.js'
import { MobileShell } from '../pages/MobileShell.js'
import { MobileWorkspace } from '../components/MobileWorkspace.js'

interface MobileOptions {
  viewNoticeSeen: boolean
}

interface MobileFixtures {
  mobile: MobileShell
  ws: MobileWorkspace
}

const APP_ORIGIN = new URL(baseURL).origin

/** The fingerprint ViewModeNotification stores on dismissal: same UA test as the app's. */
async function markViewNoticeSeen(page: Page) {
  await page.addInitScript((appOrigin) => {
    // Only the app's own pages: an error page (a blocked off-origin navigation) denies storage.
    if (location.origin !== appOrigin) return
    if (sessionStorage.getItem('__e2e_view_notice')) return
    sessionStorage.setItem('__e2e_view_notice', '1')
    const mobileUA = /Mobile|iPhone|iPod|Android.+Mobile|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    localStorage.setItem('cc2_view_alerted_at', mobileUA ? 'mobile-view' : 'desktop-view')
  }, APP_ORIGIN)
}

export const test = base.extend<MobileOptions & MobileFixtures>({
  viewNoticeSeen: [true, { option: true }],
  mobile: async ({ page, viewNoticeSeen }, provide) => {
    if (viewNoticeSeen) await markViewNoticeSeen(page)
    await provide(new MobileShell(page))
  },
  ws: async ({ page }, provide) => {
    await provide(new MobileWorkspace(page))
  },
  // Re-declared so the boot layers start after the notice key is written.
  app: async ({ page, mobile: _mobile }, provide) => {
    await provide(new CognitiveCanvas(page))
  },
})

interface AndroidOptions {
  /** Run "inside the Muul-Android app": the stubbed RN WebView host (helpers/mocks/mobileAndroid.ts). Needs `moBrowser` for its message bridge. Default null. */
  muulAndroid: MuulAndroidOptions | null
}

interface AndroidFixtures {
  android: MuulAndroidHost
}

export const backupTest = backupBase.extend<MobileOptions & MobileFixtures & AndroidOptions & AndroidFixtures>({
  viewNoticeSeen: [true, { option: true }],
  muulAndroid: [null, { option: true }],
  mobile: async ({ page, viewNoticeSeen }, provide) => {
    if (viewNoticeSeen) await markViewNoticeSeen(page)
    await provide(new MobileShell(page))
  },
  ws: async ({ page }, provide) => {
    await provide(new MobileWorkspace(page))
  },
  android: async ({ context, muulAndroid }, provide) => {
    await provide(muulAndroid ? await MuulAndroidHost.install(context, APP_ORIGIN, muulAndroid) : MuulAndroidHost.detached())
  },
  app: async ({ page, mobile: _mobile, muul: _muul, cloud: _cloud, bridge: _bridge, android: _android }, provide) => {
    await provide(new CognitiveCanvas(page))
  },
})

/** fixtures/sharing.ts (the stateful sharing fake + `secondUser`) with the phone page objects. */
export const sharingTest = sharingBase.extend<MobileOptions & MobileFixtures>({
  viewNoticeSeen: [true, { option: true }],
  mobile: async ({ page, viewNoticeSeen }, provide) => {
    if (viewNoticeSeen) await markViewNoticeSeen(page)
    await provide(new MobileShell(page))
  },
  ws: async ({ page }, provide) => {
    await provide(new MobileWorkspace(page))
  },
  app: async ({ page, mobile: _mobile, sharing: _sharing }, provide) => {
    await provide(new CognitiveCanvas(page))
  },
})

export { expect }
