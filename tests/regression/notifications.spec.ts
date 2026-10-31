/**
 * Regression: sharing notifications (components/sharing/GlobalNotificationBell.tsx,
 * NotificationBell.tsx, the profile menu's Sharing badge in
 * shared/ProfileMenuButton.tsx, sharingService.markAllSeen). The bell reads the
 * same /overview snapshot LiveAutoSync polls every 3 s.
 * Mocked backend (stateful fake): proves the app's side of the contract only.
 */
import { test, expect, STUDENT, COLLEAGUE } from '../../fixtures/sharing.js'
import { SharingScreen, NotificationBellControl } from '../../pages/SharingScreen.js'

const TEACHER = 'e2e-user-0001'
const bundle = (title: string, createdAt: number) => ({ title, projectId: `p-${title}`, documentIds: [], documents: [], itemSummary: 'Project copy', icon: '📄', zip: Buffer.alloc(0), createdAt })

test.describe('Sharing notifications', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.beforeEach(({ sharing }) => {
    sharing.addPerson(STUDENT, false)
    sharing.addPerson(COLLEAGUE, true)
  })

  test('REG-508 the bell counts unseen shares; opening it lists them newest first and marks them seen on the server', { tag: ['@P1', '@sanity'] }, async ({ signedIn: _app, page, sharing }) => {
    sharing.seedCopy(STUDENT.sub, TEACHER, bundle('Older Notes', Date.now() - 2 * 3_600_000), { imported: true, seen: true })
    sharing.seedCopy(COLLEAGUE.sub, TEACHER, bundle('Fresh Worksheet', Date.now() - 60_000), { imported: true })
    const bell = new NotificationBellControl(page)
    await expect(bell.button).toHaveText('1')
    await bell.button.click()
    await expect(bell.panel.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    await expect(bell.panel).toContainText('2 received')
    await expect(bell.panel.getByRole('button')).toHaveText([/Fresh Worksheet.*Shared by Tara Teacher/, /Older Notes.*Shared by Sam Student/])
    await expect.poll(() => sharing.callsTo('POST', '/api/sharing/inbox/seen', TEACHER).length).toBe(1)
    await expect(bell.button).toHaveText('')
    expect(sharing.inboxOf(TEACHER).every((n) => n.seen)).toBe(true)

    await page.mouse.click(5, 400) // outside closes it
    await expect(bell.panel).toBeHidden()
  })

  test('REG-509 a notification opens Sharing › Received at that share', { tag: '@P2' }, async ({ signedIn: _app, page, sharing }) => {
    const note = sharing.seedCopy(COLLEAGUE.sub, TEACHER, bundle('Fresh Worksheet', Date.now() - 60_000), { imported: true })
    sharing.seedCopy(STUDENT.sub, TEACHER, bundle('Another One', Date.now() - 120_000), { imported: true })
    const bell = new NotificationBellControl(page)
    await bell.button.click()
    await bell.note('Fresh Worksheet').click()
    const screen = new SharingScreen(page)
    await expect(screen.heading).toBeVisible()
    await expect(screen.tab('Received')).toHaveAttribute('aria-current', 'page')
    const row = page.locator(`[data-note-id="${note.id}"]`)
    await expect(row).toBeInViewport()
    await expect(row).toContainText('Fresh Worksheet')
    await expect(row).toHaveClass(/ring-2/) // rung once on arrival
    await expect(row).not.toHaveClass(/ring-2/)
  })

  test('REG-510 with nothing received the bell says so; signed out there is no bell at all', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const bell = new NotificationBellControl(page)
    await expect(bell.button).toHaveText('')
    await bell.button.click()
    await expect(bell.panel).toContainText('0 received')
    await expect(bell.panel).toContainText('No notifications yet.')
    await page.mouse.click(5, 400)
    await expect(bell.panel).toBeHidden()

    await page.getByRole('button', { name: 'Automation User', exact: true }).click()
    await app.profileMenu.menu.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(app.header.profile).toBeVisible()
    await expect(bell.button).toHaveCount(0)
  })

  test('REG-511 the profile menu\'s Sharing item carries the unseen count and opening it marks everything seen', { tag: '@P2' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.seedCopy(COLLEAGUE.sub, TEACHER, bundle('One', Date.now() - 60_000), { imported: true })
    sharing.seedCopy(STUDENT.sub, TEACHER, bundle('Two', Date.now() - 50_000), { imported: true })
    await expect(new NotificationBellControl(page).button).toHaveText('2')
    await page.getByRole('button', { name: 'Automation User', exact: true }).click()
    const item = page.getByRole('menu').getByRole('menuitem', { name: /^Sharing/ })
    // The menu refreshes its count on the 20 s notification poll (the bell follows every 3 s snapshot).
    await expect(item).toHaveText('Sharing2', { timeout: 30_000 })
    await item.click()
    await expect(new SharingScreen(page).heading).toBeVisible()
    await expect.poll(() => sharing.callsTo('POST', '/api/sharing/inbox/seen', TEACHER).length).toBeGreaterThan(0)
    expect(sharing.inboxOf(TEACHER).every((n) => n.seen)).toBe(true)
    await expect(new NotificationBellControl(page).button).toHaveText('')
  })

  test('REG-512 a share that arrives while the app is open shows on the bell within seconds, without a reload', { tag: '@P1' }, async ({ signedIn: _app, page, sharing }) => {
    const bell = new NotificationBellControl(page)
    await expect(bell.button).toHaveText('')
    sharing.seedCopy(COLLEAGUE.sub, TEACHER, bundle('Arrived Now', Date.now()), { imported: true })
    await expect(bell.button).toHaveText('1', { timeout: 15_000 }) // LiveAutoSync's 3 s poll feeds the bell
    await bell.button.click()
    await expect(bell.note('Arrived Now')).toContainText('Shared by Tara Teacher')
  })
})
