/**
 * Every environment-dependent value the framework reads, in one place.
 * Specs and page objects import from here; nothing else reads process.env.
 */

import path from 'node:path'

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback)

export const ENV = {
  /** True on GitHub Actions (or any CI that sets CI=true). */
  ci: !!process.env.CI,
  /** Port the bundled static server (scripts/serve-dist.mjs) listens on. */
  port: num(process.env.CC_PORT, 4173),
  /**
   * Point the suite at an already-running build instead of starting one.
   * Only local/staging hosts are allowed: see assertSafeBaseUrl below.
   */
  baseUrlOverride: process.env.CC_BASE_URL,
  /** PIN every fresh profile is set up with. Not a secret: it lives only in a throwaway browser context. */
  testPin: process.env.CC_TEST_PIN ?? '135790',
  /**
   * Parallel workers. Tests are independent (own context and IndexedDB), but pdf.js
   * rendering plus trace/video recording is CPU-heavy: on a shared 8-core machine 4
   * workers starved PDF loads (09-FINAL-QA-REPORT.md), 2 were reliable. Raise with
   * CC_WORKERS=4 on a quiet machine.
   */
  workers: num(process.env.CC_WORKERS, 2),
  /**
   * Report and artifact folder, relative to automation/. Unset: reports/ (or
   * reports/performance for the performance project). Set it when two runs
   * share a machine, or the second run's start wipes the first one's artifacts.
   */
  reportsDir: process.env.CC_REPORTS_DIR || undefined,
  /** Milliseconds to pause before each browser action, to watch a run (--headed). 0 = full speed. */
  slowMo: num(process.env.CC_SLOWMO, 0),
  /**
   * The live project (tests/live) runs against the REAL MuulOrigin servers with a
   * dedicated QA account. Both values come from the environment only (a local
   * shell, or CI secrets) and are never written to a file, a log or a report.
   * Unset: every live test is skipped.
   */
  liveEmail: process.env.CC_LIVE_EMAIL || undefined,
  livePassword: process.env.CC_LIVE_PASSWORD || undefined,
  /**
   * Live sharing (tests/live/*sharing*.live.spec.ts): the accounts that RECEIVE,
   * comma-separated emails of real MuulOrigin users on the Free plan, with one
   * password for all of them. The QA account above is the teacher, so it must
   * be on a paid plan. Environment only, like the QA account. Unset: the
   * sharing tests that need a student are skipped.
   */
  liveStudents: (process.env.CC_LIVE_STUDENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  liveStudentPassword: process.env.CC_LIVE_STUDENT_PASSWORD || undefined,
} as const

/** This repository's root. */
export const AUTOMATION_DIR = path.resolve(import.meta.dirname, '..')
/**
 * The app under test: app/ (the snapshot npm run sync-app makes, git-ignored), or
 * a full checkout of the app named by CC_APP_DIR. Both have the same layout.
 */
export const APP_DIR = process.env.CC_APP_DIR ? path.resolve(process.env.CC_APP_DIR) : path.join(AUTOMATION_DIR, 'app')
export const DIST_DIR = path.join(APP_DIR, 'dist')

export const baseURL = ENV.baseUrlOverride ?? `http://127.0.0.1:${ENV.port}`

/** This run's report folder, relative to automation/ (see ENV.reportsDir). */
export const reportsFolder = ENV.reportsDir ?? (process.argv.includes('--project=performance') ? 'reports/performance' : 'reports')

/**
 * Refuse to run against anything that looks like production. The suite
 * creates and deletes projects, wipes IndexedDB and restores backups: on a
 * real user's origin that would destroy data.
 */
export function assertSafeBaseUrl(url: string) {
  const host = new URL(url).hostname
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')
  if (!local && process.env.CC_ALLOW_REMOTE_BASE_URL !== '1') {
    throw new Error(
      `Refusing to run the automation suite against ${url}. It deletes local data. ` +
        'Use a local build, or set CC_ALLOW_REMOTE_BASE_URL=1 for a disposable staging host.',
    )
  }
}

/** Hosts the app talks to in production. The network guard blocks them unless a spec opts in to a mock. */
export const EXTERNAL_HOSTS = ['api.muulorigin.com', 'www.muulorigin.com', 'muulorigin.com', 'github.com', 'api.github.com', 'amazonaws.com']
