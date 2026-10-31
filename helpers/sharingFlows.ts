/**
 * Infrastructure for the sharing specs: reading what a device holds after a
 * share arrives (IndexedDB, with real byte digests rather than lengths), the
 * app's sharing localStorage, and the few multi-screen set-ups every sharing
 * spec repeats (a project with documents, a class made through the UI).
 */
import { expect, type Page } from '@playwright/test'
import type { CognitiveCanvas } from '../pages/CognitiveCanvas.js'
import type { FilePayload } from '../data/files.js'
import { readStore } from './idb.js'
import { sha256, unzip, zipJson } from './mocks/sharingBackend.js'

export interface DocDigest { id: string; projectId: string; name: string; bytes: number; sha256: string; compressedSize: number | null }

/** Every document on the device with the SHA-256 of its stored bytes. */
export async function documentDigests(page: Page): Promise<DocDigest[]> {
  return page.evaluate(async () => {
    const conn = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('cognitive-canvas'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    try {
      const rows = await new Promise<Array<Record<string, unknown>>>((res, rej) => {
        const q = conn.transaction('documents', 'readonly').objectStore('documents').getAll()
        q.onsuccess = () => res(q.result as Array<Record<string, unknown>>); q.onerror = () => rej(q.error)
      })
      const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
      const out = []
      for (const r of rows) {
        const data = r.data instanceof ArrayBuffer ? r.data : new ArrayBuffer(0)
        out.push({ id: String(r.id), projectId: String(r.projectId), name: String(r.name), bytes: data.byteLength, sha256: hex(await crypto.subtle.digest('SHA-256', data)), compressedSize: (r.compressedSize as number | null) ?? null })
      }
      return out
    } finally { conn.close() }
  })
}

export interface ProjectRow { id: string; name: string; userId: string; sourceProjectId?: string; sourceIdMap?: Record<string, string>; liveShareId?: string }
export const projectRows = (page: Page) => readStore<ProjectRow>(page, 'projects')

export async function localJson<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null }, key)
}

/** A snapshot ZIP's entries (as uploaded) with the parsed project and document metas. */
export function readSnapshot(zip: Buffer) {
  const files = unzip(zip)
  const names = Object.keys(files).sort()
  const docIds = [...new Set(names.map((n) => /^documents\/([^/]+)\//.exec(n)?.[1]).filter((x): x is string => !!x))]
  return {
    names,
    files,
    manifest: zipJson<{ version: number; appName: string; type: string; projectIds: string[]; projectNames?: string[] }>(files, 'manifest.json'),
    project: zipJson<{ id: string; name: string }>(files, 'project.json'),
    json: <T>(name: string) => zipJson<T>(files, name),
    docIds,
    docMeta: (id: string) => zipJson<{ id: string; name: string; projectId: string }>(files, `documents/${id}/meta.json`),
    fileSha: (path: string) => (files[path] ? sha256(files[path]) : null),
  }
}

/**
 * Create a project and put documents in it, then return to Home. One file
 * opens in the viewer after upload; several stay on the list.
 */
export async function projectWithDocs(app: CognitiveCanvas, name: string, docs: FilePayload[]) {
  await app.home.createProject(name)
  await app.documents.expectOpen(name)
  if (docs.length === 1) {
    await app.documents.uploadFiles(docs[0])
    await expect(app.page.getByRole('button', { name: 'Go to home' })).toBeVisible()
  } else if (docs.length > 1) {
    await app.documents.uploadMany(docs)
  }
  // This project's own documents, saved (pdf.js processing is CPU-bound on a loaded machine).
  await expect.poll(async () => {
    const project = (await readStore<{ id: string; name: string }>(app.page, 'projects')).find((p) => p.name === name)
    return (await readStore<{ projectId: string }>(app.page, 'documents')).filter((d) => d.projectId === project?.id).length
  }, { timeout: 45_000, message: `documents of ${name} saved` }).toBe(docs.length)
  await app.home.reach()
  await expect(app.home.card(name)).toBeVisible()
}
