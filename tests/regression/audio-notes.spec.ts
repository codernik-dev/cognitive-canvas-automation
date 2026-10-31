/**
 * Regression: audio notes beyond creation (items/AudioItem.tsx,
 * items/AudioInspector.tsx, items/AudioEmbedFacade.tsx, AudioCreateModal.tsx,
 * shared/InlineRename.tsx, canvas/useCanvasEvents.ts media keys).
 * Playback is checked on the real <audio> element the card drives: paused
 * state, position, rate and mute, not just the button icons.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { answerNextDialog } from '../../helpers/canvasMedia.js'
import { knownDefect } from '../../helpers/defects.js'
import { TONE_MP3, PNG_NAMED, bigFile } from '../../data/canvas-files.js'
import type { Locator, Page } from '@playwright/test'
import type { CanvasWorkbench, CanvasDialogs } from '../../components/CanvasWorkbench.js'

interface AudioData { name: string; source: string; url: string | null; blobId: string | null; duration: number }
/** The audio item's stored row, once the debounced save has written it. */
async function audioRow(page: Page) {
  let row: ItemRow<AudioData> | undefined
  await expect.poll(async () => !!(row = (await readStore<ItemRow<AudioData>>(page, 'workspaceItems')).find((r) => r.type === 'audio')), { message: 'audio item saved' }).toBe(true)
  return row!
}

/** Create an audio note from the committed MP3 and return its id. */
async function uploadTone(ws: CanvasWorkbench, dialogs: CanvasDialogs, page: Page, name = 'Tone') {
  await ws.place('audio', 0.6, 0.4)
  const m = dialogs.media(dialogs.audio, 'Audio')
  await m.file.setInputFiles(TONE_MP3.path)
  // Wait for the file to be accepted (it suggests its own name) before typing ours.
  await expect(m.name).toHaveValue('tone')
  await m.name.fill(name)
  await m.create.click()
  await expect(dialogs.audio).toBeHidden({ timeout: 20_000 })
  await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'audio')
  const id = (await audioRow(page)).id
  await expect.poll(() => ws.item(id).locator('audio').evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThanOrEqual(1)
  return id
}

const audioEl = (card: Locator) => card.locator('audio')
const prop = (card: Locator, k: 'paused' | 'currentTime' | 'muted' | 'playbackRate') => audioEl(card).evaluate((a, key) => (a as HTMLAudioElement)[key] as unknown, k)

/** Press the card somewhere neutral (the spacer in its controls row), selecting it without renaming or playing. */
async function selectAudioCard(card: Locator, page: Page) {
  const box = (await card.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.82)
}

test.describe('Audio note card', { tag: ['@regression', '@media', '@audio'] }, () => {
  test('REG-359 the card plays and pauses the recording, skips 10 s, mutes and cycles the speed', { tag: ['@P1', '@sanity'] }, async ({ ws, dialogs, page }) => {
    const id = await uploadTone(ws, dialogs, page)
    const card = ws.item(id)
    // The play button has no name of its own (REG-360); it sits right after "Back 10s".
    const play = card.getByTitle('Back 10s').locator('xpath=following-sibling::button[1]')
    await play.click()
    await expect.poll(() => prop(card, 'paused')).toBe(false)
    await expect.poll(async () => (await prop(card, 'currentTime')) as number).toBeGreaterThan(0.3)
    await play.click()
    await expect.poll(() => prop(card, 'paused')).toBe(true)

    const t0 = (await prop(card, 'currentTime')) as number
    await card.getByTitle('Forward 10s').click()
    await expect.poll(async () => (await prop(card, 'currentTime')) as number).toBeCloseTo(t0 + 10, 0)
    await card.getByTitle('Back 10s').click()
    await expect.poll(async () => (await prop(card, 'currentTime')) as number).toBeCloseTo(t0, 0)

    await card.getByTitle('Mute', { exact: true }).click()
    await expect.poll(() => prop(card, 'muted')).toBe(true)
    await expect(card.getByTitle('Unmute', { exact: true })).toBeVisible()

    const speed = card.getByTitle('Playback speed')
    for (const [label, rate] of [['1.25x', 1.25], ['1.5x', 1.5], ['2x', 2], ['0.5x', 0.5], ['0.75x', 0.75], ['1x', 1]] as const) {
      await speed.click()
      await expect(speed).toHaveText(label)
      expect(await prop(card, 'playbackRate')).toBe(rate)
    }
  })

  test('REG-360 the audio card\'s play button has an accessible name', { tag: '@P3' }, async ({ ws, dialogs, page }) => {
    knownDefect('DEF-302')
    const id = await uploadTone(ws, dialogs, page)
    const play = ws.item(id).getByTitle('Back 10s').locator('xpath=following-sibling::button[1]')
    await expect(play).toHaveAccessibleName(/^(Play|Pause)$/)
  })

  test('REG-361 an audio note is renamed in place: Enter or the tick saves, Escape cancels, 20 characters at most', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    const id = await uploadTone(ws, dialogs, page)
    const card = ws.item(id)
    await card.getByTitle('Click to rename').click()
    const input = card.getByRole('textbox')
    await expect(input).toHaveAttribute('maxlength', '20')
    await input.fill('Lecture 3 summary')
    await input.press('Enter')
    await expect.poll(async () => (await audioRow(page)).data.name).toBe('Lecture 3 summary')
    await expect(card.getByTitle('Click to rename')).toHaveText('Lecture 3 summary')

    await card.getByTitle('Click to rename').click()
    await input.fill('Never saved')
    await input.press('Escape')
    await expect(card.getByTitle('Click to rename')).toHaveText('Lecture 3 summary')

    await card.getByTitle('Click to rename').click()
    await input.fill('  Week 4  ')
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await audioRow(page)).data.name).toBe('Week 4')
  })

  test('REG-362 double-clicking the card opens the inspector with its length, source, speeds and keys; Escape closes it', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    const id = await uploadTone(ws, dialogs, page, 'Inspect me')
    const row = await audioRow(page)
    const card = ws.item(id)
    const box = (await card.boundingBox())!
    await page.mouse.dblclick(box.x + box.width * 0.55, box.y + box.height * 0.82)
    // The inspector panel has no dialog role; it is the panel holding the large controls.
    const inspector = page.locator('div.max-w-md:has(button[title="Back 10s"])')
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText('Inspect me')
    const length = `${Math.floor(row.data.duration / 60)}:${String(Math.floor(row.data.duration % 60)).padStart(2, '0')}`
    await expect(inspector).toContainText(`${length} · upload`)
    // Opening the inspector must not leave the card playing underneath.
    expect(await prop(card, 'paused')).toBe(true)
    const own = inspector.locator('audio')
    await expect(inspector.getByRole('button', { name: /^[\d.]+x$/ })).toHaveText(['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'])
    await inspector.getByRole('button', { name: '1.5x', exact: true }).click()
    expect(await own.evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(1.5)
    await page.keyboard.press(' ')
    await expect.poll(() => own.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
    await expect(inspector.getByTitle('Pause', { exact: true })).toBeVisible()
    await expect.poll(() => own.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.3)
    await page.keyboard.press(' ')
    await expect.poll(() => own.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(inspector).toHaveCount(0)
    await expect(card).toBeVisible()
  })

  test('REG-363 with an audio note selected, Space plays and pauses it, the arrows seek and M mutes', { tag: '@P3' }, async ({ ws, dialogs, page }) => {
    const id = await uploadTone(ws, dialogs, page)
    const card = ws.item(id)
    await selectAudioCard(card, page)
    await page.keyboard.press(' ')
    await expect.poll(() => prop(card, 'paused')).toBe(false)
    // Let playback actually start before pausing again (the position moves).
    await expect.poll(async () => (await prop(card, 'currentTime')) as number).toBeGreaterThan(0.3)
    await page.keyboard.press(' ')
    await expect.poll(() => prop(card, 'paused')).toBe(true)
    const t0 = (await prop(card, 'currentTime')) as number
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await prop(card, 'currentTime')) as number).toBeCloseTo(t0 + 10, 0)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await prop(card, 'currentTime')) as number).toBeCloseTo(t0, 0)
    await page.keyboard.press('m')
    await expect.poll(() => prop(card, 'muted')).toBe(true)
  })

  test('REG-364 deleting an audio note always asks first: the trash, the Delete key and the menu; No keeps it', { tag: '@P1' }, async ({ ws, dialogs, page }) => {
    const id = await uploadTone(ws, dialogs, page)
    const card = ws.item(id)
    await selectAudioCard(card, page)

    let asked = answerNextDialog(page, false)
    await ws.deleteButton(id).click()
    expect(await asked).toBe('Delete this audio note?\n\nThis cannot be undone.')

    asked = answerNextDialog(page, false)
    await page.keyboard.press('Delete')
    expect(await asked).toBe('Delete this item?\n\nAudio/video notes cannot be recovered.')

    asked = answerNextDialog(page, false)
    await ws.rightClickItem(id)
    await ws.menuItem('Delete').click()
    expect(await asked).toBe('Delete this audio note?\n\nRecordings cannot be recovered.')
    await expectStoreCount(page, 'workspaceItems', 1)

    asked = answerNextDialog(page, true)
    await ws.deleteButton(id).click()
    await asked
    await expectStoreCount(page, 'workspaceItems', 0)
    await expect(card).toHaveCount(0)
  })

  test('REG-365 an embeddable Spotify link becomes a Spotify note: a plain panel until selected, then the Spotify player', { tag: '@P3' }, async ({ ws, dialogs, page, blockedRequests }) => {
    await ws.place('audio', 0.6, 0.4)
    const m = dialogs.media(dialogs.audio, 'Audio')
    await m.tab('Link').click()
    await m.name.fill('Podcast')
    await m.link.fill('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk')
    await m.create.click()
    await expect(dialogs.audio).toBeHidden()
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'audio')
    const row = await audioRow(page)
    expect(row).toMatchObject({ width: 340, height: 152 + 36 })
    expect(row.data).toMatchObject({ name: 'Podcast', source: 'link', url: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk', blobId: null })
    const card = ws.item(row.id)
    const player = card.locator('iframe')
    await expect(player).toHaveAttribute('src', /^https:\/\/open\.spotify\.com\/embed\/episode\/4rOoJ6Egrf8K2IrywzwOMk/) // a new note is selected
    const empty = await ws.at(0.1, 0.9)
    await page.mouse.click(empty.x, empty.y)
    await expect(player).toHaveCount(0)
    await expect(card).toContainText('Spotify')
    await expect(card).toContainText('Select, then click to play')
    // The player's request never left the machine.
    expect(blockedRequests.some((r) => r.includes('open.spotify.com/embed/'))).toBe(true)
  })

  test('REG-366 a direct MP3 link is checked by loading it, then becomes a note that plays from that address', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    const { readFileSync } = await import('node:fs')
    const mp3 = readFileSync(TONE_MP3.path)
    await page.route('https://media.example.com/**', (route) => route.request().url().endsWith('/talk.mp3')
      ? route.fulfill({ status: 200, contentType: 'audio/mpeg', body: mp3 })
      : route.fulfill({ status: 404, body: 'gone' }))
    await ws.place('audio', 0.6, 0.4)
    const m = dialogs.media(dialogs.audio, 'Audio')
    await m.tab('Link').click()
    await m.name.fill('Talk')
    await m.link.fill('https://media.example.com/missing.mp3')
    await expect(dialogs.audio.getByRole('alert')).toHaveText('This link does not play as audio here - it may be a web page, a stream that refuses other sites, or a dead address. Paste a direct link to the audio file (.mp3, .m4a, .wav, .ogg).')
    await expect(m.create).toBeDisabled()
    await m.link.fill('https://media.example.com/talk.mp3')
    await expect(m.create).toBeEnabled({ timeout: 15_000 })
    await m.create.click()
    await expect(dialogs.audio).toBeHidden()
    const row = await audioRow(page)
    expect(row.data).toMatchObject({ source: 'link', url: 'https://media.example.com/talk.mp3', blobId: null })
    await expectStoreCount(page, 'mediaBlobs', 0)
    const audio = ws.item(row.id).locator('audio')
    await expect(audio).toHaveAttribute('src', 'https://media.example.com/talk.mp3')
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => (Number.isFinite(a.duration) ? a.duration : 0))).toBeGreaterThan(1)
  })
})

test.describe('New audio note dialog', { tag: ['@regression', '@media', '@audio'] }, () => {
  test('REG-367 Cancel asks before throwing away a chosen file or a recording; answering No keeps the dialog', { tag: '@P2' }, async ({ ws, dialogs, page }) => {
    await ws.place('audio', 0.6, 0.4)
    const m = dialogs.media(dialogs.audio, 'Audio')
    await m.file.setInputFiles(TONE_MP3.path)
    let asked = answerNextDialog(page, false)
    await m.cancel.click()
    expect(await asked).toBe('You have a file that was not added yet. Discard it?')
    await expect(dialogs.audio).toContainText('tone.mp3')
    await m.remove.click()
    await expect(dialogs.audio).not.toContainText('tone.mp3')

    await m.tab('Record').click()
    await m.start.click()
    await expect(dialogs.audio.getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 15_000 })
    await m.stop.click()
    await expect(dialogs.audio.getByText(/^Recorded \(0:0\d\)$/)).toBeVisible()
    asked = answerNextDialog(page, false)
    await m.cancel.click()
    expect(await asked).toBe('You have an unsaved recording. Discard it?')
    await expect(dialogs.audio).toBeVisible()
    asked = answerNextDialog(page, true)
    await m.cancel.click()
    await asked
    await expect(dialogs.audio).toBeHidden()
    await expectStoreCount(page, 'mediaBlobs', 0)
    // Sentinel note: nothing was created by the discarded dialog.
    await ws.place('note', 0.3, 0.3)
    await expectStoreCount(page, 'workspaceItems', 1)
  })

  test('REG-368 while recording the tabs are locked; Pause and Resume work; Record again starts over', { tag: '@P2' }, async ({ ws, dialogs }) => {
    await ws.place('audio', 0.6, 0.4)
    const m = dialogs.media(dialogs.audio, 'Audio')
    await m.tab('Record').click()
    await expect(dialogs.audio.getByRole('combobox', { name: 'Select Microphone' })).toBeVisible()
    await m.start.click()
    await expect(dialogs.audio.getByText('Recording...')).toBeVisible()
    for (const t of ['Upload', 'Record', 'Link'] as const) {
      await expect(m.tab(t)).toBeDisabled()
      await expect(m.tab(t)).toHaveAttribute('title', 'Stop the recording first')
    }
    await expect(dialogs.audio.getByText(/^0:01$/)).toBeVisible({ timeout: 15_000 })
    await m.pause.click()
    await expect(dialogs.audio.getByText('Paused', { exact: true })).toBeVisible()
    const frozen = await dialogs.audio.getByText(/^\d:\d\d$/).innerText()
    await expect(m.resume).toBeVisible()
    await m.resume.click()
    await expect(dialogs.audio.getByText('Recording...')).toBeVisible()
    await expect(dialogs.audio.getByText(/^\d:\d\d$/)).not.toHaveText(frozen, { timeout: 15_000 })
    await m.stop.click()
    await expect(dialogs.audio.getByText(/^Recorded \(\d:\d\d\)$/)).toBeVisible()
    await expect(m.tab('Link')).toBeEnabled()
    await m.recordAgain.click()
    await expect(m.start).toBeVisible()
    await expect(dialogs.audio.getByText(/^Recorded/)).toHaveCount(0)
    await expect(m.create).toBeDisabled()
  })

  test('REG-369 an MP3 over 100 MB, and an ".mp3" whose bytes are a picture, are both refused with a reason', { tag: '@P3' }, async ({ ws, dialogs, page }, testInfo) => {
    await ws.place('audio', 0.6, 0.4)
    const m = dialogs.media(dialogs.audio, 'Audio')
    const big = bigFile(testInfo.outputPath('huge-lecture.mp3'), 100 * 1024 * 1024 + 1)
    try {
      await m.file.setInputFiles(big.path)
      await expect(page.getByText('Audio is too large — max 100 MB.')).toBeVisible()
    } finally {
      big.remove()
    }
    await expect(dialogs.audio).not.toContainText('huge-lecture.mp3')
    await m.file.setInputFiles(PNG_NAMED('cover.mp3', 'audio/mpeg'))
    await expect(page.getByText('“cover.mp3” doesn’t look like an MP3 — its contents don’t match its name.')).toBeVisible()
    await expect(dialogs.audio).not.toContainText('cover.mp3')
    await expect(m.create).toBeDisabled()
  })
})
