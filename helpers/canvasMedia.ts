/**
 * Media and input helpers for the canvas specs.
 *
 *  - recordClip(): a REAL, playable clip made by MediaRecorder from
 *    Chromium's fake camera in a throwaway page of the test's own context.
 *    Playwright's Chromium records ISO-BMFF ('video/mp4') with an `ftyp`
 *    header, so the bytes are a genuine MP4 the app's sniffer and the
 *    browser's decoder both accept. No binary fixture lives in git.
 *  - answerNextDialog(): accept or dismiss the next window.confirm/alert and
 *    hand back its text, so a spec can assert the exact wording.
 *  - dropOn(): emulate a drop with a DataTransfer built in the page and
 *    Playwright's dispatchEvent, the supported way to fake a file or data
 *    drop (a real OS drag cannot be produced by the browser driver).
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { baseURL } from '../config/env.js'

export interface RecordedClip {
  bytes: Buffer
  mimeType: string
  /** Seconds the recorder ran for. */
  seconds: number
}

/** Clips are deterministic enough to share within a worker, keyed by length and container. */
const clipCache = new Map<string, Promise<RecordedClip>>()

/**
 * Record `seconds` of the fake camera (with the fake microphone's beep).
 * `container` 'mp4' asks for the MP4 the upload tab accepts.
 */
export function recordClip(context: BrowserContext, seconds = 2, container: 'mp4' | 'webm' = 'mp4'): Promise<RecordedClip> {
  const key = `${container}:${seconds}`
  let p = clipCache.get(key)
  if (!p) {
    p = recordFresh(context, seconds, container)
    clipCache.set(key, p)
    p.catch(() => clipCache.delete(key))
  }
  return p
}

async function recordFresh(context: BrowserContext, seconds: number, container: 'mp4' | 'webm'): Promise<RecordedClip> {
  const page = await context.newPage()
  try {
    // A blank page on the app's own (secure, 127.0.0.1) origin: getUserMedia needs one,
    // and the network guard lets same-origin requests through to this route.
    const url = `${baseURL}/__canvas-media-fixture__`
    await page.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fixture</title>' }))
    await page.goto(url)
    const out = await page.evaluate(async ({ seconds, container }) => {
      const mime = container === 'mp4'
        ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=vp9,opus', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
        : 'video/webm;codecs=vp8,opus'
      if (!mime) throw new Error('this Chromium cannot record MP4')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: true })
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      const stopped = new Promise((res) => { rec.onstop = res })
      rec.start(250)
      // The recorder needs wall-clock time to produce the clip; this wait is the content, not a sync.
      await new Promise((res) => setTimeout(res, seconds * 1000))
      rec.stop()
      await stopped
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: rec.mimeType })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return { b64: btoa(bin), mimeType: rec.mimeType }
    }, { seconds, container })
    return { bytes: Buffer.from(out.b64, 'base64'), mimeType: out.mimeType, seconds }
  } finally {
    await page.close()
  }
}

/**
 * Answer the next native dialog. Returns its message once it has appeared.
 * Register BEFORE the click that opens it.
 */
export function answerNextDialog(page: Page, accept: boolean): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', async (d) => {
      const message = d.message()
      if (accept) await d.accept()
      else await d.dismiss()
      resolve(message)
    })
  })
}

export interface DropData {
  files?: Array<{ name: string; mimeType: string; buffer: Buffer }>
  /** Extra data items, by MIME type (e.g. the PDF excerpt drag). */
  items?: Record<string, string>
}

/**
 * Drop onto `target` at a viewport point: dragenter, dragover, drop, each
 * with the same DataTransfer. (A script-made DataTransfer keeps dropEffect
 * 'none' whatever the page sets, so the drop effect cannot be observed here;
 * specs assert what the drop did.)
 */
export async function dropOn(page: Page, target: Locator, at: { x: number; y: number }, data: DropData): Promise<void> {
  const dt = await page.evaluateHandle(({ files, items }) => {
    const transfer = new DataTransfer()
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))
      transfer.items.add(new File([bytes], f.name, { type: f.mimeType }))
    }
    for (const [type, value] of Object.entries(items)) transfer.setData(type, value)
    return transfer
  }, {
    files: (data.files ?? []).map((f) => ({ name: f.name, mimeType: f.mimeType, b64: f.buffer.toString('base64') })),
    items: data.items ?? {},
  })
  const init = { dataTransfer: dt, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }
  await target.dispatchEvent('dragenter', init)
  await target.dispatchEvent('dragover', init)
  await target.dispatchEvent('drop', init)
  await dt.dispose()
}
