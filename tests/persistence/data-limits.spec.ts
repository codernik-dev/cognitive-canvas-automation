/**
 * Data limits: the longest names the app accepts, very large notes, and a
 * device that runs out of storage.
 *
 * Storage exhaustion is emulated at the browser level, not by patching the
 * app: Chromium's DevTools protocol `Storage.overrideQuotaForOrigin` gives
 * the app's origin a quota just above what it already uses, so the browser
 * itself reports the device as full (navigator.storage.estimate) and refuses
 * IndexedDB writes with QuotaExceededError, as a full disk would.
 */
import { test, expect } from '../../fixtures/test.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { exportAllLocal, restoreAndReload, bootToHome } from '../../workflows/backup.js'
import { buildTextPdf } from '../../data/builders/pdf.js'
import { FIND_PDF } from '../../data/files.js'
import { baseURL } from '../../config/env.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page } from '@playwright/test'

const NAME_100 = `Long Name ${'Abcdefghij'.repeat(9)}`
const NAME_101 = `${NAME_100}X`

interface NoteRow { id: string; type: string; data: { content: string } }

/** Put `text` into a note through its editor in one input event (typing a megabyte key by key would take hours). */
async function writeLargeNote(app: CognitiveCanvas, page: Page, id: string, text: string) {
  const dialog = await app.canvas.openNoteEditor(id)
  await dialog.locator('[contenteditable="true"]').first().click()
  await page.keyboard.insertText(text)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

async function noteLength(page: Page, id: string): Promise<number> {
  const row = (await readStore<NoteRow>(page, 'workspaceItems')).find((r) => r.id === id)
  return row?.data.content.length ?? 0
}

/**
 * A device with only `bytes` of storage for the app's origin. Chromium fixes
 * an origin's quota when the origin first uses storage, so this must run
 * BEFORE the app opens; the override then holds until `room()` lifts it. A
 * single write larger than what is left fails with QuotaExceededError.
 */
async function smallDevice(page: Page, bytes: number) {
  const cdp = await page.context().newCDPSession(page)
  const origin = new URL(baseURL).origin
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: bytes })
  return {
    room: () => cdp.send('Storage.overrideQuotaForOrigin', { origin }),
    release: () => cdp.detach(),
  }
}

const DEVICE_BYTES = 1_000_000

/** A real, parseable PDF of about 2 MB: thirty pages of long lines. */
function twoMegabytePdf(name: string) {
  const line = 'Storage limit filler text that makes this page heavy. '.repeat(33)
  const pages = Array.from({ length: 30 }, (_, i) => ({ heading: `Heavy page ${i + 1}`, lines: Array.from({ length: 40 }, () => line) }))
  return { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: buildTextPdf(pages, 'Heavy') }
}

test.describe('Data limits', { tag: ['@regression', '@persistence'] }, () => {
  test('PST-021 a project name of exactly 100 characters is accepted and kept in full; a 101st character is not taken, on create or on rename', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    expect(NAME_100).toHaveLength(100)
    // The field takes 100 characters and no more: the 101st is not accepted.
    await app.home.newProjectName.fill(NAME_101)
    await expect(app.home.newProjectName).toHaveValue(NAME_100)
    await expect(app.home.nameError).toHaveCount(0)
    await app.home.newProjectName.fill('')
    await app.home.createProject(NAME_100)
    await app.documents.expectOpen(NAME_100)
    expect((await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual([NAME_100])
    await app.reload()
    await app.home.reach()
    await expect(app.home.card(NAME_100)).toBeVisible()

    await app.home.cardAction(NAME_100, 'Rename')
    const input = app.home.cards.getByRole('textbox')
    await expect(input).toHaveValue(NAME_100)
    await input.press('End')
    await page.keyboard.type('X')
    await expect(input).toHaveValue(NAME_100)
    await input.press('Enter')
    await expect(app.home.card(NAME_100)).toBeVisible()
    expect((await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual([NAME_100])
  })

  test('PST-022 a document with a 180-character file name uploads, keeps its whole name, and still has it after a reload', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    const base = `automation-${'longname'.repeat(22)}`.slice(0, 180)
    expect(base).toHaveLength(180)
    await app.documents.uploadFiles({ name: `${base}.pdf`, mimeType: 'application/pdf', buffer: FIND_PDF.payload().buffer })
    await app.viewer.expectDocumentOpen(base, FIND_PDF.pageCount)
    expect((await readStore<{ name: string }>(page, 'documents')).map((d) => d.name)).toEqual([base])
    await app.reload()
    await app.viewer.expectDocumentOpen(base, FIND_PDF.pageCount)
    await app.viewer.backToDocuments.click()
    await expect(app.documents.card(base)).toContainText(base)
  })

  test('PST-023 a note holding a megabyte of text saves, comes back whole after a reload, and survives a backup and restore', { tag: '@P2' }, async ({ pdfOpen: app, page, project }, testInfo) => {
    test.setTimeout(240_000)
    const text = `MEGASTART ${'Large note body text. '.repeat(48_000)} MEGAEND`
    expect(text.length).toBeGreaterThan(1_000_000)
    const id = (await app.canvas.place('note', 0.5, 0.4))!
    await writeLargeNote(app, page, id, text)
    await expect.poll(() => noteLength(page, id), { timeout: 30_000 }).toBeGreaterThan(text.length)
    const stored = (await readStore<NoteRow>(page, 'workspaceItems')).find((r) => r.id === id)!.data.content
    expect(stored).toContain('MEGASTART')
    expect(stored).toContain('MEGAEND')

    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(app.canvas.item(id)).toContainText('MEGASTART')
    expect((await readStore<NoteRow>(page, 'workspaceItems')).find((r) => r.id === id)!.data.content).toBe(stored)

    await app.header.home.click()
    const { file } = await exportAllLocal(app, testInfo)
    await app.home.deleteProject(project.name)
    await restoreAndReload(app, page, file)
    await app.home.reach()
    await expectStoreCount(page, 'workspaceItems', 1)
    expect((await readStore<NoteRow>(page, 'workspaceItems')).find((r) => r.id === id)!.data.content).toBe(stored)
  })

  test('PST-024 a note longer than four million characters survives a backup and restore instead of being silently left out', { tag: '@P2' }, async ({ pdfOpen: app, page, project }, testInfo) => {
    knownDefect('DEF-908')
    test.setTimeout(300_000)
    const text = `HUGESTART ${'Very large note body. '.repeat(200_000)} HUGEEND`
    expect(text.length).toBeGreaterThan(4 * 1024 * 1024)
    const id = (await app.canvas.place('note', 0.5, 0.4))!
    await writeLargeNote(app, page, id, text)
    await expect.poll(() => noteLength(page, id), { timeout: 60_000 }).toBeGreaterThan(text.length)
    const stored = (await readStore<NoteRow>(page, 'workspaceItems')).find((r) => r.id === id)!.data.content

    await app.header.home.click()
    const { file } = await exportAllLocal(app, testInfo)
    await app.home.deleteProject(project.name)
    await restoreAndReload(app, page, file)
    await app.home.reach()
    await expect(app.home.card(project.name)).toBeVisible()
    // The project came back; the note must come back with it.
    await expectStoreCount(page, 'workspaceItems', 1)
    expect((await readStore<NoteRow>(page, 'workspaceItems')).find((r) => r.id === id)!.data.content).toBe(stored)
  })

  test('PST-025 when the device is out of storage, an upload says the device is full and nothing is half-saved; with room again the same file goes in', { tag: '@P2' }, async ({ app, page }) => {
    knownDefect('DEF-909')
    const device = await smallDevice(page, DEVICE_BYTES)
    await bootToHome(app)
    await app.home.createProject('Full Device')
    await app.documents.expectOpen('Full Device')
    const pdf = twoMegabytePdf('automation-no-room')
    expect(pdf.buffer.length).toBeGreaterThan(2 * DEVICE_BYTES)
    await app.documents.uploadFiles(pdf)
    // Whatever the app says is recorded for the report, then held to the app's own words for a full device.
    await expect(app.toasts.container).toContainText(/\S/, { timeout: 30_000 })
    test.info().annotations.push({ type: 'observed toast', description: await app.toasts.container.innerText() })
    await app.toasts.expectShown(/storage is (almost )?full/i)
    await expect(app.toasts.withText(/quota|QuotaExceeded|transaction/i)).toHaveCount(0)
    await expect(app.documents.emptyState).toBeVisible()
    expect(await readStore(page, 'documents')).toEqual([])
    expect(await readStore(page, 'searchText')).toEqual([])
    expect(await readStore(page, 'binaryIndex')).toEqual([])

    await device.room()
    await app.documents.uploadFiles(pdf)
    await app.viewer.expectDocumentOpen('automation-no-room', 30)
    await expectStoreCount(page, 'documents', 1)
    await device.release()
  })

  test('PST-026 when storage runs out while working, the app says the change could not be saved and saves it once there is room, so nothing is lost', { tag: ['@P1'] }, async ({ app, page }) => {
    const device = await smallDevice(page, DEVICE_BYTES)
    await bootToHome(app)
    await app.home.createProject('Full Disk Notes')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const note = (await app.canvas.place('note', 0.5, 0.4))!
    await expectStoreCount(page, 'workspaceItems', 1)
    // More text than the device has room for.
    const text = `FULLDISKSTART ${'Words that no longer fit on the device. '.repeat(40_000)} FULLDISKEND`
    expect(text.length).toBeGreaterThan(DEVICE_BYTES)
    await writeLargeNote(app, page, note, text)
    await app.toasts.expectShown("Couldn't save 1 item — retrying. Avoid closing the app.", 30_000)
    expect(await noteLength(page, note)).toBeLessThan(1000)
    await expect(app.canvas.item(note)).toContainText('FULLDISKSTART')

    // Room again: the retry lands the whole note.
    await device.room()
    await expect.poll(() => noteLength(page, note), { timeout: 30_000 }).toBeGreaterThan(text.length)
    await device.release()
    await app.reload()
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect(app.canvas.item(note)).toContainText('FULLDISKSTART')
    expect((await readStore<NoteRow>(page, 'workspaceItems'))[0].data.content).toContain('FULLDISKEND')
  })
})
