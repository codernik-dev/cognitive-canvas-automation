/**
 * A share snapshot ZIP in the app's export format (backupService.ts, 'single'),
 * built in memory, for specs that need something already in a recipient's inbox
 * without a sender's browser producing it:
 *
 *   manifest.json            {version:1, appName:'cognitive-canvas', type:'single', projectIds, projectNames}
 *   project.json             the sender's project row
 *   data/<store>.json        every JSON store, empty unless given
 *   documents/<id>/meta.json the document row without its bytes
 *   documents/<id>/file.pdf  the bytes
 */
import { zipSync, strToU8 } from 'fflate'

export interface SnapshotDoc { id: string; name: string; pdf: Buffer; pageCount: number }

const STORES = ['workspaceItems', 'highlights', 'itemLinks', 'areaLinks', 'calendarEvents', 'canvasStrokes', 'highlightStrokeLinks', 'textHighlights', 'textAreaLinks']

export function buildShareSnapshot(project: { id: string; name: string }, docs: SnapshotDoc[], data: Partial<Record<string, unknown[]>> = {}): Buffer {
  const now = Date.UTC(2026, 9, 1)
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify({ version: 1, appName: 'cognitive-canvas', type: 'single', exportedAt: now, projectIds: [project.id], projectNames: [project.name] })),
    'project.json': strToU8(JSON.stringify({
      id: project.id, userId: 'sender-local-user', name: project.name, description: '', createdAt: now, updatedAt: now, lastOpenedAt: now,
      thumbnailDataUrl: null, settings: { noiseWords: [], includeWords: [] }, documentOrder: docs.map((d) => d.id),
    })),
  }
  for (const s of STORES) files[`data/${s}.json`] = strToU8(JSON.stringify(data[s] ?? []))
  for (const d of docs) {
    files[`documents/${d.id}/meta.json`] = strToU8(JSON.stringify({
      id: d.id, projectId: project.id, name: d.name, pageCount: d.pageCount, fileSize: d.pdf.length, compressedSize: null,
      createdAt: now, updatedAt: now, lastReadPage: 1, lastReadScrollY: 0,
    }))
    files[`documents/${d.id}/file.pdf`] = new Uint8Array(d.pdf)
  }
  return Buffer.from(zipSync(files))
}
