/**
 * Read-only IndexedDB inspection, for asserting what the app persisted.
 *
 * Opens `cognitive-canvas` WITHOUT a version, so it can never trigger an
 * upgrade, and refuses to run if the database does not exist yet (a bare
 * open() would create an empty v1 database under the app's feet).
 *
 * The browser context is the test's own throwaway profile, so nothing here
 * can reach a real user's data. Writes are deliberately not offered: a test
 * changes state through the UI, then checks it here.
 */
import { expect, type Page } from '@playwright/test'

export const APP_DB = 'cognitive-canvas'

export type StoreName =
  | 'users' | 'projects' | 'documents' | 'searchText' | 'workspaceItems' | 'highlights' | 'itemLinks'
  | 'areaLinks' | 'calendarEvents' | 'canvasStrokes' | 'highlightStrokeLinks' | 'mediaBlobs'
  | 'textHighlights' | 'textAreaLinks' | 'lawEvents' | 'recordTombstones' | 'binaryIndex'

/** Every record in a store, with ArrayBuffer/Blob fields replaced by their byte length. */
export async function readStore<T = Record<string, unknown>>(page: Page, store: StoreName): Promise<T[]> {
  return page.evaluate(
    async ({ db, store }) => {
      const dbs = await indexedDB.databases()
      if (!dbs.some((d) => d.name === db)) throw new Error(`IndexedDB "${db}" does not exist yet`)
      const conn = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(db)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      try {
        if (!conn.objectStoreNames.contains(store)) throw new Error(`store "${store}" not in ${db}@${conn.version}`)
        const rows = await new Promise<unknown[]>((res, rej) => {
          const q = conn.transaction(store, 'readonly').objectStore(store).getAll()
          q.onsuccess = () => res(q.result)
          q.onerror = () => rej(q.error)
        })
        const flat = (v: unknown): unknown => {
          if (v instanceof ArrayBuffer) return { __bytes: v.byteLength }
          if (ArrayBuffer.isView(v)) return { __bytes: v.byteLength }
          if (v instanceof Blob) return { __bytes: v.size, __type: v.type }
          if (Array.isArray(v)) return v.map(flat)
          if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, flat(x)]))
          return v
        }
        return rows.map(flat)
      } finally {
        conn.close()
      }
    },
    { db: APP_DB, store },
  ) as Promise<T[]>
}

export async function dbInfo(page: Page): Promise<{ version: number; stores: string[] } | null> {
  return page.evaluate(async (db) => {
    const dbs = await indexedDB.databases()
    if (!dbs.some((d) => d.name === db)) return null
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(db)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const out = { version: conn.version, stores: [...conn.objectStoreNames].sort() }
    conn.close()
    return out
  }, APP_DB)
}

/**
 * Wait until a store holds `n` rows matching `where`. Saves are debounced
 * (300 ms for highlights/area links, longer for canvas items), so persistence
 * assertions poll instead of reading once.
 */
export async function expectStoreCount(page: Page, store: StoreName, n: number, where: (row: Record<string, unknown>) => boolean = () => true, timeout = 10_000) {
  await expect
    .poll(async () => (await readStore(page, store)).filter(where).length, { message: `${store} rows`, timeout })
    .toBe(n)
}
