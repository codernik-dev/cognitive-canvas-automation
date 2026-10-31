/**
 * Documents on a tablet (1024x1366 Chromium with a touchscreen, project
 * "tablet", a finger-first device by utils/environment.ts):
 *
 *   - a scanned PDF uploaded into a project is OCR'd in the background when
 *     it is 30 MB or smaller (DocumentListView.tsx AUTO_OCR_TABLET_MAX_BYTES);
 *     desktop has no cap and a phone never does it (REG-876);
 *   - the 50 MB PDF limit of phones and tablets also guards the canvas
 *     Document tool's "Upload Local" (DocumentPickerModal.tsx), in its own
 *     words. The file is a sparse file of 50 MB + 1 byte in the test's output
 *     folder: the check reads only file.size.
 */
import { test, expect } from '../../fixtures/mobile.js'
import { openPdfOnTablet } from '../../helpers/mobileFlows.js'
import { readStore } from '../../helpers/idb.js'
import { bigFile } from '../../data/canvas-files.js'
import { oneWordScan } from '../../data/documents-files.js'
import { documentByName, searchRows, waitForPages, wordsOf } from '../../helpers/documents.js'
import { OCR_PAGE_TIMEOUT } from '../../components/DocumentsOcr.js'
import { CanvasDialogs } from '../../components/CanvasWorkbench.js'

const MB = 1024 * 1024

test.describe('Documents on a tablet', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-877 a small scanned PDF uploaded into a project on a tablet is read by OCR in the background, without anyone asking', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    // One page of background recognition on a loaded machine.
    test.setTimeout(240_000)
    const scan = await oneWordScan(page, 'OCRTABLETWORD', 'automation-tablet-scan')
    expect(scan.payload.buffer.length).toBeLessThan(30 * MB)
    await app.documents.uploadFiles(scan.payload)
    await expect(app.viewer.documentTitle(scan.displayName)).toBeVisible({ timeout: 30_000 })
    const doc = await documentByName(page, scan.displayName)
    // No OCR dialog, no Find: the stored text appears on its own.
    await waitForPages(page, doc.id, [1], OCR_PAGE_TIMEOUT)
    const [row] = await searchRows(page, doc.id)
    expect(wordsOf(row.text)).toContain('OCRTABLETWORD')
    expect(row.words?.length).toBeGreaterThan(0)
  })

  test('REG-878 on a tablet the canvas Document tool refuses to embed a PDF over 50 MB, saying the limit on this device', { tag: '@P3' }, async ({ project: _p, app, page }, testInfo) => {
    await openPdfOnTablet(app, null)
    const over = bigFile(testInfo.outputPath('embed-over.pdf'), 50 * MB + 1)
    const dialogs = new CanvasDialogs(page)
    await app.canvas.place('document', 0.5, 0.5)
    await expect(dialogs.documentPicker).toBeVisible()
    await dialogs.documentPicker.getByRole('button', { name: /Upload Local/ }).click()
    const chooser = page.waitForEvent('filechooser')
    await dialogs.documentPicker.getByRole('button', { name: /Click to select a PDF file/ }).click()
    await (await chooser).setFiles(over.path)
    await expect(dialogs.documentPicker.getByRole('alert')).toHaveText('"embed-over.pdf" is too large (50.0 MB). The limit on this device is 50 MB.')
    expect((await readStore(page, 'documents')).length).toBe(1) // only the open PDF
    expect((await readStore<{ type: string }>(page, 'workspaceItems')).filter((i) => i.type === 'document')).toEqual([])
    over.remove()
  })
})
