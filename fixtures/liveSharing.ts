/**
 * `test` for the LIVE sharing specs: the live fixture (fixtures/live.ts), whose
 * main page is the TEACHER (the QA account, on a paid plan), plus real
 * recipient accounts (CC_LIVE_STUDENTS, on the Free plan):
 *
 *   teacher      the teacher as the server knows them (id, email, name).
 *   students(n)  n student devices: each its own browser context signed in to
 *                its own real account, routed like the teacher's (MuulOrigin
 *                only, this build at the app's address), booted to Home.
 *   nameTag      the run tag as a project or class name accepts it (letters
 *                and digits). Put it in every project and class name.
 *
 * Teardown, whether the test passed or not: what this test created on the
 * real server, found by its nameTag, is removed - the teacher's live shares,
 * sent copies and classes, and each student's received notes. Nothing else on
 * these accounts is touched. Each student's page is screenshotted on failure.
 * Before a test, anything an earlier run's interrupted cleanup left (any run
 * tag) is swept the same way, so a fresh student device never imports it.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test as base, expect, newLiveSession, installLiveRoutes, LIVE_ORIGIN } from './live.js'
import { ENV } from '../config/env.js'
import { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import { LiveApi, ANY_RUN_TAG, type Identity } from '../helpers/live/sharingApi.js'

export interface StudentDevice extends Identity {
  context: BrowserContext
  page: Page
  app: CognitiveCanvas
}

interface LiveSharingFixtures {
  teacher: Identity
  students: (n: number) => Promise<StudentDevice[]>
  nameTag: string
  sharingCleanup: void
}

/**
 * A fresh profile on the real app address: PIN, the real content catalog it
 * opens with first, then Home. If the server is shedding requests at that
 * moment, the app says "Can't reach MuulOrigin" over the PIN pad: wait it out
 * (up to 90 s) rather than click through it.
 */
export async function bootLive(app: CognitiveCanvas) {
  await app.open()
  await expect(app.page.getByText('Can\'t reach MuulOrigin', { exact: true }), 'the real server answers').toHaveCount(0, { timeout: 90_000 })
  await app.pinSetup.createPin()
  await expect(app.page.getByRole('heading', { name: 'Explore Content' })).toBeVisible({ timeout: 60_000 })
  await app.home.reach()
}

export const test = base.extend<LiveSharingFixtures>({
  nameTag: async ({ run }, provide) => provide(run.tag.replace(/[^A-Za-z0-9]/g, '')),

  // Before every test, sweep any earlier run's leftovers; after it, remove what this test sent. Both run while
  // no page of the teacher's is open (set up first, torn down last), so they never race the app's own session refresh.
  sharingCleanup: [
    async ({ context, run }, provide, testInfo) => {
      const swept = await new LiveApi(context).removeSent(ANY_RUN_TAG)
      if (swept !== 'nothing to remove') await testInfo.attach('live-sharing-swept-teacher.txt', { body: swept, contentType: 'text/plain' })
      await provide()
      const tag = run.tag.replace(/[^A-Za-z0-9]/g, '')
      const summary = await new LiveApi(context).removeSent(tag).catch((e: Error) => `cleanup failed: ${e.message}`)
      await testInfo.attach('live-sharing-cleanup-teacher.txt', { body: summary, contentType: 'text/plain' })
    },
    { auto: true },
  ],

  // Read before the teacher's app boots (the test body boots it).
  teacher: async ({ context }, provide) => {
    await provide(await new LiveApi(context).me())
  },

  students: async ({ browser, nameTag }, provide, testInfo) => {
    const opened: { device: StudentDevice; dispose: () => void }[] = []
    const errors: string[] = []
    await provide(async (n) => {
      if (opened.length) throw new Error('students() opens every student device at once: call it once per test')
      test.skip(ENV.liveStudents.length < n || !ENV.liveStudentPassword, `Needs ${n} student account(s): set CC_LIVE_STUDENTS and CC_LIVE_STUDENT_PASSWORD`)
      for (const email of ENV.liveStudents.slice(0, n)) {
        const session = await newLiveSession({ email, password: ENV.liveStudentPassword! })
        const context = await browser.newContext({
          baseURL: LIVE_ORIGIN,
          storageState: session.file,
          viewport: { width: 1366, height: 800 },
          locale: 'en-US',
          timezoneId: 'UTC',
          colorScheme: 'light',
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        })
        await installLiveRoutes(context, false)
        const api = new LiveApi(context)
        const identity = await api.me()
        const swept = await api.removeReceived(ANY_RUN_TAG)
        if (swept !== 'nothing to remove') await testInfo.attach(`live-sharing-swept-${email}.txt`, { body: swept, contentType: 'text/plain' })
        const page = await context.newPage()
        page.on('pageerror', (e) => errors.push(`[${identity.email}] ${e.name}: ${e.message}`))
        opened.push({ device: { ...identity, context, page, app: new CognitiveCanvas(page) }, dispose: session.dispose })
      }
      const devices = opened.map((o) => o.device)
      for (const d of devices) await bootLive(d.app)
      return devices
    })
    const failed = testInfo.status !== testInfo.expectedStatus
    const summary: string[] = []
    for (const { device, dispose } of opened) {
      if (failed) await testInfo.attach(`student-${device.email}.png`, { body: await device.page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)), contentType: 'image/png' })
      await device.page.close()
      summary.push(`${device.email}:\n${await new LiveApi(device.context).removeReceived(nameTag).catch((e: Error) => `cleanup failed: ${e.message}`)}`)
      await device.context.close()
      dispose()
    }
    if (opened.length) await testInfo.attach('live-sharing-cleanup-students.txt', { body: summary.join('\n\n'), contentType: 'text/plain' })
    if (errors.length) await testInfo.attach('student-page-errors.txt', { body: errors.join('\n\n'), contentType: 'text/plain' })
    if (!failed) expect(errors, 'uncaught exceptions in a student\'s page').toEqual([])
  },
})

export { expect }
