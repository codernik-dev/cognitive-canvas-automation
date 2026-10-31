/**
 * A real browser profile on disk, for the "closed the browser and opened it
 * again" case: chromium.launchPersistentContext on a fresh temporary
 * user-data directory, with the same isolation the shared fixtures give
 * (desktop viewport, en-US/UTC, reduced motion, no service worker, the
 * network guard, Chromium's fake camera and microphone, and a record of
 * uncaught page errors). The directory is removed by `dispose()`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { baseURL } from '../config/env.js'

const APP_ORIGIN = new URL(baseURL).origin

export interface BrowserProfile {
  dir: string
  /** Start the browser on the profile; resolves with its context and first page. */
  launch: () => Promise<{ context: BrowserContext; page: Page }>
  /** Uncaught page errors across every launch. */
  errors: string[]
  /** Requests the network guard refused, across every launch. */
  blocked: string[]
  /** Close a running context (if any) and delete the profile directory. */
  dispose: () => Promise<void>
}

export function browserProfile(): BrowserProfile {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cc-platform-profile-'))
  const errors: string[] = []
  const blocked: string[] = []
  let current: BrowserContext | null = null
  return {
    dir,
    errors,
    blocked,
    launch: async () => {
      const context = await chromium.launchPersistentContext(dir, {
        headless: true,
        baseURL,
        viewport: { width: 1366, height: 800 },
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        permissions: ['camera', 'microphone'],
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
      })
      current = context
      context.on('close', () => { if (current === context) current = null })
      await context.route(
        (url) => url.origin !== APP_ORIGIN && url.protocol !== 'data:' && url.protocol !== 'blob:',
        (route) => { blocked.push(`${route.request().method()} ${route.request().url()}`); return route.abort('blockedbyclient') },
      )
      const watch = (p: Page) => p.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
      context.pages().forEach(watch)
      context.on('page', watch)
      const page = context.pages()[0] ?? (await context.newPage())
      return { context, page }
    },
    dispose: async () => {
      if (current) await current.close()
      // Chromium can hold a file in the profile for a moment after it exits (Windows EPERM/EBUSY): let Node retry the removal.
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    },
  }
}
