/**
 * Cognitive Canvas automation suite (README.md).
 *
 * Runs against the production build in app/dist (npm run sync-app), served by
 * scripts/serve-dist.mjs, the same server the legacy e2e/ suite uses:
 *
 *   npm run sync-app -- <app folder>
 *   npm run smoke | sanity | regression | all
 *
 * Isolation: every test gets a fresh browser context, so its own IndexedDB,
 * localStorage and sessionStorage. Nothing is shared between tests, which is
 * why the suite runs fully parallel.
 */
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { ENV, DIST_DIR, baseURL, assertSafeBaseUrl, reportsFolder } from './config/env.js'

assertSafeBaseUrl(baseURL)

// Relative to this file, like every path in a Playwright config. The performance
// run writes to its own folder so it never overwrites the regression run's reports;
// CC_REPORTS_DIR gives any other concurrent run its own folder too.
const REPORTS = reportsFolder

// Desktop baseline: the viewport the app's split-pane layout is designed around.
const desktop = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1366, height: 800 },
}

// Chromium's fake camera/mic: a test pattern and a beep, no prompt.
const fakeMedia = {
  permissions: ['camera', 'microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], slowMo: ENV.slowMo },
}

export default defineConfig({
  testDir: 'tests',
  outputDir: `${REPORTS}/test-results`,
  globalSetup: './config/global-setup.ts',
  // Slow motion (CC_SLOWMO, for watching a run) multiplies every action's time, so it gets more room.
  timeout: ENV.slowMo ? 900_000 : 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: ENV.workers,
  forbidOnly: ENV.ci,
  // One CI retry exists only to capture a trace of a failure; failOnFlakyTests
  // keeps a pass-on-retry red, so a retry can never hide instability.
  retries: ENV.ci ? 1 : 0,
  failOnFlakyTests: true,
  reporter: [
    [ENV.ci ? 'github' : 'list'],
    ['html', { outputFolder: `${REPORTS}/html`, open: 'never' }],
    ['junit', { outputFile: `${REPORTS}/junit.xml` }],
    ['json', { outputFile: `${REPORTS}/results.json` }],
    // Custom reporters get raw options: give this one an absolute path.
    ['./config/summary-reporter.ts', { outputFile: path.resolve(import.meta.dirname, REPORTS, 'summary.md') }],
  ],
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    // Switches off the app's screen/modal entrance animations (styles/animations.css).
    contextOptions: { reducedMotion: 'reduce' },
    // The app's service worker would serve requests the network guard never
    // sees. Only the offline project allows it.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: ENV.baseUrlOverride
    ? undefined
    : {
        command: `node scripts/serve-dist.mjs ${ENV.port} "${DIST_DIR}"`,
        url: `${baseURL}/`,
        reuseExistingServer: !ENV.ci,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'chromium',
      testIgnore: [/\.phone\.spec\.ts$/, /\.tablet\.spec\.ts$/, /\.ipad\.spec\.ts$/, /tests[\\/]offline[\\/]/, /tests[\\/]performance[\\/]/, /tests[\\/]live[\\/]/],
      use: { ...desktop, ...fakeMedia },
    },
    {
      name: 'phone',
      testMatch: /\.phone\.spec\.ts$/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'tablet',
      testMatch: /\.tablet\.spec\.ts$/,
      // iPad-sized Chromium with touch. NOT a substitute for Safari on a real iPad (08-DEFECTS-AND-LIMITATIONS.md).
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: false },
    },
    {
      name: 'ipad',
      testMatch: /\.ipad\.spec\.ts$/,
      // Playwright's WebKit with the iPad user agent, viewport and touch: the
      // closest a browser run gets to Safari on iPad. Not a real iPad or Apple
      // Pencil (08-DEFECTS-AND-LIMITATIONS.md).
      use: { ...devices['iPad Pro 11'] },
    },
    {
      name: 'offline',
      testMatch: /tests[\\/]offline[\\/].*\.spec\.ts$/,
      use: { ...desktop, serviceWorkers: 'allow' },
    },
    // Timing budgets mean nothing under parallel load (run 2: 3.8 s alone, 16.6 s
    // beside three busy workers). Run on its own: npm run test:performance (one worker).
    {
      name: 'performance',
      testMatch: /tests[\\/]performance[\\/].*\.spec\.ts$/,
      use: { ...desktop },
    },
    // LIVE: the build under test against the real MuulOrigin servers with the QA
    // account (fixtures/live.ts). Opt-in only (npm run test:live), never in the
    // regression run. Traces off: a trace records request bodies, and these hold
    // a real session. Screenshots and video still show what went wrong. The fake
    // camera/mic: the live sharing tests record a video note.
    {
      name: 'live',
      testMatch: /tests[\\/]live[\\/].*\.live\.spec\.ts$/,
      // 8 minutes: the real server's list of the teacher's live shares takes about 42 s (DEF-516, and it grows
      // with every live share made), and each sharing test reads it at least twice, in its set-up and clean-up.
      timeout: 480_000,
      use: { ...desktop, ...fakeMedia, trace: 'off' },
    },
    // Cross-browser: the smoke suite only, on the scheduled run (07-EXECUTION-GUIDE.md).
    {
      name: 'firefox',
      testMatch: /tests[\\/]smoke[\\/].*\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 800 } },
    },
    {
      name: 'webkit',
      testMatch: /tests[\\/]smoke[\\/].*\.spec\.ts$/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 800 } },
    },
  ],
})
