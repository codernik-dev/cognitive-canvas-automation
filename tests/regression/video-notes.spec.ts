/**
 * Regression: video notes (VideoCreateModal.tsx, items/VideoItem.tsx,
 * items/VideoInspector.tsx, items/VideoEmbedFacade.tsx, items/VideoEmbedPlayer.tsx).
 *
 * The MP4 that is uploaded is real: recorded a moment earlier by
 * MediaRecorder from Chromium's fake camera (helpers/canvasMedia.ts), so it
 * carries an `ftyp` header and plays. What is asserted is what the app
 * promises: stored bytes and MIME type, the duration it read, the thumbnail,
 * the card's states and controls, not the codec.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { recordClip, answerNextDialog } from '../../helpers/canvasMedia.js'
import { HEADER_ONLY_MP4, PNG_NAMED, MOV_FILE, bigFile } from '../../data/canvas-files.js'
import type { Locator, Page } from '@playwright/test'
import type { CanvasWorkbench, CanvasDialogs } from '../../components/CanvasWorkbench.js'

interface VideoData {
  type: 'video'; name: string; source: 'upload' | 'record' | 'link'; blobId: string | null; url: string | null
  duration: number; mimeType: string; thumbnailDataUrl: string | null; mirrored?: boolean
}
interface BlobRow { id: string; data: { __bytes: number }; mimeType: string; size: number }
/** The video item's stored row, once the debounced save has written it. */
async function videoRow(page: Page) {
  let row: ItemRow<VideoData> | undefined
  await expect.poll(async () => !!(row = (await readStore<ItemRow<VideoData>>(page, 'workspaceItems')).find((r) => r.type === 'video')), { message: 'video item saved' }).toBe(true)
  return row!
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const videoProp = (card: Locator, k: 'paused' | 'currentTime' | 'muted' | 'readyState' | 'duration') =>
  card.locator('video').first().evaluate((v, key) => (v as HTMLVideoElement)[key] as unknown, k)

/** Upload a freshly recorded MP4 as a video note and return its id and the bytes sent. */
async function uploadClip(ws: CanvasWorkbench, dialogs: CanvasDialogs, page: Page) {
  const clip = await recordClip(page.context(), 2, 'mp4')
  await ws.place('video', 0.55, 0.45)
  const m = dialogs.media(dialogs.video, 'Video')
  await m.file.setInputFiles({ name: 'lecture-clip.mp4', mimeType: 'video/mp4', buffer: clip.bytes })
  await expect(m.name).toHaveValue('lecture-clip')
  await m.create.click()
  await expect(dialogs.video).toBeHidden({ timeout: 30_000 })
  await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'video')
  return { id: (await videoRow(page)).id, clip }
}

test.describe('Video notes', { tag: ['@regression', '@media', '@video'] }, () => {
  test('REG-092 an MP4 upload becomes a video note: bytes, type, length and thumbnail stored, and the card plays it', { tag: ['@P1', '@sanity'] }, async ({ ws, dialogs, page, docId }) => {
    const click = await ws.screenToWorld(await ws.at(0.55, 0.45))
    const { id, clip } = await uploadClip(ws, dialogs, page)
    const row = await videoRow(page)
    const [blob] = await readStore<BlobRow>(page, 'mediaBlobs')
    expect(blob).toMatchObject({ size: clip.bytes.length, mimeType: 'video/mp4', data: { __bytes: clip.bytes.length } })
    expect(row).toMatchObject({ type: 'video', documentId: docId, width: 320, height: 220 })
    expect(row.x).toBeCloseTo(click.x - 160, 0)
    expect(row.y).toBeCloseTo(click.y - 110, 0)
    expect(row.data).toMatchObject({ type: 'video', name: 'lecture-clip', source: 'upload', blobId: blob.id, url: null, mimeType: 'video/mp4' })
    expect(row.data.duration).toBeGreaterThan(clip.seconds - 0.6)
    expect(row.data.duration).toBeLessThan(clip.seconds + 0.6)
    expect(row.data.thumbnailDataUrl).toMatch(/^data:image\/(jpeg|png|webp);base64,/)
    expect(row.data.mirrored).toBeUndefined()

    const card = ws.item(id)
    await expect(card.getByTitle('Click to rename')).toHaveText('lecture-clip')
    await expect.poll(() => videoProp(card, 'readyState')).toBeGreaterThanOrEqual(1)
    expect(await videoProp(card, 'duration')).toBeGreaterThan(1)
    await expect(card.locator('video')).toHaveAttribute('poster', /^(data:image|blob:)/)
    await expect(card).toContainText(fmt(row.data.duration))
  })

  test('REG-093 a recording from the camera becomes a video note, mirrored the way it was previewed', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    await m.tab('Record').click()
    const preview = dialogs.video.locator('[data-video-preview] video')
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => !!v.srcObject && v.videoWidth > 0), { message: 'live camera preview' }).toBe(true)
    // A front (user-facing) camera is previewed like a mirror by default.
    expect(await preview.evaluate((v) => (v as HTMLElement).style.transform)).toBe('scaleX(-1)')
    await expect(dialogs.video.getByRole('button', { name: 'Show preview as recorded' })).toHaveAttribute('aria-pressed', 'true')
    await m.start.click()
    await expect(m.name).toHaveValue(/^Recording \d{2}:\d{2}( [AP]M)?$/)
    await expect(dialogs.video.getByRole('button', { name: 'Show preview as recorded' })).toBeDisabled() // locked during a take
    await expect(dialogs.video.locator('[data-video-preview]').getByText(/^0:0[2-9]$/)).toBeVisible({ timeout: 15_000 })
    await m.stop.click()
    await expect(dialogs.video.getByText(/^Recorded \(0:0[2-9]\)$/)).toBeVisible()
    await m.name.fill('Camera take')
    await m.create.click()
    await expect(dialogs.video).toBeHidden({ timeout: 30_000 })

    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'video')
    const row = await videoRow(page)
    const [blob] = await readStore<BlobRow>(page, 'mediaBlobs')
    expect(blob.mimeType).toMatch(/^video\//)
    expect(blob.size).toBeGreaterThan(5_000)
    expect(row.data).toMatchObject({ name: 'Camera take', source: 'record', blobId: blob.id, url: null, mimeType: blob.mimeType, mirrored: true })
    expect(row.data.duration).toBeGreaterThanOrEqual(2)
    expect(row.data.thumbnailDataUrl).toMatch(/^data:image\//)
    const video = ws.item(row.id).locator('video')
    await expect.poll(() => video.evaluate((v) => (v as HTMLElement).style.transform)).toBe('scaleX(-1)')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1)
  })

  test('REG-370 turning Mirror off shows the preview as recorded, is remembered, and the note is not mirrored', { tag: '@P3' }, async ({ ws, dialogs, page }) => {
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    await m.tab('Record').click()
    const preview = dialogs.video.locator('[data-video-preview] video')
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => !!v.srcObject)).toBe(true)
    await dialogs.video.getByRole('button', { name: 'Show preview as recorded' }).click()
    const mirror = dialogs.video.getByRole('button', { name: 'Mirror preview' })
    await expect(mirror).toHaveAttribute('aria-pressed', 'false')
    expect(await preview.evaluate((v) => (v as HTMLElement).style.transform)).toBe('')
    expect(await page.evaluate(() => localStorage.getItem('cc2_video_preview_mirror'))).toBe('0')

    await m.start.click()
    await expect(dialogs.video.locator('[data-video-preview]').getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 15_000 })
    await m.stop.click()
    await m.create.click()
    await expect(dialogs.video).toBeHidden({ timeout: 30_000 })
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'video')
    const row = await videoRow(page)
    expect(row.data.mirrored).toBeUndefined()
    expect(await ws.item(row.id).locator('video').evaluate((v) => (v as HTMLElement).style.transform)).toBe('')

    // The choice is remembered by the next dialog.
    await ws.place('video', 0.3, 0.3)
    await m.tab('Record').click()
    await expect(dialogs.video.getByRole('button', { name: 'Mirror preview' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('REG-371 a non-MP4 file, and an ".mp4" whose bytes are a picture, are refused with a reason and nothing is chosen', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    await m.file.setInputFiles(MOV_FILE())
    await expect(page.getByText('“holiday.mov” isn’t an MP4 — only MP4 video can be uploaded.')).toBeVisible()
    await m.file.setInputFiles(PNG_NAMED('fake.mp4', 'video/mp4'))
    await expect(page.getByText('“fake.mp4” doesn’t look like an MP4 video — its contents don’t match its name.')).toBeVisible()
    await expect(dialogs.video.getByRole('button', { name: 'Click to select an MP4 file — or drop one here' })).toBeVisible()
    await expect(m.name).toHaveValue('')
    await expect(m.create).toBeDisabled()
  })

  test('REG-372 a video over 450 MB is refused before anything is read, and a camera the browser refuses is explained', { tag: '@P3' }, async ({ ws, dialogs, page }, testInfo) => {
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    const big = bigFile(testInfo.outputPath('long-lecture.mp4'), 450 * 1024 * 1024 + 1)
    try {
      await m.file.setInputFiles(big.path)
      await expect(page.getByText('Video is too large — max 450 MB.')).toBeVisible()
    } finally {
      big.remove()
    }
    await expect(dialogs.video).not.toContainText('long-lecture.mp4')
    await expect(m.create).toBeDisabled()

    // Test double: the browser refuses the camera the way a denied permission does.
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await m.tab('Record').click()
    const said = answerNextDialog(page, true)
    await m.start.click()
    expect(await said).toBe('Camera/microphone access denied')
    await expect(m.start).toBeVisible() // nothing started
    await expect(m.create).toBeDisabled()
  })

  test('REG-373 an MP4 this browser cannot play is still accepted, with a warning, and saved', { tag: '@P3' }, async ({ ws, dialogs, page }) => {
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    await m.file.setInputFiles(HEADER_ONLY_MP4())
    await expect(dialogs.video.getByText('This browser can’t play this file. The note will still be saved, but it may not play on this device.')).toBeVisible()
    await expect(m.create).toBeEnabled()
    await m.create.click()
    await expect(dialogs.video).toBeHidden({ timeout: 30_000 })
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'video')
    const [blob] = await readStore<BlobRow>(page, 'mediaBlobs')
    expect(blob.size).toBe(24)
    expect((await videoRow(page)).data).toMatchObject({ name: 'header-only', source: 'upload', duration: 0 })
  })

  test('REG-374 the Link tab explains each bad address and names good ones after their source', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    await m.tab('Link').click()
    await expect(dialogs.video.getByText('YouTube or Vimeo link, or a direct video URL (.mp4, .webm)')).toBeVisible()
    const why = dialogs.video.getByRole('alert')
    const cases: Array<[string, string]> = [
      ['not a link', 'That is not a link - paste a full address starting with https://'],
      ['ftp://files.example.com/clip.mp4', 'Only http:// and https:// links can be used here.'],
      ['https://asdf/clip.mp4', 'That link has no website address in it - check it and paste it again.'],
      ['https://example.com/article', 'That does not look like a video link. Paste a YouTube or Vimeo link — or a direct address ending in .mp4 or .webm.'],
    ]
    for (const [value, message] of cases) {
      await m.name.fill('')
      await m.link.fill(value)
      await expect(why).toHaveText(message)
      await expect(m.create).toBeDisabled()
    }
    for (const [value, name] of [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube: dQw4w9WgXcQ'],
      ['https://vimeo.com/76979871', 'Vimeo: 76979871'],
      ['https://cdn.example.com/media/talk.webm?sig=1', 'talk'],
    ] as const) {
      await m.name.fill('')
      await m.link.fill(value)
      await expect(why).toHaveCount(0)
      await expect(m.name).toHaveValue(name)
      await expect(m.create).toBeEnabled()
    }
    await m.create.click()
    await expect(dialogs.video).toBeHidden()
    const row = await videoRow(page)
    expect(row.data).toMatchObject({ name: 'talk', source: 'link', url: 'https://cdn.example.com/media/talk.webm?sig=1', blobId: null })
    await expectStoreCount(page, 'mediaBlobs', 0)
  })

  test('REG-375 a YouTube note shows a "Click to play" panel until selected, then the YouTube player, and is reached only through the guard', { tag: '@P3' }, async ({ ws, dialogs, page, blockedRequests }) => {
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    await m.tab('Link').click()
    await m.link.fill('https://youtu.be/dQw4w9WgXcQ')
    await m.create.click()
    await expect(dialogs.video).toBeHidden()
    const row = await videoRow(page)
    expect(row.data.name).toBe('YouTube: dQw4w9WgXcQ')
    const card = ws.item(row.id)
    const player = card.locator('iframe')
    await expect(player).toHaveAttribute('src', /youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/) // the new note is selected
    // A shield keeps the note draggable; the next click hands the surface to the player.
    const shield = card.locator('iframe + div')
    await expect(shield).toHaveClass(/cursor-pointer/)
    await shield.click()
    await expect(shield).toHaveClass(/pointer-events-none/)
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    await expect(player).toHaveCount(0)
    await expect(card).toContainText('Click to play')
    expect(blockedRequests.some((r) => /youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/.test(r))).toBe(true)
    // "Open" in the label bar always opens the inspector, even for an embed.
    await card.getByRole('button', { name: 'Open video' }).click()
    const inspector = page.locator('.video-inspector-panel')
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText('YouTube: dQw4w9WgXcQ')
    await page.keyboard.press('Escape')
    await expect(inspector).toHaveCount(0)
  })

  test('REG-376 the video card plays, skips and mutes; Open shows the inspector with its length, speed menu and keys', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    const { id } = await uploadClip(ws, dialogs, page)
    const card = ws.item(id)
    await card.locator('video').hover()
    // The card's play button has no name; it is the first control before "Back 10s".
    const play = card.getByTitle('Back 10s').locator('xpath=preceding-sibling::button[1]')
    await play.click()
    await expect.poll(() => videoProp(card, 'currentTime') as Promise<number>).toBeGreaterThan(0.2)
    await expect.poll(() => videoProp(card, 'paused')).toBe(true) // a 2 s clip plays to its end
    await card.locator('video').hover()
    await card.getByTitle('Back 10s').click()
    await expect.poll(() => videoProp(card, 'currentTime')).toBe(0)
    await card.getByTitle('Back 10s').locator('xpath=following-sibling::button[2]').click() // mute (after Forward 10s)
    await expect.poll(() => videoProp(card, 'muted')).toBe(true)

    const row = await videoRow(page)
    await card.getByRole('button', { name: 'Open video' }).click()
    const inspector = page.locator('.video-inspector-panel')
    await expect(inspector).toContainText('lecture-clip')
    await expect(inspector).toContainText(`${fmt(row.data.duration)} · upload`)
    const own = inspector.locator('video')
    await inspector.getByRole('button', { name: 'Playback speed' }).click()
    await inspector.getByRole('menuitemradio', { name: /^1\.5/ }).click()
    expect(await own.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5)
    await page.keyboard.press(' ')
    await expect.poll(() => own.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2)
    await page.keyboard.press('Escape')
    await expect(inspector).toHaveCount(0)
  })

  test('REG-377 Cancel asks before discarding a chosen video; deleting a video note asks too', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    const clip = await recordClip(page.context(), 2, 'mp4')
    await ws.place('video', 0.55, 0.45)
    const m = dialogs.media(dialogs.video, 'Video')
    await m.file.setInputFiles({ name: 'keep.mp4', mimeType: 'video/mp4', buffer: clip.bytes })
    await expect(dialogs.video).toContainText('keep.mp4')
    let asked = answerNextDialog(page, false)
    await m.cancel.click()
    expect(await asked).toBe('You have a file that was not added yet. Discard it?')
    await expect(dialogs.video).toContainText('keep.mp4')
    await m.create.click()
    await expect(dialogs.video).toBeHidden({ timeout: 30_000 })
    const row = await videoRow(page)

    await ws.item(row.id).hover()
    asked = answerNextDialog(page, false)
    await ws.deleteButton(row.id).click()
    expect(await asked).toBe('Delete this video note?\n\nThis cannot be undone.')
    await expectStoreCount(page, 'workspaceItems', 1)
    asked = answerNextDialog(page, true)
    await ws.deleteButton(row.id).click()
    await asked
    await expectStoreCount(page, 'workspaceItems', 0)
  })

  test('REG-378 a video note is renamed in place from its label bar', { tag: '@P3' }, async ({ ws, page }) => {
    // A link note keeps this test free of media decoding.
    await ws.place('video', 0.55, 0.45)
    const dialog = page.getByRole('dialog', { name: 'New Video Note' })
    await dialog.getByRole('tab', { name: 'Link' }).click()
    await dialog.getByRole('textbox', { name: 'Video link' }).fill('https://cdn.example.com/a/intro.mp4')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()
    const row = await videoRow(page)
    const card = ws.item(row.id)
    await card.getByTitle('Click to rename').click()
    await card.getByRole('textbox').fill('Course intro')
    await card.getByRole('textbox').press('Enter')
    await expect.poll(async () => (await videoRow(page)).data.name).toBe('Course intro')
    await expect(card.getByTitle('Click to rename')).toHaveText('Course intro')
  })
})
