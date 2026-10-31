/**
 * Regression: audio notes, document embeds and the camera scanner.
 * The fake camera/microphone come from Chromium flags (playwright.config.ts);
 * they prove the browser-side flow, not real hardware (08-DEFECTS-AND-LIMITATIONS.md).
 *
 * Audio notes are checked end to end: the stored item (position, name,
 * source, MIME type, duration), the stored bytes, and the card on the canvas
 * actually loading real audio with a duration.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { BINARY, FIND_PDF, SECOND_PDF } from '../../data/files.js'
import type { Locator, Page } from '@playwright/test'

interface AudioData { type: 'audio'; name: string; source: 'upload' | 'record' | 'link'; blobId: string | null; url: string | null; duration: number; mimeType: string }
interface BlobRow { id: string; projectId: string; data: { __bytes: number }; mimeType: string; size: number }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The card's <audio> has loaded real audio: metadata read and a positive duration. */
async function loadedDuration(card: Locator): Promise<number> {
  let d = 0
  await expect.poll(async () => (d = await card.locator('audio').evaluate((a: HTMLAudioElement) => (a.readyState >= 1 && Number.isFinite(a.duration) ? a.duration : 0))), { message: 'audio metadata loaded' }).toBeGreaterThan(0)
  return d
}

test.describe('Audio notes', { tag: ['@regression', '@media'] }, () => {
  let clickWorld: { x: number; y: number }
  test.beforeEach(async ({ ws }) => {
    clickWorld = await ws.screenToWorld(await ws.at(0.65, 0.4))
    await ws.place('audio', 0.65, 0.4)
  })

  const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'New Audio Note' })

  test('REG-074 an MP3 upload becomes an audio note with its bytes saved, its name on the card and real audio that plays for a measured time', { tag: ['@P1', '@sanity'] }, async ({ ws, page, docId }) => {
    const dialog = dialogOf(page)
    await dialog.getByRole('tab', { name: 'Upload' }).click()
    await dialog.locator('input[type=file]').setInputFiles(BINARY.toneMp3)
    await expect(dialog).toContainText('tone.mp3')
    await expect(dialog.getByPlaceholder('Audio name...')).toHaveValue('tone') // suggested from the file name
    await dialog.getByPlaceholder('Audio name...').fill('Memo')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'audio')
    const [item] = await readStore<ItemRow<AudioData>>(page, 'workspaceItems')
    const [blob] = await readStore<BlobRow>(page, 'mediaBlobs')
    expect(blob).toMatchObject({ size: 319_422, mimeType: 'audio/mpeg', data: { __bytes: 319_422 }, projectId: item.projectId })
    expect(item).toMatchObject({ type: 'audio', documentId: docId, width: 280, height: 100 })
    expect(item.data).toMatchObject({ type: 'audio', name: 'Memo', source: 'upload', blobId: blob.id, url: null, mimeType: 'audio/mpeg' })
    expect(item.data.duration).toBeGreaterThan(1)
    // Placed where the canvas was clicked (the dialog opens for that spot).
    expect(item.x).toBeCloseTo(clickWorld.x - 140, 0)
    expect(item.y).toBeCloseTo(clickWorld.y - 50, 0)

    const card = ws.item(item.id)
    await expect(card).toContainText('Memo')
    const duration = await loadedDuration(card)
    expect(duration).toBeCloseTo(item.data.duration, 0)
    await expect(card).toContainText(`0:00 / ${fmt(duration)}`)
  })

  test('REG-075 a file that is not an MP3 is refused by name', { tag: '@P2' }, async ({ page }) => {
    const dialog = dialogOf(page)
    await dialog.getByRole('tab', { name: 'Upload' }).click()
    await dialog.locator('input[type=file]').setInputFiles({ name: 'automation.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1') })
    // The refusal is a toast, outside the dialog.
    await expect(page.getByText('“automation.wav” isn’t an MP3 — only MP3 audio can be uploaded.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Click to select an MP3 file — or drop one here' })).toBeVisible()
    await expect(dialog).not.toContainText('automation.wav')
  })

  test('REG-076 an audio note needs a name of at most 20 characters', { tag: '@P3' }, async ({ page }) => {
    const dialog = dialogOf(page)
    await dialog.getByRole('tab', { name: 'Upload' }).click()
    await dialog.locator('input[type=file]').setInputFiles(BINARY.toneMp3)
    const name = dialog.getByPlaceholder('Audio name...')
    await expect(name).toHaveAttribute('maxlength', '20')
    const create = dialog.getByRole('button', { name: 'Create', exact: true })
    await name.fill('')
    await expect(create).toBeDisabled()
    await expect(dialog.getByText('Required — name it so you can find it on the canvas later.')).toBeVisible()
    await name.fill('A'.repeat(25))
    await expect(name).toHaveValue('A'.repeat(20))
    await expect(dialog.getByText('Required — name it so you can find it on the canvas later.')).toBeHidden()
    await expect(create).toBeEnabled()
    // Enter in the dialog creates the note, like the button.
    await name.press('Enter')
    await expect(dialog).toBeHidden({ timeout: 20_000 })
    await expectStoreCount(page, 'workspaceItems', 1, (i) => (i.data as { name?: string }).name === 'A'.repeat(20))
  })

  test('REG-077 a microphone recording becomes an audio note with a stored audio blob and its recorded length', { tag: '@P2' }, async ({ ws, page }) => {
    const dialog = dialogOf(page)
    await dialog.getByRole('tab', { name: 'Record' }).click()
    await dialog.getByRole('button', { name: 'Start recording' }).click()
    await expect(dialog.getByPlaceholder('Audio name...')).toHaveValue(/^Recording \d{2}:\d{2}( [AP]M)?$/)
    // Record until the dialog's own timer shows at least two seconds.
    await expect(dialog.getByText(/^0:0[2-9]$/)).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: 'Stop recording' }).click()
    await expect(dialog.getByText(/^Recorded \(0:0[2-9]\)$/)).toBeVisible()
    await dialog.getByPlaceholder('Audio name...').fill('Recorded')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'audio')
    await expectStoreCount(page, 'mediaBlobs', 1)
    const [item] = await readStore<ItemRow<AudioData>>(page, 'workspaceItems')
    const [blob] = await readStore<BlobRow>(page, 'mediaBlobs')
    expect(blob.mimeType).toMatch(/^audio\//)
    expect(blob.size).toBeGreaterThan(1000)
    expect(blob.data.__bytes).toBe(blob.size)
    expect(item.data).toMatchObject({ name: 'Recorded', source: 'record', blobId: blob.id, url: null, mimeType: blob.mimeType })
    expect(item.data.duration).toBeGreaterThanOrEqual(2)
    await expect(ws.item(item.id)).toContainText('Recorded')
    await expect(ws.item(item.id)).toContainText(fmt(item.data.duration))
  })

  // Open issue #222: "Audio note link doesn't validate entered url".
  test('REG-078 an audio link must be a real audio or embeddable URL, and each wrong link says why', { tag: '@P3' }, async ({ page }) => {
    const dialog = dialogOf(page)
    const create = dialog.getByRole('button', { name: 'Create', exact: true })
    await dialog.getByRole('tab', { name: 'Link' }).click()
    await dialog.getByPlaceholder('Audio name...').fill('Link test')
    const url = dialog.getByPlaceholder('https://example.com/audio.mp3')
    const why = dialog.getByRole('alert')
    await expect(dialog.getByText('Paste a direct audio link (.mp3, .wav, .m4a, .ogg), or a Spotify, SoundCloud or Apple Podcasts link')).toBeVisible()
    const cases: Array<[string, string]> = [
      ['this is not a link', 'That is not a link - paste a full address starting with https://'],
      ['ftp://example.com/a.mp3', 'Only http:// and https:// links can be used here.'],
      ['https://asdf/a.mp3', 'That link has no website address in it - check it and paste it again.'],
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube can’t be played in an audio note. Add it as a Video note instead, or use Upload to add the audio file.'],
      ['https://spotify.link/abc', 'Use Spotify’s Share › Copy link for a track, episode, show, album or playlist - it starts with https://open.spotify.com/. Short spotify.link addresses cannot be played here.'],
    ]
    for (const [value, message] of cases) {
      await url.fill(value)
      await expect(why).toHaveText(message)
      await expect(create).toBeDisabled()
    }
    // A direct audio URL only counts once it has loaded (network, blocked here).
    await url.fill('https://example.com/not-audio')
    await expect(create).toBeDisabled()
    // An embeddable link counts as soon as it parses, so it is the offline positive case.
    await url.fill('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk')
    await expect(dialog.getByRole('status')).toContainText('Plays in the Spotify player.')
    await expect(create).toBeEnabled()
    await expectStoreCount(page, 'workspaceItems', 0)
  })
})

test.describe('Document embeds', { tag: ['@regression', '@media'] }, () => {
  test('REG-079 a document card on the canvas opens that document', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.canvas.place('document', 0.6, 0.4)
    await page.getByText(SECOND_PDF.displayName, { exact: true }).last().click()
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'document')
    await page.getByRole('button', { name: `Open ${SECOND_PDF.displayName}` }).click()
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
  })
})

test.describe('Camera scanner', { tag: ['@regression', '@scanner', '@media'] }, () => {
  test('REG-080 a page captured with the camera is saved as a new document', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await app.documents.scan.click()
    await expect(page.getByText('Scan Document').first()).toBeVisible()
    await page.getByRole('button', { name: 'Capture page' }).click()
    await page.getByRole('button', { name: 'Next →' }).click()
    await page.getByRole('button', { name: /^Save \(1\)$/ }).click()
    await expect(page.getByText('Scan Document')).toHaveCount(0, { timeout: 20_000 })
    await expectStoreCount(page, 'documents', 1, () => true, 20_000)
    const [doc] = await readStore<{ name: string; pageCount: number }>(page, 'documents')
    expect(doc.name).toMatch(/^Scan /)
    expect(doc.pageCount).toBe(1)
  })

  test('REG-081 a camera the browser refuses is explained in words', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    // Test double: getUserMedia rejects the way a denied permission does.
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await app.documents.scan.click()
    await expect(page.getByText('Camera access denied. Please allow camera permissions.')).toBeVisible()
  })
})
