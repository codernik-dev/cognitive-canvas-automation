/**
 * Whole-library snapshots for the backup round-trip specs.
 *
 * readStore() (helpers/idb.ts) replaces binary fields by their length, which
 * is enough to count rows but not to prove a PDF or a recording came back
 * byte-for-byte. snapshotDb() reads every store read-only (no version, no
 * writes, same guard as idb.ts) and replaces each ArrayBuffer / view / Blob by
 * its length AND its SHA-256, so two snapshots compare row-by-row, field-by-
 * field, bytes included.
 */
import { expect, type Page } from '@playwright/test'
import { APP_DB, type StoreName } from './idb.js'

export type Row = Record<string, unknown> & { id: string }
export type Snapshot = Partial<Record<StoreName, Row[]>>

export const PROJECT_STORES: StoreName[] = [
  'projects', 'documents', 'workspaceItems', 'highlights', 'itemLinks', 'areaLinks', 'calendarEvents',
  'canvasStrokes', 'highlightStrokeLinks', 'mediaBlobs', 'textHighlights', 'textAreaLinks', 'searchText',
]

export async function snapshotDb(page: Page, stores: StoreName[] = PROJECT_STORES): Promise<Snapshot> {
  return page.evaluate(
    async ({ db, stores }) => {
      const dbs = await indexedDB.databases()
      if (!dbs.some((d) => d.name === db)) throw new Error(`IndexedDB "${db}" does not exist yet`)
      const conn = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(db)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
      const flat = async (v: unknown): Promise<unknown> => {
        if (v instanceof ArrayBuffer) return { __bytes: v.byteLength, __sha256: hex(await crypto.subtle.digest('SHA-256', v)) }
        if (ArrayBuffer.isView(v)) {
          const copy = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer
          return { __bytes: v.byteLength, __sha256: hex(await crypto.subtle.digest('SHA-256', copy)) }
        }
        if (v instanceof Blob) return { __bytes: v.size, __type: v.type, __sha256: hex(await crypto.subtle.digest('SHA-256', await v.arrayBuffer())) }
        if (Array.isArray(v)) return Promise.all(v.map(flat))
        if (v && typeof v === 'object') {
          const out: Record<string, unknown> = {}
          for (const [k, x] of Object.entries(v)) out[k] = await flat(x)
          return out
        }
        return v
      }
      try {
        const out: Record<string, unknown[]> = {}
        for (const store of stores) {
          if (!conn.objectStoreNames.contains(store)) throw new Error(`store "${store}" not in ${db}@${conn.version}`)
          const rows = await new Promise<unknown[]>((res, rej) => {
            const q = conn.transaction(store, 'readonly').objectStore(store).getAll()
            q.onsuccess = () => res(q.result)
            q.onerror = () => rej(q.error)
          })
          out[store] = await Promise.all(rows.map(flat))
        }
        return out
      } finally {
        conn.close()
      }
    },
    { db: APP_DB, stores },
  ) as Promise<Snapshot>
}

/** Rows of a store keyed by id, with the named fields removed (fields that legitimately change). */
export function byId(rows: Row[] | undefined, omit: string[] = []): Record<string, Row> {
  const out: Record<string, Row> = {}
  for (const r of rows ?? []) {
    const copy = { ...r }
    for (const k of omit) delete copy[k]
    out[r.id] = copy
  }
  return out
}

/** Rows that belong to one project. */
export function ofProject(snap: Snapshot, projectId: string): Snapshot {
  const out: Snapshot = {}
  for (const [store, rows] of Object.entries(snap) as [StoreName, Row[]][]) {
    out[store] = store === 'projects' ? rows.filter((r) => r.id === projectId) : rows.filter((r) => r.projectId === projectId)
  }
  return out
}

/**
 * The stores a restore writes. searchText is not in a backup: it is rebuilt
 * when a restored project's document list is opened, with new ids.
 */
export const RESTORED_STORES: StoreName[] = PROJECT_STORES.filter((s) => s !== 'searchText')

/**
 * Fields a restore rewrites by design (restoreService.ts): the project row's
 * updatedAt / lastOpenedAt are stamped with the restore time, and so is
 * createdAt (restoreService sets it on purpose; nothing shows it today). A document's reading
 * position (lastReadPage/ScrollY, lastOpenedAt) moves whenever it is opened.
 */
export const VOLATILE: Partial<Record<StoreName, string[]>> = {
  projects: ['createdAt', 'updatedAt', 'lastOpenedAt'],
  documents: ['lastReadPage', 'lastReadScrollY', 'lastOpenedAt'],
}

/** searchText compared by content, since its ids are new after a rebuild. */
export const searchKey = (rows: Row[] | undefined) => (rows ?? []).map((r) => `${String(r.documentId)}#${String(r.pageNumber)}#${String(r.text)}`).sort()

/** Assert two snapshots hold the same rows, field by field, except the VOLATILE fields. */
export function expectSameLibrary(after: Snapshot, before: Snapshot, label: string) {
  for (const store of Object.keys(before) as StoreName[]) {
    if (store === 'searchText') {
      expect(searchKey(after.searchText), `${label}: searchText content`).toEqual(searchKey(before.searchText))
      continue
    }
    expect(byId(after[store], VOLATILE[store]), `${label}: ${store}`).toEqual(byId(before[store], VOLATILE[store]))
  }
}
