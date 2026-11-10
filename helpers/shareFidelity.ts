/**
 * Does what a recipient holds equal what the sender sent? Both sides are
 * whole-library snapshots (helpers/backupState.ts: every field, every binary
 * by length and SHA-256), so "arrived" means identical, not "the counts match".
 *
 * A copy lives under new ids: the recipient's project row maps every sender
 * id to its local one (sourceIdMap; restoreService.ts stores the whole map),
 * so the sender's rows are rewritten through that map and must then equal the
 * recipient's, field by field. A live copy keeps the sender's ids (no map).
 *
 * Fields that differ by design are left out, each with its reason (SHARE_VOLATILE).
 * One known defect is stepped around so the comparison still guards everything
 * else; it has its own test that fails until it is fixed:
 *   DEF-507  an extracted image's data.sourceDocumentId keeps the sender's
 *            document id (REG-890 mocked, REG-914 live).
 */
import { expect } from '@playwright/test'
import { byId, VOLATILE, type Row, type Snapshot } from './backupState.js'
import type { StoreName } from './idb.js'
import { readStore } from './idb.js'
import type { Page } from '@playwright/test'

export const SHARE_VOLATILE: Partial<Record<StoreName, string[]>> = {
  ...VOLATILE,
  // The recipient's own project row: whose it is, where it came from, and (a live copy) the sync
  // bookkeeping its app keeps to merge the next push: the teacher's document order and baseline.
  projects: [...VOLATILE.projects!, 'userId', 'sourceProjectId', 'sourceIdMap', 'liveShareId', 'documentOrder', 'liveSyncStates'],
  // A live merge stamps a media file with the time it arrived (its bytes are still compared, by SHA-256).
  mediaBlobs: ['updatedAt'],
}

/** Every string that is a sender id becomes the recipient's id for it, at any depth. */
function mapIds(v: unknown, idMap: Record<string, string>): unknown {
  if (typeof v === 'string') return idMap[v] ?? v
  if (Array.isArray(v)) return v.map((x) => mapIds(x, idMap))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapIds(x, idMap)]))
  return v
}

/** DEF-507: the one field left out of the comparison (see above). */
function withoutDef507(store: StoreName, row: Row): Row {
  if (store !== 'workspaceItems' || !row.data || typeof row.data !== 'object') return row
  const { sourceDocumentId: _source, ...data } = row.data as Record<string, unknown>
  return { ...row, data }
}

/** Assert the recipient's snapshot holds exactly the sender's rows, ids mapped, except SHARE_VOLATILE. */
export function expectSameAsSent(received: Snapshot, sent: Snapshot, idMap: Record<string, string>, label: string) {
  for (const store of Object.keys(sent) as StoreName[]) {
    const mapped = (sent[store] ?? []).map((r) => withoutDef507(store, mapIds(r, idMap) as Row))
    const got = (received[store] ?? []).map((r) => withoutDef507(store, r))
    expect(byId(got, SHARE_VOLATILE[store]), `${label}: ${store}`).toEqual(byId(mapped, SHARE_VOLATILE[store]))
  }
}

/** The recipient's copy of `title`: its project row and the sender-to-local id map. */
export async function receivedCopy(page: Page, title: string) {
  const rows = (await readStore<{ id: string; name: string; sourceIdMap?: Record<string, string> }>(page, 'projects')).filter((p) => p.name === title)
  expect(rows, `one copy of "${title}"`).toHaveLength(1)
  return { projectId: rows[0].id, idMap: rows[0].sourceIdMap ?? {} }
}
