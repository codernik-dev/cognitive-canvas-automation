#!/usr/bin/env node
/**
 * Serve the app's build the way production does, for the end-to-end tests.
 * ===============================================================
 * A copy of the app's scripts/serve-dist.mjs, so this repository needs nothing
 * from the app's folder. Forty lines of plain HTTP that mirror the three things
 * web.config guarantees: the right MIME for .mjs/.wasm, `no-cache` on index.html
 * and sw.js, and the SPA fallback (any path with no file behind it serves
 * index.html, which is how /download/<slug> works).
 *
 *   node scripts/serve-dist.mjs [port] [dist folder]      (default 4173, app/dist)
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dist')
const port = Number(process.argv[2] || 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.gz': 'application/gzip', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
  '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
}
const NO_CACHE = new Set(['/index.html', '/sw.js', '/boot.js'])

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  let path = normalize(decodeURIComponent(url.pathname)).replace(/\\/g, '/')
  if (path.includes('..')) { res.writeHead(400).end(); return }
  let file = join(root, path)
  try {
    const st = await stat(file)
    if (st.isDirectory()) { path = '/index.html'; file = join(root, 'index.html') }
  } catch {
    path = '/index.html'; file = join(root, 'index.html')
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': NO_CACHE.has(path) ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': body.length,
    })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serve-dist: http://127.0.0.1:${port}/ -> ${root}`)
})
