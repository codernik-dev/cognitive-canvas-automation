/**
 * Regression: the Sharing screen itself (components/sharing/SharingPage.tsx,
 * board/useShareBoard.ts, board/SharesBoard.tsx, board/ShareCard.tsx,
 * board/ShareDetailPanel.tsx for copies, board/boardUi.tsx): the signed-out
 * prompt, tabs and their counts, every board's empty state, the receive-only
 * screen, loading failures, search and filters, and a sent copy's detail panel.
 * Mocked backend (stateful fake): proves the app's side of the contract only.
 */
import type { Page } from '@playwright/test'
import { test, expect, STUDENT, STUDENT_2, COLLEAGUE } from '../../fixtures/sharing.js'
import { knownDefect } from '../../helpers/defects.js'
import { MUUL_WWW } from '../../helpers/mocks/muulAccount.js'
import { ShellBanners } from '../../pages/ShellPages.js'
import { SharingScreen, ShareComposerDialog } from '../../pages/SharingScreen.js'
import { FIND_PDF } from '../../data/files.js'
import { projectRows, projectWithDocs } from '../../helpers/sharingFlows.js'

const TEACHER = 'e2e-user-0001'
const emptyBundle = { itemSummary: 'Project copy', icon: '📄', zip: Buffer.alloc(0) }

/** Answer a www.muulorigin.com page with a stub, so leaving the app lands on a page rather than a blocked-request error page. */
async function stubMuulOriginPage(page: Page, path: string) {
  await page.route((url) => url.origin === MUUL_WWW && url.pathname === path, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>MuulOrigin (e2e stub)</title><p>stub</p>' }))
}

test.describe('Sharing screen', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test('REG-500 signed out on the Sharing screen, it asks to sign in, and Sign in goes to the MuulOrigin sign-in with the way back', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    const screen = new SharingScreen(page)
    await screen.open()
    await page.getByRole('button', { name: 'Automation User', exact: true }).click()
    await app.profileMenu.menu.getByRole('menuitem', { name: 'Sign out' }).click()
    await new ShellBanners(page).signOut.getByRole('button', { name: 'Sign out', exact: true }).click()

    await expect(screen.signInPrompt).toBeVisible()
    await expect(screen.nav).toBeHidden()
    await expect(screen.share).toBeHidden()
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeHidden()
    const before = sharing.calls.length
    const here = page.url()
    await stubMuulOriginPage(page, '/signin')
    await screen.signIn.click()
    await expect(page).toHaveURL(`${MUUL_WWW}/signin?returnUrl=${encodeURIComponent(here)}`)
    expect(sharing.calls.slice(before).filter((c) => c.path.startsWith('/api/sharing/overview'))).toEqual([])
  })

  test('REG-501 a Pro account with nothing shared sees three tabs, each with its own subtitle and empty state, and the tab is remembered', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page }) => {
    const screen = new SharingScreen(page)
    await screen.open()
    await expect(screen.tab('Shares')).toHaveAccessibleName('Shares 0')
    await expect(screen.tab('Received')).toHaveAccessibleName('Received 0')
    await expect(screen.tab('Classes & people')).toHaveAccessibleName('Classes & people 0')
    await expect(screen.tab('Shares')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('What you’ve shared, live or as a copy.')).toBeVisible()
    for (const f of ['All', 'Live', 'Copies', 'Stopped']) await expect(screen.filter(screen.sharesFilter, f)).toHaveAccessibleName(`${f} 0`)
    await expect(page.getByText('0 people across 0 classes · sorted by recent')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nothing shared yet' })).toBeVisible()
    await expect(page.getByText('Share a document with a class once, and every change you make reaches them automatically. They see it as a share from you — never the class, never each other.')).toBeVisible()
    await expect(page.getByRole('listitem')).toHaveText(['1Pick a document', '2Choose who', '3Live or copy'])

    await screen.tab('Received').click()
    await expect(page.getByText('What’s been shared with you. Live items keep themselves up to date.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
    await expect(page.getByText('When someone shares a document with you it appears here and in the bell. Live shares keep themselves up to date — there is nothing to do.')).toBeVisible()
    await expect(page.getByText('Offline? Everything you imported still opens. Live shares catch up when you’re back.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upgrade to share' })).toHaveCount(0) // a paying account is not pitched

    await screen.tab('Classes & people').click()
    await expect(page.getByText('Who you share with. Classes are yours alone; nobody else sees them.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Classes · 0' })).toBeVisible()
    await expect(page.getByText('A class is a saved set of people. Make one, then share to all of them at once.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'People · 0' })).toBeVisible()
    await expect(page.getByText('People you share with will appear here.')).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('cc2_sharing_tab'))).toBe('people')

    // Back to Home and in again: the last tab is where it opens.
    await screen.back.click()
    await expect(app.home.newProjectName).toBeVisible()
    await screen.open()
    await expect(screen.tab('Classes & people')).toHaveAttribute('aria-current', 'page')

    // The empty Shares board's own button opens the Share dialog.
    await screen.tab('Shares').click()
    await page.getByRole('button', { name: 'Share your first document' }).click()
    await new ShareComposerDialog(page).expectOpen()
  })

  test('REG-503 when the sharing service cannot be read on arrival, the screen says so and offers Try again instead of empty boards', { tag: '@P1' }, async ({ signedIn: _app, page, sharing }) => {
    knownDefect('DEF-502')
    sharing.seedList(TEACHER, 'Physics 11', [])
    const down = sharing.override('GET', /^\/api\/sharing\/overview$/, { status: 503, json: { message: 'Service Unavailable' } })
    const screen = new SharingScreen(page)
    await screen.open()
    await expect.poll(() => sharing.callsTo('GET', '/api/sharing/overview').filter((c) => c.status === 503).length).toBeGreaterThan(0)
    await expect(screen.loadError).toContainText('Couldn\'t reach the sharing service. Check your connection and try again.')
    await expect(page.getByRole('heading', { name: 'Nothing shared yet' })).toHaveCount(0)

    down.clear()
    await screen.loadError.getByRole('button', { name: 'Try again' }).click()
    await expect(screen.tab('Classes & people')).toHaveAccessibleName('Classes & people 1')
    await expect(screen.loadError).toBeHidden()
  })

  test('REG-504 a sharing service that never answers turns the skeletons into "Still loading" with Try again', { tag: '@P2' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.seedList(TEACHER, 'Physics 11', [])
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const hang = sharing.override('GET', /^\/api\/sharing\/overview$/, async (ctx) => { await gate; return { json: sharing.overview(ctx.caller.id) } })
    const screen = new SharingScreen(page)
    await screen.open()
    await expect(screen.skeletons).toBeVisible()
    await expect(screen.loadError).toContainText('Still loading your shares…', { timeout: 25_000 }) // the app's own 12 s stall timer
    await screen.loadError.getByRole('button', { name: 'Try again' }).click()
    await expect(screen.loadError).toBeHidden() // back to loading, the timer re-armed
    await expect(screen.skeletons).toBeVisible()
    hang.clear()
    release()
    await expect(screen.tab('Classes & people')).toHaveAccessibleName('Classes & people 1')
    await expect(screen.skeletons).toHaveCount(0)
  })

  test('REG-505 sent copies are listed newest first, counted by kind, and found by title, audience or document name', { tag: '@P2' }, async ({ signedIn: _app, page, sharing }) => {
    for (const s of [STUDENT, STUDENT_2]) sharing.addPerson(s, false)
    const list = sharing.seedList(TEACHER, 'Physics 11', [STUDENT_2.sub])
    const older = { title: 'Algebra Notes', projectId: 'p-gone', documentIds: ['d1'], documents: [{ id: 'd1', name: 'chapter-one' }], ...emptyBundle, createdAt: Date.now() - 3 * 86_400_000 }
    sharing.seedCopy(TEACHER, STUDENT.sub, older)
    list.shares.push({ id: 'bundle-optics', fromUserId: TEACHER, title: 'Optics Pack', projectId: 'p-gone-2', createdAt: Date.now() - 3_600_000, documentIds: [], documents: [], ...emptyBundle })
    const screen = new SharingScreen(page)
    await screen.open()
    await expect(screen.tab('Shares')).toHaveAccessibleName('Shares 2')
    await expect(screen.filter(screen.sharesFilter, 'Copies')).toHaveAccessibleName('Copies 2')
    await expect(page.getByText('2 people across 1 class · sorted by recent')).toBeVisible()
    await expect(page.getByRole('button', { name: / — Copy · / })).toHaveText([/Optics Pack/, /Algebra Notes/]) // newest first
    await expect(screen.shareCard('Optics Pack')).toContainText('Physics 11')
    await expect(screen.shareCard('Optics Pack')).toContainText('1 h ago')
    await expect(screen.shareCard('Algebra Notes')).toContainText('Sam Student · chapter-one')
    await expect(screen.shareCard('Algebra Notes')).toContainText('3 d ago')

    for (const [q, title] of [['optics', 'Optics Pack'], ['chapter-one', 'Algebra Notes'], ['physics 11', 'Optics Pack'], ['sam', 'Algebra Notes']] as const) {
      await screen.search.fill(q)
      await expect(page.getByRole('button', { name: / — Copy · / }), q).toHaveText([new RegExp(title)])
    }
    await screen.search.fill('zzz')
    await expect(page.getByText('Nothing matches that.')).toBeVisible()
    await screen.search.fill('')
    await screen.filter(screen.sharesFilter, 'Live').click()
    await expect(screen.filter(screen.sharesFilter, 'Live')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Nothing matches that.')).toBeVisible()
  })

  test('REG-506 a sent copy\'s details show its documents, people and history; it can be shared again or removed from history only', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    for (const s of [STUDENT, STUDENT_2]) sharing.addPerson(s, false)
    sharing.seedCopy(TEACHER, STUDENT.sub, { title: 'Algebra Notes', projectId: 'p-gone', documentIds: ['d1'], documents: [{ id: 'd1', name: 'chapter-one' }], ...emptyBundle })
    const list = sharing.seedList(TEACHER, 'Physics 11', [STUDENT_2.sub])
    list.shares.push({ id: 'bundle-optics', fromUserId: TEACHER, title: 'Optics Pack', projectId: 'p-gone-2', createdAt: Date.now() - 60_000, documentIds: [], documents: [], ...emptyBundle })
    const bundleId = sharing.threadOf(TEACHER, STUDENT.sub).shares[0].id
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.shareCard('Algebra Notes').click()
    await expect(screen.shareCard('Algebra Notes')).toHaveAttribute('aria-pressed', 'true')
    const panel = screen.detail
    await expect(panel.getByRole('heading', { name: 'Algebra Notes' })).toBeVisible()
    await expect(panel).toContainText('Copy · sent once')
    await expect(panel).toContainText('Document')
    await expect(panel).toContainText('chapter-one')
    await expect(panel).toContainText('People · 1')
    await expect(panel).toContainText('Sent a copy to Sam Student')
    await expect(panel.getByRole('button', { name: 'Open' })).toHaveCount(0) // its project is not on this device
    await expect(panel.getByRole('button', { name: 'Add people' })).toHaveCount(0) // copies cannot gain people

    await panel.getByRole('button', { name: 'Share again' }).click()
    const c = new ShareComposerDialog(page)
    await expect(c.removeChip('Sam Student')).toBeVisible()
    await c.cancel.click()
    await expect(panel).toBeHidden() // Share again hands over to the dialog

    await screen.shareCard('Algebra Notes').click()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await screen.shareCard('Algebra Notes').click()
    await screen.menu(panel, 'Remove from history…')
    const modal = page.getByRole('dialog', { name: 'Remove from history?' })
    await expect(modal).toContainText('This only tidies your own list. Sam Student keeps what they received.')
    await modal.getByRole('button', { name: 'Remove', exact: true }).click()
    await app.toasts.expectShown('Removed from your history — they keep what they received')
    expect(sharing.callsTo('DELETE', `/api/sharing/threads/${STUDENT.sub}/shares/${bundleId}`)).toHaveLength(1)
    await expect(screen.shareCard('Algebra Notes')).toHaveCount(0)

    // A class copy is removed through the class.
    await screen.shareCard('Optics Pack').click()
    await screen.menu(panel, 'Remove from history…')
    await modal.getByRole('button', { name: 'Remove', exact: true }).click()
    await app.toasts.expectShown('Removed from your history — they keep what they received')
    expect(sharing.callsTo('DELETE', `/api/sharing/lists/${list.id}/shares/bundle-optics`)).toHaveLength(1)
    await expect(page.getByRole('heading', { name: 'Nothing shared yet' })).toBeVisible()
  })

  test('REG-507 a share whose project is on this device opens that project from its card', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    sharing.addPerson(STUDENT, false)
    await projectWithDocs(app, 'Local Project', [FIND_PDF.payload()])
    const [project] = await projectRows(page)
    sharing.seedCopy(TEACHER, STUDENT.sub, { title: 'Local Project', projectId: project.id, documentIds: [], documents: [], ...emptyBundle })
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.shareCard('Local Project').getByRole('button', { name: 'Open' }).click()
    await expect(screen.heading).toBeHidden()
    await app.documents.expectOpen('Local Project')
  })
})

test.describe('Sharing screen on Free', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.use({ muulPlan: 'free' })

  test('REG-502 a Free account gets a receive-only screen: Received and People, no Share, and an upgrade that opens the plans', { tag: ['@P1'] }, async ({ signedIn: _app, page, sharing }) => {
    sharing.addPerson(COLLEAGUE, true)
    sharing.seedCopy(COLLEAGUE.sub, TEACHER, { title: 'Reading List', projectId: 'p-tara', documentIds: [], documents: [], ...emptyBundle }, { imported: true, seen: true })
    const screen = new SharingScreen(page)
    await screen.open()
    await expect(screen.nav.getByRole('button')).toHaveText(['Received1', 'People1'])
    await expect(screen.tab('Received')).toHaveAttribute('aria-current', 'page')
    await expect(screen.share).toHaveCount(0)
    await expect(screen.receivedCard('Reading List')).toContainText('from Tara Teacher')

    await screen.tab('People').click()
    await expect(page.getByText('The people who share with you.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'People who share with you · 1' })).toBeVisible()
    await expect(screen.personRow('Tara Teacher')).toContainText('tara.teacher@example.invalid')
    await expect(screen.personRow('Tara Teacher').getByRole('button')).toHaveCount(0) // nothing to manage
    await expect(page.getByRole('heading', { name: /^Classes/ })).toHaveCount(0)

    await screen.tab('Received').click()
    const upgrade = page.getByRole('button', { name: 'Upgrade to share' })
    await expect(upgrade).toHaveAttribute('title', 'Sharing is a subscriber feature')
    await stubMuulOriginPage(page, '/products/cognitive-canvas')
    await upgrade.click()
    await expect(page).toHaveURL(`${MUUL_WWW}/products/cognitive-canvas#pricing`)
  })
})
