/**
 * Deterministic PNG builder: a solid-colour RGB image with an optional
 * contrasting square in the middle, so an image upload has known pixels.
 */
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export type Rgb = [number, number, number]

export function buildPng(width: number, height: number, fill: Rgb, square?: Rgb): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height)
  const sq = { x0: width / 4, x1: (3 * width) / 4, y0: height / 4, y1: (3 * height) / 4 }
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const inSq = square && x >= sq.x0 && x < sq.x1 && y >= sq.y0 && y < sq.y1
      const [r, g, b] = inSq ? square : fill
      raw.set([r, g, b], row + 1 + x * 3)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
