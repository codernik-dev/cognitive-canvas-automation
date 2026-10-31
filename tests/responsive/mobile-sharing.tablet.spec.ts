/**
 * Sharing on a tablet (1024x1366 touch Chromium, project "tablet"): not a
 * phone (useIsPhone false), so the desktop board, with the details and the
 * class manager as side panels (<aside>) rather than the phone's full-screen
 * dialogs (REG-839, REG-841). Stateful fake backend; app side only.
 */
import { sharingTest as test, expect } from '../../fixtures/mobile.js'
import { STUDENT } from '../../fixtures/sharing.js'
import { SharingScreen, NewGroupDialog } from '../../pages/SharingScreen.js'

test.describe('Sharing on a tablet', { tag: ['@regression', '@mobile', '@api'] }, () => {
  test('REG-888 on a tablet Sharing keeps the desktop board: subtitle, underlined tabs, and a class opens in a side panel beside the board', { tag: '@P3' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.addPerson(STUDENT, false)
    const screen = new SharingScreen(page)
    await screen.open()
    await expect(page.getByText('What you’ve shared, live or as a copy.')).toBeVisible()
    await expect(screen.tab('Shares')).not.toHaveClass(/rounded-full/)
    await screen.tab('Classes & people').click()
    await screen.newClass.click()
    const group = new NewGroupDialog(page)
    await group.name.fill('Tablet Class')
    await group.search.fill(STUDENT.email)
    await group.resultRow(STUDENT.email).getByRole('button', { name: 'Add', exact: true }).click()
    await group.create.click()
    await expect(screen.managePanel('Tablet Class')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Tablet Class' })).toHaveCount(0)
    const panel = (await screen.managePanel('Tablet Class').boundingBox())!
    expect(panel.width).toBeCloseTo(380, 0)
    expect(sharing.listsOf('e2e-user-0001').map((l) => l.name)).toEqual(['Tablet Class'])
  })
})
