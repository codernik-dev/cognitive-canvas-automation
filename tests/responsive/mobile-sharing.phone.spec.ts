/**
 * Sharing on a phone (Pixel 5, project "phone"): the compact Sharing screen
 * (SharingPage.tsx phone header: no subtitle, search under the title, pill
 * tabs), compact share rows (ShareCard compact), received rows
 * (ReceivedBoard phone rows), and the full-screen panels that replace the
 * desktop side panels (ShareDetailPanel / ClassesBoard ManagePanel render a
 * full-screen dialog on a phone, an <aside> elsewhere). Entry points: the
 * Menu sheet's Sharing row and the Share button on a phone project row.
 *
 * The desktop screens are covered in tests/regression/sharing-board.spec.ts,
 * share-flow.spec.ts and sharing-received.spec.ts. Stateful fake backend
 * (helpers/mocks/sharingBackend.ts): the app's side of the contract only.
 */
import { sharingTest as test, expect } from '../../fixtures/mobile.js'
import { STUDENT, COLLEAGUE } from '../../fixtures/sharing.js'
import { SharingScreen, ShareComposerDialog, NewGroupDialog } from '../../pages/SharingScreen.js'
import { projectRows, projectWithDocs } from '../../helpers/sharingFlows.js'
import { FIND_PDF } from '../../data/files.js'

const TEACHER = 'e2e-user-0001'
const sendPaths = /^\/api\/sharing\/(threads\/[^/]+\/shares|lists\/[^/]+\/shares|live)$/

test.describe('Sharing on a phone', { tag: ['@regression', '@mobile', '@api'] }, () => {
  test.beforeEach(({ sharing }) => {
    sharing.addPerson(STUDENT, false)
  })

  test('REG-838 the Menu sheet\'s Sharing row opens the compact Sharing screen: title without subtitle, search under it, pill tabs with counts, and a stacked empty state', { tag: '@P2' }, async ({ signedIn: _app, mobile, page }) => {
    const screen = new SharingScreen(page)
    await mobile.menu.choose('Sharing')
    await mobile.menu.expectClosed()
    await expect(screen.heading).toBeVisible()
    await expect(page.getByText('What you’ve shared, live or as a copy.')).toHaveCount(0) // the subtitle is desktop-only
    await expect(screen.search).toHaveAttribute('placeholder', 'Search')
    const header = (await screen.heading.boundingBox())!
    expect((await screen.search.boundingBox())!.y).toBeGreaterThan(header.y + header.height) // below the title, not beside it
    await expect(screen.tab('Shares')).toHaveAccessibleName('Shares 0')
    await expect(screen.tab('Received')).toHaveAccessibleName('Received 0')
    await expect(screen.tab('Classes & people')).toHaveAccessibleName('Classes & people 0')
    await expect(screen.tab('Shares')).toHaveClass(/rounded-full/) // pills, not underlined tabs
    await expect(page.getByText(/sorted by recent$/)).toHaveCount(0) // the people/classes summary is desktop-only
    await expect(page.getByRole('heading', { name: 'Nothing shared yet' })).toBeVisible()
    await expect(mobile.nav.tab('Library')).toBeVisible() // the phone bottom bar stays on Sharing
    await screen.back.click()
    await expect(mobile.home.newName).toBeVisible()
  })

  test('REG-839 a copy shared from a phone project row reaches the person, then shows as a compact row whose details open full screen', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, mobile, page, sharing }) => {
    await projectWithDocs(app, 'Phone Share', [FIND_PDF.payload()])
    const [project] = await projectRows(page)
    // A phone row carries its own Share button (no hover to reveal a menu).
    await mobile.home.shareButton('Phone Share').click()
    const c = new ShareComposerDialog(page)
    await c.expectOpen()
    await expect(c.project).toHaveValue(project.id)
    await c.how('Copy').click()
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')
    await expect(c.dialog).toBeHidden()
    const sent = sharing.callsTo('POST', sendPaths)
    expect(sent.map((x) => x.path)).toEqual([`/api/sharing/threads/${STUDENT.sub}/shares`])
    expect(sent[0].form!.get('projectId')!.text).toBe(project.id)
    expect(sharing.inboxOf(STUDENT.sub).map((n) => ({ from: n.fromUserId, title: n.title }))).toEqual([{ from: TEACHER, title: 'Phone Share' }])

    const screen = new SharingScreen(page)
    await mobile.menu.choose('Sharing')
    await expect(screen.tab('Shares')).toHaveAccessibleName('Shares 1')
    const row = page.getByRole('button').filter({ hasText: 'Phone Share' }).filter({ hasText: 'Sam Student' })
    await expect(row).toHaveAttribute('aria-pressed', 'false')
    await expect(row).toContainText(`Sam Student · ${FIND_PDF.displayName}`)
    await row.click()
    // Full screen on a phone: a modal dialog named by the share, not the desktop side panel.
    const details = page.getByRole('dialog', { name: 'Phone Share' })
    await expect(details).toBeVisible()
    await expect(screen.detail).toHaveCount(0)
    const box = (await details.boundingBox())!
    expect(box.width).toBeCloseTo(page.viewportSize()!.width, 0)
    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()
  })

  test('REG-840 something received shows as a phone row: title, sender, status and its action, grouped by when it arrived, and the search narrows it', { tag: '@P2' }, async ({ signedIn: _app, mobile, page, sharing }) => {
    sharing.addPerson(COLLEAGUE, true)
    const empty = { itemSummary: 'Project copy', icon: '📄', zip: Buffer.alloc(0) }
    sharing.seedCopy(COLLEAGUE.sub, TEACHER, { title: 'Fresh Pack', projectId: 'p1', documentIds: [], documents: [], ...empty, createdAt: Date.now() - 60_000 }, { imported: true, seen: true })
    sharing.seedCopy(COLLEAGUE.sub, TEACHER, { title: 'Old Pack', projectId: 'p3', documentIds: [], documents: [], ...empty, createdAt: Date.now() - 20 * 86_400_000 }, { imported: true, seen: true })
    const screen = new SharingScreen(page)
    await mobile.menu.choose('Sharing')
    await screen.tab('Received').click()
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Today', 'Earlier'])
    // A phone row: the data-note-id row with no card cover grid (desktop cards are rounded panels).
    const fresh = page.locator('[data-note-id]').filter({ hasText: 'Fresh Pack' })
    await expect(fresh).toContainText('from Tara Teacher')
    await expect(fresh).not.toHaveClass(/rounded-2xl/)
    await expect(screen.receivedCard('Fresh Pack')).toHaveCount(0)
    await screen.search.fill('old')
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Earlier'])
    await expect(fresh).toHaveCount(0)
    await screen.search.fill('')
    await expect(page.locator('[data-note-id]')).toHaveCount(2)
  })

  test('REG-841 a class created on a phone opens its manage panel full screen, and the class is saved on the server', { tag: '@P2' }, async ({ signedIn: _app, mobile, page, sharing }) => {
    const screen = new SharingScreen(page)
    await mobile.menu.choose('Sharing')
    await screen.tab('Classes & people').click()
    await screen.newClass.click()
    const group = new NewGroupDialog(page)
    await group.name.fill('Phone Class')
    await group.search.fill(STUDENT.email)
    await group.resultRow(STUDENT.email).getByRole('button', { name: 'Add', exact: true }).click()
    await group.create.click()
    const panel = page.getByRole('dialog', { name: 'Phone Class' })
    await expect(panel).toBeVisible()
    await expect(screen.managePanel('Phone Class')).toHaveCount(0) // not the desktop <aside>
    expect((await panel.boundingBox())!.width).toBeCloseTo(page.viewportSize()!.width, 0)
    await expect(panel.getByRole('button', { name: 'Share to class' })).toBeVisible()
    const lists = sharing.listsOf(TEACHER)
    expect(lists.map((l) => ({ name: l.name, memberIds: l.memberIds }))).toEqual([{ name: 'Phone Class', memberIds: [STUDENT.sub] }])
  })
})
