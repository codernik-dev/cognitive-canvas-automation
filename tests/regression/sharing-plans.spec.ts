/**
 * Regression: what each plan may do with sharing (board/shareGuard.ts,
 * hooks/useCanShare.ts, the gates in ShareComposer / ClassesBoard /
 * LiveShareControl / SharingPage), with the caps from the server's
 * entitlements contract fixture (src/services/subscription/__fixtures__):
 * Free receives only; Economy sends copies to up to 10 people, no classes, no
 * Live; Pro has Live and up to 5 classes; Enterprise has no class cap; a paused
 * Pro reads as Free. The messages are the app's own exact wording.
 * Mocked backend (stateful fake): proves the app's side of the contract only.
 */
import { test, expect, STUDENT, STUDENT_2 } from '../../fixtures/sharing.js'
import type { MuulIdentity } from '../../helpers/mocks/muulAccount.js'
import { FIND_PDF } from '../../data/files.js'
import { SharingScreen, ShareComposerDialog, NewGroupDialog } from '../../pages/SharingScreen.js'
import { projectWithDocs } from '../../helpers/sharingFlows.js'

const TEACHER = 'e2e-user-0001'
const sendPaths = /^\/api\/sharing\/(threads\/[^/]+\/shares|lists\/[^/]+\/shares|live)$/

test.describe('Sharing on Free', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.use({ muulPlan: 'free' })

  test('REG-575 a Free account is offered no Share anywhere: not on a project card, not in Select mode, not in the workspace header', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'Free Project', [FIND_PDF.payload()])
    await app.home.openProject('Free Project')
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await expect.poll(() => sharing.callsTo('GET', '/api/sharing/overview').length).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Share this PDF — a copy, a live copy, or to a group' })).toHaveCount(0)

    await app.home.reach()
    await app.home.card('Free Project').getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)
    await app.home.newProjectName.click() // closes the menu
    await app.home.selectMode.click()
    await app.home.card('Free Project').click()
    await expect(page.getByText('1 selected').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete', exact: true }).first()).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)
  })
})

test.describe('Sharing on Economy', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.use({ muulPlan: 'dev' })

  test('REG-576 Economy sends copies only: the Share dialog has no Live and no classes, and making a class says it needs Pro', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    sharing.addPerson(STUDENT, false)
    sharing.seedList(TEACHER, 'Old Class', [STUDENT.sub]) // made before a downgrade: still listed
    await projectWithDocs(app, 'Eco Project', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await expect(c.how('Copy')).toHaveAttribute('aria-checked', 'true')
    await expect(c.how('Live')).toHaveCount(0)
    await expect(c.dialog.getByText('They get today’s version. Later changes stay with you.')).toBeVisible()
    await expect(c.dialog.getByText(/^Classes( · \d+)?$/)).toHaveCount(0)
    await c.newClass.click()
    await app.toasts.expectShown('Sending to a class needs the Pro plan.')
    await expect(new NewGroupDialog(page).dialog).toBeHidden()
    await c.cancel.click()

    await screen.tab('Classes & people').click()
    await expect(screen.classCard('Old Class')).toBeVisible()
    await screen.newClass.click()
    await app.toasts.expectShown('Classes need the Pro plan.')
    await screen.classCard('Old Class').getByRole('button', { name: 'Share to class' }).click()
    await app.toasts.expectShown('Sending to a class needs the Pro plan.')
    await expect(c.dialog).toBeHidden()
    expect(sharing.callsTo('POST', /^\/api\/sharing\/lists/)).toEqual([])
  })

  test('REG-577 Economy shares with up to 10 people: an 11th is refused with the plan\'s words, a re-send to someone already shared with is not', { tag: ['@P1'] }, async ({ signedIn: app, page, sharing }) => {
    const ten: MuulIdentity[] = Array.from({ length: 10 }, (_, i) => ({ sub: `e2e-reader-${i}`, email: `reader.${i}@example.invalid`, firstName: 'Reader', lastName: `No${i}`, orgId: `e2e-org-r${i}` }))
    for (const p of ten) { sharing.addPerson(p, false); sharing.seedThread(TEACHER, p.sub) }
    sharing.addPerson(STUDENT, false)
    await projectWithDocs(app, 'Eco Project', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    const refusal = 'Economy lets you share with up to 10 people, and this would make 11. Remove someone you\'ve shared with, or upgrade to Pro.'
    await expect(c.alert(refusal)).toBeVisible()
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown(refusal)
    expect(sharing.callsTo('POST', sendPaths)).toEqual([])

    await c.removeChip('Sam Student').click()
    await expect(c.alert(refusal)).toBeHidden()
    await (await c.findPerson(ten[3].email, 'Reader No3')).click()
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')
    expect(sharing.callsTo('POST', sendPaths).map((x) => x.path)).toEqual([`/api/sharing/threads/${ten[3].sub}/shares`])
  })
})

test.describe('Sharing on Enterprise', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.use({ muulPlan: 'enterprise' })

  test('REG-578 Enterprise has no class cap: a 6th class can be made', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    for (const n of ['One', 'Two', 'Three', 'Four', 'Five']) sharing.seedList(TEACHER, `Class ${n}`, [])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Classes & people').click()
    await screen.newClass.click()
    const g = new NewGroupDialog(page)
    await g.name.fill('Class Six')
    await g.create.click()
    await app.toasts.expectShown('Class “Class Six” created')
    expect(sharing.listsOf(TEACHER)).toHaveLength(6)
  })
})

test.describe('Sharing on a paused Pro plan', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.use({ muulPlan: 'pro-paused' })

  test('REG-579 a paused Pro account reads as Free: the Sharing screen is receive-only with an upgrade offer', { tag: '@P2' }, async ({ signedIn: _app, page }) => {
    const screen = new SharingScreen(page)
    await screen.open()
    await expect(screen.nav.getByRole('button')).toHaveText(['Received0', 'People0'])
    await expect(screen.share).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Upgrade to share' })).toBeVisible()
    await screen.tab('People').click()
    await expect(page.getByText('Nobody has shared with you yet.')).toBeVisible()
  })
})

test.describe('Sharing on a Pro seat', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.use({ muulPlan: 'pro-seat' })

  test('REG-580 a Pro seat shares like Pro: Live and classes are offered', { tag: '@P3' }, async ({ signedIn: app, page, sharing }) => {
    sharing.addPerson(STUDENT_2, false)
    sharing.seedList(TEACHER, 'Seat Class', [STUDENT_2.sub])
    await projectWithDocs(app, 'Seat Project', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await expect(c.how('Live')).toHaveAttribute('aria-checked', 'true')
    await expect(c.suggestion('Seat Class')).toBeVisible()
  })
})
