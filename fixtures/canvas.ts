/**
 * Canvas-module fixtures, layered on fixtures/test.ts.
 *
 *   ws       the canvas workbench (components/CanvasWorkbench.ts) on an open
 *            FIND_PDF (`pdfOpen`), with the canvas transform settled
 *   dialogs  the media / document / editor dialogs that open from the canvas
 *   docId    the open document's id, read back from IndexedDB, so specs can
 *            assert that new items belong to it
 *
 * Everything else (network guard, page-error guard, isolation) is inherited.
 */
import { test as base, expect } from './test.js'
import { CanvasWorkbench, CanvasDialogs } from '../components/CanvasWorkbench.js'
import { readStore } from '../helpers/idb.js'
import { FIND_PDF } from '../data/files.js'

interface CanvasFixtures {
  ws: CanvasWorkbench
  dialogs: CanvasDialogs
  docId: string
}

export const test = base.extend<CanvasFixtures>({
  ws: async ({ pdfOpen: _pdf, page }, provide) => {
    const ws = new CanvasWorkbench(page)
    await expect(ws.surface).toBeVisible()
    // The canvas fits itself once its pane has a size; wait for that to stop moving.
    await ws.settled()
    await provide(ws)
  },
  dialogs: async ({ page }, provide) => {
    await provide(new CanvasDialogs(page))
  },
  docId: async ({ pdfOpen: _pdf, page }, provide) => {
    let id: string | undefined
    await expect
      .poll(async () => (id = (await readStore<{ id: string; name: string }>(page, 'documents')).find((d) => d.name === FIND_PDF.displayName)?.id), { message: 'open document row' })
      .toBeTruthy()
    await provide(id!)
  },
})

export { expect }

/** The workspaceItems row shape the canvas specs read. */
export interface ItemRow<D = Record<string, unknown>> {
  id: string
  projectId: string
  documentId: string | null
  type: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  createdAt: number
  updatedAt: number
  data: D
}

export interface StrokeRow { id: string; documentId: string | null; points: Array<{ x: number; y: number; pressure: number }>; color: string; width: number }
export interface LinkRow { id: string; fromItemId: string; toItemId: string }
