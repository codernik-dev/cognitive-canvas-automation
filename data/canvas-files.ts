/**
 * Test data for the canvas module's media specs, generated in memory.
 *
 * A real, playable MP4 is recorded on the fly (helpers/canvasMedia.ts
 * recordClip); everything here is either a committed fixture reused from
 * data/files.ts or a few deterministic bytes.
 */
import { closeSync, openSync, ftruncateSync, rmSync } from 'node:fs'
import { BINARY, type FilePayload } from './files.js'
import { buildPng } from './builders/png.js'

/** The 319 422-byte MP3 tone the legacy e2e suite already commits. */
export const TONE_MP3 = { path: BINARY.toneMp3, bytes: 319_422, name: 'tone.mp3' }

/**
 * The smallest ISO-BMFF header (`ftyp isom`, 24 bytes): sniffed as MP4 by
 * the app, but no browser can play it. Exercises the "can't play this file"
 * path of the video dialog.
 */
export const HEADER_ONLY_MP4 = (): FilePayload => ({
  name: 'header-only.mp4',
  mimeType: 'video/mp4',
  buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]),
})

/** PNG bytes wearing a media file's name: the content sniffer must refuse it. */
export const PNG_NAMED = (name: string, mimeType: string): FilePayload => ({ name, mimeType, buffer: buildPng(8, 8, [10, 200, 10]) })

/** A clip with a non-MP4 extension and type. */
export const MOV_FILE = (): FilePayload => ({ name: 'holiday.mov', mimeType: 'video/quicktime', buffer: Buffer.from('not checked: the name is refused first') })

/**
 * Create a file of `bytes` length (zeros) for size-limit tests and return a
 * remover. Extending with ftruncate is instant and the browser reads only
 * the size before refusing, so even 450 MB costs nothing to "upload".
 */
export function bigFile(path: string, bytes: number): { path: string; remove: () => void } {
  const fd = openSync(path, 'w')
  ftruncateSync(fd, bytes)
  closeSync(fd)
  return { path, remove: () => rmSync(path, { force: true }) }
}
