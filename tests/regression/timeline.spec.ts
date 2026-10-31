/**
 * Regression: the Timeline view (TimelineView.tsx, WorkspaceBottomBar.tsx,
 * WorkspacePane.tsx): what it lists, in which order, under which day, and
 * what clicking an entry does. Entries carry the item's id (data-item-id),
 * which is how order and selection are read.
 */
import { test, expect, type ItemRow } from '../../fixtures/canvas.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'

test.describe('Timeline view', { tag: ['@regression', '@canvas', '@timeline'] }, () => {
  test('REG-389 the timeline lists the document\'s items oldest first under "Today", each with its time and type, and a click selects it', { tag: '@P2' }, async ({ ws, page }) => {
    // Before anything exists the timeline says so, and the toggle brings the canvas back.
    await ws.timelineToggle.click()
    await expect(page.getByText('No items yet — notes will appear here chronologically')).toBeVisible()
    await expect(ws.timelineToggle).toHaveAccessibleName('Canvas view')
    await ws.timelineToggle.click()
    await expect(ws.surface).toBeVisible()
    await expect(ws.emptyHint).toBeVisible()

    const note = (await ws.place('note', 0.3, 0.3))!
    await ws.writeNote(note, 'First thought')
    const text = (await ws.place('text', 0.6, 0.6))!
    await ws.tool('line').click()
    await ws.drag(await ws.at(0.2, 0.8), await ws.at(0.5, 0.85))
    await expectStoreCount(page, 'workspaceItems', 3)
    const byAge = (await readStore<ItemRow>(page, 'workspaceItems')).sort((a, b) => a.createdAt - b.createdAt)

    await ws.timelineToggle.click()
    const timeline = page.locator('div.max-w-2xl')
    const entries = timeline.locator('[data-item-id]')
    await expect(entries).toHaveCount(3)
    expect(await entries.evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')))).toEqual(byAge.map((r) => r.id))
    await expect(timeline.getByText('Today', { exact: true })).toBeVisible()
    for (const [i, r] of byAge.entries()) {
      const time = new Date(r.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
      await expect(entries.nth(i)).toContainText(time)
      await expect(entries.nth(i).locator('span.capitalize')).toHaveText(r.type)
    }
    await expect(entries.nth(0)).toContainText('First thought')

    // While the timeline shows, the canvas, its tools, zoom and mini-map are put away.
    await expect(ws.surface).toHaveCount(0)
    await expect(ws.tool('pan')).toHaveCount(0)
    await expect(ws.zoomIn).toHaveCount(0)
    await expect(ws.minimapToggle).toHaveCount(0)

    await timeline.locator(`[data-item-id="${note}"]`).click()
    await expect(timeline.locator(`[data-item-id="${note}"] > div.border-primary-500`)).toBeVisible()
    await ws.timelineToggle.click()
    await ws.expectSelected(note)
    await expect(ws.item(text)).toBeVisible()
  })
})
