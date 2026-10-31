/**
 * Raw IndexedDB access for the platform specs: data migration, version
 * safety, large-data performance and the orphan sweep.
 *
 * helpers/idb.ts is read-only on purpose: ordinary specs make their state
 * through the UI. The subjects here are different. A migration test is ABOUT
 * the bytes an older build left on disk, so the only honest setup is to put
 * those bytes there; a performance test needs 500 notes that no one would
 * click into existence. Writes therefore live in this file only, each one
 * named for the reason it exists, and every write happens on a blank page of
 * the app's own origin or before the app reads the rows back.
 *
 * Binary fields travel to and from the page as base64 so a dump can be
 * re-seeded byte for byte; snapshots reduce them to length + SHA-256 so two
 * libraries compare row by row.
 */
import { createHash } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { APP_DB } from './idb.js'

export interface IndexSpec { name: string; keyPath: string | string[]; unique?: boolean; multiEntry?: boolean }
export interface StoreSpec { keyPath: string; indexes: IndexSpec[] }
export type Schema = Record<string, StoreSpec>
/** Rows per store. Binary fields are `{ __b64, __kind, __type? }` (see encode below). */
export type Rows = Record<string, Record<string, unknown>[]>

export interface DbDump {
  version: number
  schema: Schema
  rows: Rows
}

/** A row with every binary field reduced to { __bytes, __sha256 }. */
export type FlatRow = Record<string, unknown>
export interface RawSnapshot {
  version: number
  schema: Schema
  rows: Record<string, FlatRow[]>
}

const byProject: IndexSpec = { name: 'by-project', keyPath: 'projectId' }
const byDocument: IndexSpec = { name: 'by-document', keyPath: 'documentId' }
const byUser: IndexSpec = { name: 'by-user', keyPath: 'userId' }

/**
 * The stores and indexes connection.ts upgrade() creates, version by version.
 * v8 added lawEvents; v7 and v9 dropped the retired textBookmarks and
 * bookmarks stores; v11 is the no-op bump; v12 added recordTombstones; v13
 * added binaryIndex (keyPath 'key', by-project + by-sha).
 */
const CORE: Schema = {
  users: { keyPath: 'id', indexes: [] },
  projects: { keyPath: 'id', indexes: [byUser] },
  documents: { keyPath: 'id', indexes: [byProject] },
  searchText: { keyPath: 'id', indexes: [byDocument, byProject] },
  workspaceItems: { keyPath: 'id', indexes: [byProject, byDocument] },
  highlights: { keyPath: 'id', indexes: [byDocument, byProject] },
  itemLinks: { keyPath: 'id', indexes: [byProject] },
  areaLinks: { keyPath: 'id', indexes: [byProject, byDocument] },
  calendarEvents: { keyPath: 'id', indexes: [byProject] },
  canvasStrokes: { keyPath: 'id', indexes: [byProject] },
  highlightStrokeLinks: { keyPath: 'id', indexes: [byProject] },
  mediaBlobs: { keyPath: 'id', indexes: [byProject] },
  textHighlights: { keyPath: 'id', indexes: [byDocument, byProject] },
  textAreaLinks: { keyPath: 'id', indexes: [byDocument, byProject] },
}

export const SCHEMA = {
  /** Before law mode, with the two retired bookmark stores still present. */
  v6: { ...CORE, bookmarks: { keyPath: 'id', indexes: [byProject] }, textBookmarks: { keyPath: 'id', indexes: [byDocument, byProject] } } as Schema,
  v11: { ...CORE, lawEvents: { keyPath: 'id', indexes: [byUser] } } as Schema,
  v12: { ...CORE, lawEvents: { keyPath: 'id', indexes: [byUser] }, recordTombstones: { keyPath: 'id', indexes: [byProject] } } as Schema,
  v13: {
    ...CORE,
    lawEvents: { keyPath: 'id', indexes: [byUser] },
    recordTombstones: { keyPath: 'id', indexes: [byProject] },
    binaryIndex: { keyPath: 'key', indexes: [byProject, { name: 'by-sha', keyPath: 'sha256' }] },
  } as Schema,
}

/** The DB_VERSION this build opens (src/services/db/connection.ts). */
export const BUILD_DB_VERSION = 13

/**
 * A same-origin blank page (served by a route, so the app does not boot on
 * it): the place to prepare this profile's IndexedDB the way another build
 * left it. Navigating here also closes the app's own connection.
 */
export async function blankOnAppOrigin(page: Page) {
  await page.route('**/__automation_platform_blank', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' }))
  await page.goto('/__automation_platform_blank')
}

/** Every store of the app's database: schema, and rows with binary fields as base64 (re-seedable). */
export async function dumpDb(page: Page): Promise<DbDump> {
  return page.evaluate(async (db) => {
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(db)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const toB64 = (u8: Uint8Array) => {
      let bin = ''
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000))
      return btoa(bin)
    }
    const encode = async (v: unknown): Promise<unknown> => {
      if (v instanceof ArrayBuffer) return { __b64: toB64(new Uint8Array(v)), __kind: 'ArrayBuffer' }
      if (ArrayBuffer.isView(v)) return { __b64: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)), __kind: 'Uint8Array' }
      if (v instanceof Blob) return { __b64: toB64(new Uint8Array(await v.arrayBuffer())), __kind: 'Blob', __type: v.type }
      if (Array.isArray(v)) return Promise.all(v.map(encode))
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, x] of Object.entries(v)) out[k] = await encode(x)
        return out
      }
      return v
    }
    try {
      const schema: Record<string, { keyPath: string; indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[] }> = {}
      const rows: Record<string, unknown[]> = {}
      for (const name of [...conn.objectStoreNames]) {
        const tx = conn.transaction(name, 'readonly')
        const store = tx.objectStore(name)
        schema[name] = {
          keyPath: store.keyPath as string,
          indexes: [...store.indexNames].map((n) => {
            const ix = store.index(n)
            return { name: n, keyPath: ix.keyPath as string | string[], unique: ix.unique, multiEntry: ix.multiEntry }
          }),
        }
        const all = await new Promise<unknown[]>((res, rej) => {
          const q = store.getAll()
          q.onsuccess = () => res(q.result)
          q.onerror = () => rej(q.error)
        })
        rows[name] = await Promise.all(all.map(encode))
      }
      return { version: conn.version, schema, rows } as unknown as { version: number; schema: Schema; rows: Rows }
    } finally {
      conn.close()
    }
  }, APP_DB)
}

/**
 * Replace the app's database with `rows` laid out in `schema` at `version`.
 * Run on the blank page (blankOnAppOrigin) so no app connection is open.
 */
export async function seedDb(page: Page, version: number, schema: Schema, rows: Rows) {
  await page.evaluate(async ({ db, version, schema, rows }) => {
    await new Promise<void>((res, rej) => {
      const del = indexedDB.deleteDatabase(db)
      del.onsuccess = () => res()
      del.onerror = () => rej(del.error)
      del.onblocked = () => rej(new Error('deleteDatabase blocked: an app connection is still open'))
    })
    const decode = (v: unknown): unknown => {
      if (v && typeof v === 'object' && !Array.isArray(v) && '__b64' in (v as Record<string, unknown>)) {
        const o = v as { __b64: string; __kind: string; __type?: string }
        const u8 = Uint8Array.from(atob(o.__b64), (c) => c.charCodeAt(0))
        if (o.__kind === 'Blob') return new Blob([u8], { type: o.__type ?? '' })
        if (o.__kind === 'Uint8Array') return u8
        return u8.buffer
      }
      if (Array.isArray(v)) return v.map(decode)
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
      return v
    }
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(db, version)
      r.onupgradeneeded = () => {
        for (const [name, spec] of Object.entries(schema)) {
          const store = r.result.createObjectStore(name, { keyPath: spec.keyPath })
          for (const ix of spec.indexes) store.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry })
        }
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      const names = Object.keys(rows).filter((n) => rows[n].length > 0)
      if (names.length) {
        const tx = conn.transaction(names, 'readwrite')
        for (const n of names) for (const row of rows[n]) tx.objectStore(n).put(decode(row))
        await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error) })
      }
    } finally {
      conn.close()
    }
  }, { db: APP_DB, version, schema, rows })
}

/**
 * Add rows to the app's database at its current version, in one transaction.
 * For bulk performance setup only (500 notes, 100 projects): the app re-reads
 * them on the next load, exactly as it reads rows written by an earlier session.
 */
export async function putRows(page: Page, rows: Rows) {
  await page.evaluate(async ({ db, rows }) => {
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(db)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      const names = Object.keys(rows).filter((n) => rows[n].length > 0)
      const tx = conn.transaction(names, 'readwrite')
      for (const n of names) for (const row of rows[n]) tx.objectStore(n).put(row)
      await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error) })
    } finally {
      conn.close()
    }
  }, { db: APP_DB, rows })
}

/** Every store, schema included, with binary fields reduced to length + SHA-256. Read-only, opens without a version. */
export async function snapshotAll(page: Page): Promise<RawSnapshot> {
  return page.evaluate(async (db) => {
    const dbs = await indexedDB.databases()
    if (!dbs.some((d) => d.name === db)) throw new Error(`IndexedDB "${db}" does not exist`)
    const conn = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(db)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const flat = async (v: unknown): Promise<unknown> => {
      if (v instanceof ArrayBuffer) return { __bytes: v.byteLength, __sha256: hex(await crypto.subtle.digest('SHA-256', v)) }
      if (ArrayBuffer.isView(v)) return { __bytes: v.byteLength, __sha256: hex(await crypto.subtle.digest('SHA-256', new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer)) }
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
      const schema: Record<string, unknown> = {}
      const rows: Record<string, unknown[]> = {}
      for (const name of [...conn.objectStoreNames]) {
        const store = conn.transaction(name, 'readonly').objectStore(name)
        schema[name] = {
          keyPath: store.keyPath,
          indexes: [...store.indexNames].map((n) => ({ name: n, keyPath: store.index(n).keyPath, unique: store.index(n).unique, multiEntry: store.index(n).multiEntry })),
        }
        const all = await new Promise<unknown[]>((res, rej) => {
          const q = store.getAll()
          q.onsuccess = () => res(q.result)
          q.onerror = () => rej(q.error)
        })
        rows[name] = await Promise.all(all.map(flat))
      }
      return { version: conn.version, schema, rows } as unknown as { version: number; schema: Schema; rows: Record<string, Record<string, unknown>[]> }
    } finally {
      conn.close()
    }
  }, APP_DB)
}

/** The database's version as the browser lists it, without opening it (so nothing can upgrade it). */
export async function listedDbVersion(page: Page): Promise<number | undefined> {
  return page.evaluate(async (db) => (await indexedDB.databases()).find((d) => d.name === db)?.version, APP_DB)
}

/** Length + SHA-256 of a base64 field, the way snapshotAll reports a binary. */
export function flatOfB64(field: unknown): { __bytes: number; __sha256: string } {
  const b = Buffer.from((field as { __b64: string }).__b64, 'base64')
  return { __bytes: b.length, __sha256: createHash('sha256').update(b).digest('hex') }
}

/** A dump's rows as snapshotAll would report them (binary -> length + SHA-256, Blob type kept). */
export function flattenRows(rows: Rows): Record<string, FlatRow[]> {
  const flat = (v: unknown): unknown => {
    if (v && typeof v === 'object' && !Array.isArray(v) && '__b64' in (v as Record<string, unknown>)) {
      const o = v as { __kind: string; __type?: string }
      const f = flatOfB64(v)
      return o.__kind === 'Blob' ? { __bytes: f.__bytes, __type: o.__type ?? '', __sha256: f.__sha256 } : f
    }
    if (Array.isArray(v)) return v.map(flat)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, flat(x)]))
    return v
  }
  return Object.fromEntries(Object.entries(rows).map(([n, rs]) => [n, rs.map((r) => flat(r) as FlatRow)]))
}

/** Rows of one store keyed by their key path, with the named fields removed. */
export function keyed(rows: FlatRow[] | undefined, keyPath = 'id', omit: string[] = []): Record<string, FlatRow> {
  const out: Record<string, FlatRow> = {}
  for (const r of rows ?? []) {
    const copy = { ...r }
    for (const k of omit) delete copy[k]
    out[String(r[keyPath])] = copy
  }
  return out
}

/**
 * Assert every seeded row is still there, field for field, except `omit`
 * (fields the app legitimately rewrites when it opens a project or signs in,
 * each named by the caller with its reason).
 */
export function expectRowsKept(after: RawSnapshot, seeded: Record<string, FlatRow[]>, schema: Schema, omit: Record<string, string[]> = {}, label = 'after the upgrade') {
  for (const [store, rows] of Object.entries(seeded)) {
    const keyPath = schema[store]?.keyPath ?? 'id'
    expect(after.rows[store], `${label}: store ${store} exists`).toBeDefined()
    expect(keyed(after.rows[store], keyPath, omit[store]), `${label}: ${store}`).toEqual(keyed(rows, keyPath, omit[store]))
  }
}

/** SHA-256 hex of a string, the legacy (pre-H13) way the app stored a PIN. */
export function legacyPinHash(pin: string): string {
  return createHash('sha256').update(pin).digest('hex')
}
