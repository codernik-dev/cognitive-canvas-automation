/**
 * Large-data performance: a library far bigger than the functional specs
 * use, measured through the UI.
 *
 *   PRF-004  a 200-page PDF plus 500 notes: opens, stays responsive, backs up
 *   PRF-005  Home with 100 projects: renders, and search narrows it
 *   PRF-006  a canvas with 500 notes: zoom and pan answer every time
 *   PRF-007  Find across 200 pages
 *   PRF-008  restoring the large backup
 *
 * Setup: the PDF is generated in memory (data/builders/largePdf.ts) and
 * uploaded through the UI; the 500 notes and 100 projects are written
 * straight into IndexedDB (helpers/platformDb.ts putRows) from a note or a
 * project the UI made first, so each copy has exactly the fields the app
 * writes. The app then reads them the way it reads any earlier session's
 * rows: on load.
 *
 * Every number is recorded with testInfo.annotations ("timing" / "size").
 * BUDGETS carry generous headroom on purpose: they catch an order-of-
 * magnitude regression (a render loop, a blocking import, an O(n^2) pass),
 * not a slow CI box. The machine these were written on was shared with
 * other projects' runs at 100% CPU, so the numbers recorded here are not a
 * baseline; the lead's dedicated performance run is.
 */
import { statSync } from 'node:fs'
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { putRows, snapshotAll } from '../../helpers/platformDb.js'
import { buildLargePdf } from '../../data/builders/largePdf.js'
import { exportAllLocal, restoreAndReload } from '../../workflows/backup.js'
import { BackupZip } from '../../helpers/backupZip.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page, TestInfo } from '@playwright/test'

const LARGE = buildLargePdf(200, 'Large performance fixture')
const LARGE_PDF = {
  displayName: 'automation-large',
  pageCount: LARGE.facts.pageCount,
  payload: () => ({ name: 'automation-large.pdf', mimeType: 'application/pdf', buffer: LARGE.buffer }),
}
const NOTES = 500
const PROJECTS = 100

/**
 * Budgets, in ms. Each is several times what the operation takes on an idle
 * 8-core desktop (the figures in the comments), because the gate is "not
 * broken", not "fast": the dedicated performance run sets the real baseline.
 */
const BUDGET = {
  /** 200-page upload to page 1 drawn. pdf.js parses lazily; ~2-4 s idle (40 pages took 3.1 s in run 2). */
  open200: 30_000,
  /** The 200-page text pass to finish (200 getTextContent calls). ~5-10 s idle. */
  index200: 90_000,
  /** Reopening the document with 500 notes, to the first note on screen. ~2-3 s idle. */
  reopen500: 20_000,
  /** One zoom or pan, from the input to the canvas moving (in-page). ~30-60 ms idle; the inventory asks for under 1 s. */
  interaction: 1_000,
  /** Longest frame in the second after a zoom or pan. ~60-160 ms idle with 500 notes on screen; 1 s is a visible freeze. */
  frame: 1_000,
  /** Local backup of the large project, click to file saved. ~3-5 s idle. */
  backup: 60_000,
  /** Home showing 100 project cards after a reload. ~1-2 s idle. */
  home100: 15_000,
  /** Typing into Home search to a single match. */
  search100: 3_000,
  /** Find: a word on the last of 200 pages. 40 pages took 3.5 s in run 2. */
  findLast: 45_000,
  /** Restoring the large backup, confirm to the app's reload. */
  restore: 90_000,
}

function record(testInfo: TestInfo, type: 'timing' | 'size', what: string, value: number, unit: 'ms' | 'bytes', budget?: number) {
  testInfo.annotations.push({ type, description: `${what}: ${value} ${unit}${budget !== undefined ? ` (budget ${budget} ${unit})` : ''}` })
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = Date.now()
  const value = await fn()
  return { ms: Date.now() - t0, value }
}

/** Upload the 200-page PDF into the open project; returns the time to page 1 drawn and to the full text index. */
async function uploadLarge(app: CognitiveCanvas, page: Page, testInfo: TestInfo) {
  const t0 = Date.now()
  await app.documents.uploadFiles(LARGE_PDF.payload())
  await app.viewer.expectDocumentOpen(LARGE_PDF.displayName, LARGE_PDF.pageCount)
  const open = Date.now() - t0
  record(testInfo, 'timing', 'upload 200-page PDF to page 1 drawn', open, 'ms', BUDGET.open200)
  await expect.poll(async () => (await readStore(page, 'searchText')).length, { timeout: BUDGET.index200, intervals: [500] }).toBe(LARGE_PDF.pageCount)
  const indexed = Date.now() - t0
  record(testInfo, 'timing', 'upload 200-page PDF to all 200 pages indexed', indexed, 'ms', BUDGET.index200)
  expect(open).toBeLessThan(BUDGET.open200)
}

interface NoteRow { id: string; projectId: string; documentId: string; x: number; y: number; zIndex: number; data: { content: string } }

/**
 * One note through the UI, then NOTES - 1 copies of its row in a 25-column
 * grid (world units: 260 across, 190 down) straight into IndexedDB, then a
 * reload so the app reads all 500. Returns the ids.
 */
async function seedNotes(app: CognitiveCanvas, page: Page): Promise<string[]> {
  const first = (await app.canvas.place('note', 0.1, 0.12))!
  await app.canvas.writeNote(first, 'Perf note template')
  await expectStoreCount(page, 'workspaceItems', 1, (r) => JSON.stringify(r).includes('Perf note template'))
  const template = (await readStore<NoteRow>(page, 'workspaceItems')).find((r) => r.id === first)!
  const copies = Array.from({ length: NOTES - 1 }, (_, k) => {
    const i = k + 1
    return {
      ...template,
      id: `perf-note-${String(i).padStart(3, '0')}`,
      x: template.x + (i % 25) * 260,
      y: template.y + Math.floor(i / 25) * 190,
      zIndex: template.zIndex + i,
      data: { ...template.data, content: template.data.content.replace('Perf note template', `Perf note ${i}`) },
    }
  })
  await putRows(page, { workspaceItems: copies })
  await expectStoreCount(page, 'workspaceItems', NOTES)
  return [first, ...copies.map((c) => c.id)]
}

interface Response { latency: number; longestFrame: number }

/**
 * Measure one canvas interaction inside the page, from the user's input (the
 * first pointerdown) to the canvas transform changing, plus the longest gap
 * between animation frames in the second that follows (a frozen canvas shows
 * up there). Measured in the page so Playwright's own waits (actionability,
 * polling) are not counted. The action must change the transform.
 */
async function interact(app: CognitiveCanvas, page: Page, act: () => Promise<void>): Promise<Response> {
  await page.evaluate(() => {
    const w = window as unknown as { __perf: { input: number; change: number; frames: number[] } }
    w.__perf = { input: 0, change: 0, frames: [] }
    const world = document.querySelector('[data-workspace-canvas] > div.origin-top-left')!
    const mo = new MutationObserver(() => { if (!w.__perf.change && w.__perf.input) { w.__perf.change = performance.now(); mo.disconnect() } })
    mo.observe(world, { attributes: true, attributeFilter: ['style'] })
    document.addEventListener('pointerdown', () => {
      w.__perf.input = performance.now()
      let last = w.__perf.input
      const tick = (now: number) => {
        w.__perf.frames.push(now - last)
        last = now
        if (now - w.__perf.input < 1000) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, { capture: true, once: true })
  })
  await act()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __perf: { change: number } }).__perf.change), { message: 'the canvas never moved' }).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => {
    const p = (window as unknown as { __perf: { input: number } }).__perf
    return performance.now() - p.input
  })).toBeGreaterThan(1000)
  await app.canvas.settled()
  return page.evaluate(() => {
    const p = (window as unknown as { __perf: { input: number; change: number; frames: number[] } }).__perf
    return { latency: Math.round(p.change - p.input), longestFrame: Math.round(Math.max(...p.frames)) }
  })
}

test.describe('Large data', { tag: ['@performance'] }, () => {
  test('PRF-004 a 200-page PDF with 500 notes opens, zooms, pans and backs up within budget', { tag: ['@P2', '@sanity'] }, async ({ project, app, page }, testInfo) => {
    test.setTimeout(420_000)
    await uploadLarge(app, page, testInfo)
    await seedNotes(app, page)

    const reopen = await timed(async () => {
      await app.reload()
      await app.viewer.expectDocumentOpen(LARGE_PDF.displayName, LARGE_PDF.pageCount)
      await expect(app.canvas.items.first()).toBeVisible()
    })
    record(testInfo, 'timing', 'reload to the 200-page document with 500 notes on screen', reopen.ms, 'ms', BUDGET.reopen500)
    // The backup reminder can sit over the canvas controls for a few seconds after a load; wait until Zoom in is clickable.
    await app.canvas.zoomIn.click({ trial: true })
    const zoomIn = await interact(app, page, () => app.canvas.zoomIn.click())
    record(testInfo, 'timing', 'canvas zoom in with 500 notes: input to canvas moving', zoomIn.latency, 'ms', BUDGET.interaction)
    record(testInfo, 'timing', 'canvas zoom in with 500 notes: longest frame after it', zoomIn.longestFrame, 'ms', BUDGET.frame)
    const pan = await interact(app, page, () => app.canvas.panBy(-400, -300))
    record(testInfo, 'timing', 'canvas pan with 500 notes: input to canvas moving', pan.latency, 'ms', BUDGET.interaction)
    record(testInfo, 'timing', 'canvas pan with 500 notes: longest frame during it', pan.longestFrame, 'ms', BUDGET.frame)
    const fit = await interact(app, page, () => app.canvas.fitAll.click())
    record(testInfo, 'timing', 'fit all 500 notes: input to canvas moving', fit.latency, 'ms', BUDGET.interaction)
    record(testInfo, 'timing', 'fit all 500 notes: longest frame after it', fit.longestFrame, 'ms', BUDGET.frame)
    const jump = await timed(async () => {
      await app.viewer.jumpTo(150)
      await app.viewer.expectPage(150, LARGE_PDF.pageCount)
      await app.viewer.pageRendered(150)
    })
    record(testInfo, 'timing', 'jump to page 150 drawn', jump.ms, 'ms', BUDGET.interaction * 5)

    await app.header.home.click()
    const backup = await timed(() => exportAllLocal(app, testInfo))
    const bytes = statSync(backup.value.file).size
    record(testInfo, 'timing', 'local backup of the large project', backup.ms, 'ms', BUDGET.backup)
    record(testInfo, 'size', 'backup ZIP of a 200-page PDF and 500 notes', bytes, 'bytes')
    record(testInfo, 'size', 'the 200-page PDF itself', LARGE.buffer.length, 'bytes')

    // The backup is complete, not just fast.
    const zip = BackupZip.fromFile(backup.value.file)
    const items = zip.json<NoteRow[]>('data/workspaceItems.json')
    expect(items).toHaveLength(NOTES)
    const [pdf] = zip.documentFiles(zip.manifest.projectIds[0])
    expect(Buffer.from(zip.files[pdf]).equals(LARGE.buffer)).toBe(true)
    expect(zip.manifest.projectIds).toHaveLength(1)
    expect(project.name).toBe('Automation Project')

    expect(reopen.ms).toBeLessThan(BUDGET.reopen500)
    for (const r of [zoomIn, pan, fit]) {
      expect(r.latency).toBeLessThan(BUDGET.interaction)
      expect(r.longestFrame).toBeLessThan(BUDGET.frame)
    }
    expect(backup.ms).toBeLessThan(BUDGET.backup)
  })

  test('PRF-005 Home lists 100 projects after a reload, and searching narrows them to one, within budget', { tag: '@P3' }, async ({ signedIn: app, page }, testInfo) => {
    test.setTimeout(180_000)
    await app.home.createProject('Perf Project 000')
    await app.documents.expectOpen('Perf Project 000')
    await app.documents.backToProjects.click()
    const [template] = await readStore<{ id: string; name: string; createdAt: number; updatedAt: number; lastOpenedAt: number }>(page, 'projects')
    await putRows(page, {
      projects: Array.from({ length: PROJECTS - 1 }, (_, k) => ({
        ...template,
        id: `perf-project-${String(k + 1).padStart(3, '0')}`,
        name: `Perf Project ${String(k + 1).padStart(3, '0')}`,
        createdAt: template.createdAt - (k + 1) * 1000,
        updatedAt: template.updatedAt - (k + 1) * 1000,
        lastOpenedAt: template.lastOpenedAt - (k + 1) * 1000,
      })),
    })
    const home = await timed(async () => {
      await app.reload()
      await app.home.reach()
      await expect(page.getByRole('heading', { name: `Projects (${PROJECTS})` })).toBeVisible()
      await expect(app.home.cards).toHaveCount(PROJECTS)
    })
    record(testInfo, 'timing', `Home with ${PROJECTS} projects after a reload`, home.ms, 'ms', BUDGET.home100)
    const search = await timed(async () => {
      await app.home.search.fill('Perf Project 099')
      await expect(app.home.cards).toHaveCount(1)
    })
    record(testInfo, 'timing', `search ${PROJECTS} projects down to one`, search.ms, 'ms', BUDGET.search100)
    await expect(app.home.card('Perf Project 099')).toBeVisible()
    expect(home.ms).toBeLessThan(BUDGET.home100)
    expect(search.ms).toBeLessThan(BUDGET.search100)
  })

  test('PRF-006 on a canvas holding 500 notes, ten zooms and five pans each answer within budget', { tag: '@P3' }, async ({ pdfOpen: app, page }, testInfo) => {
    test.setTimeout(240_000)
    await seedNotes(app, page)
    await app.reload()
    await app.viewer.pageRendered(1)
    await expect(app.canvas.items.first()).toBeVisible()
    // After a load the view fits all 500 notes at the smallest zoom: zoom in first, then back out, then pan.
    await app.canvas.zoomIn.click({ trial: true })
    const runs: Response[] = []
    for (let i = 0; i < 5; i++) runs.push(await interact(app, page, () => app.canvas.zoomIn.click()))
    for (let i = 0; i < 5; i++) runs.push(await interact(app, page, () => app.canvas.zoomOut.click()))
    for (let i = 0; i < 5; i++) runs.push(await interact(app, page, () => app.canvas.panBy(i % 2 ? 300 : -300, i % 2 ? 200 : -200)))
    const latency = runs.map((r) => r.latency).sort((a, b) => a - b)
    const frames = runs.map((r) => r.longestFrame).sort((a, b) => a - b)
    record(testInfo, 'timing', 'canvas interaction with 500 notes, input to canvas moving, median of 15', latency[7], 'ms', BUDGET.interaction)
    record(testInfo, 'timing', 'canvas interaction with 500 notes, input to canvas moving, slowest of 15', latency[14], 'ms', BUDGET.interaction)
    record(testInfo, 'timing', 'canvas interaction with 500 notes, longest frame, median of 15', frames[7], 'ms', BUDGET.frame)
    record(testInfo, 'timing', 'canvas interaction with 500 notes, longest frame, worst of 15', frames[14], 'ms', BUDGET.frame)
    // The notes are still drawn (not dropped), and the stored rows are untouched.
    expect(await app.canvas.items.count()).toBeGreaterThan(0)
    await expectStoreCount(page, 'workspaceItems', NOTES)
    expect(latency[14]).toBeLessThan(BUDGET.interaction)
    expect(frames[14]).toBeLessThan(BUDGET.frame)
  })

  test('PRF-007 Find across 200 pages finds the word on the last page and counts a word on every page, within budget', { tag: '@P3' }, async ({ project: _p, app, page }, testInfo) => {
    test.setTimeout(240_000)
    await uploadLarge(app, page, testInfo)
    await app.viewer.tool('find').click()
    const last = await timed(async () => {
      await app.find.search(LARGE.facts.lastPageMarker)
      await app.find.expectCount(1, 1)
    })
    record(testInfo, 'timing', 'find a word on page 200 of 200', last.ms, 'ms', BUDGET.findLast)
    const every = await timed(async () => {
      await app.find.search(LARGE.facts.everyPageWord)
      await expect(app.find.counter).toHaveText(`1 of ${LARGE_PDF.pageCount}`, { timeout: BUDGET.findLast })
    })
    record(testInfo, 'timing', 'find a word on each of 200 pages', every.ms, 'ms', BUDGET.findLast)
    const one = await timed(async () => {
      await app.find.search(LARGE.facts.marker(137))
      await app.find.expectCount(1, 1)
    })
    record(testInfo, 'timing', 'find the marker of page 137', one.ms, 'ms', BUDGET.findLast)
    expect(last.ms).toBeLessThan(BUDGET.findLast)
    expect(every.ms).toBeLessThan(BUDGET.findLast)
  })

  test('PRF-008 restoring the backup of a 200-page PDF with 500 notes brings it all back within budget', { tag: '@P3' }, async ({ project, app, page }, testInfo) => {
    test.setTimeout(420_000)
    await uploadLarge(app, page, testInfo)
    await seedNotes(app, page)
    await app.header.home.click()
    const { file } = await exportAllLocal(app, testInfo)
    const before = await snapshotAll(page)
    await app.home.deleteProject(project.name)
    await expectStoreCount(page, 'workspaceItems', 0)
    const restore = await timed(async () => {
      await restoreAndReload(app, page, file)
      await app.home.reach()
      await expect(app.home.card(project.name)).toBeVisible()
    })
    record(testInfo, 'timing', 'restore the large backup to the project on Home', restore.ms, 'ms', BUDGET.restore)
    await expectStoreCount(page, 'workspaceItems', NOTES)
    const after = await snapshotAll(page)
    expect(after.rows.documents!.map((d) => (d.data as { __sha256: string }).__sha256)).toEqual(before.rows.documents!.map((d) => (d.data as { __sha256: string }).__sha256))
    const open = await timed(async () => {
      await app.home.openProject(project.name)
      await app.documents.openDocument(LARGE_PDF.displayName)
      await app.viewer.expectDocumentOpen(LARGE_PDF.displayName, LARGE_PDF.pageCount)
      await expect(app.canvas.items.first()).toBeVisible()
    })
    record(testInfo, 'timing', 'open the restored 200-page document with 500 notes', open.ms, 'ms', BUDGET.reopen500)
    expect(restore.ms).toBeLessThan(BUDGET.restore)
  })
})
