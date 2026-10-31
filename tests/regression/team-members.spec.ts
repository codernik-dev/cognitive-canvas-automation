/**
 * Regression: Settings › Team Members (components/TeamMembersPage.tsx,
 * sharing/AddMemberModal.tsx, sharing/CreateSubUserModal.tsx,
 * sharing/shareFlow/ShareFlowModal.tsx; services/auth/orgService.ts).
 * The roster is the org's product members on MuulOrigin IAM (mocked: the
 * stateful fake keeps the org's rows), plus the cross-org students this
 * device remembers. Adding people is Pro; managing the people already there
 * is every signed-in plan.
 */
import { test, expect, STUDENT, STUDENT_2, COLLEAGUE } from '../../fixtures/sharing.js'
import { TeamMembersScreen, AddMemberDialog, CreateStudentDialog } from '../../pages/SharingTeam.js'
import { SharingScreen, ShareComposerDialog } from '../../pages/SharingScreen.js'

const TEACHER = 'e2e-user-0001'
const ORG = 'e2e-org-0001'
const membersPath = `/api/iam/orgs/${ORG}/members`

test.describe('Team members', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.beforeEach(({ sharing }) => {
    for (const p of [STUDENT, STUDENT_2]) sharing.addPerson(p, false)
    sharing.addPerson(COLLEAGUE, true)
  })

  test('REG-560 the roster lists the owner first, then teachers and students, with search and sort once it has more than two people', { tag: ['@P1', '@sanity'] }, async ({ signedIn: _app, page, sharing }) => {
    sharing.addOrgMember(ORG, STUDENT.sub, 'viewer')
    sharing.addOrgMember(ORG, COLLEAGUE.sub, 'admin')
    const team = new TeamMembersScreen(page)
    await team.open()
    const read = sharing.callsTo('GET', membersPath)[0]
    expect(Object.fromEntries(read.query)).toEqual({ product: 'cognitive-canvas', limit: '100' })
    await expect(team.rows).toHaveCount(3)
    await expect(team.rows.nth(0)).toContainText('Automation User')
    await expect(team.rows.nth(0)).toContainText('👑 Owner')
    await expect(team.rows.nth(1)).toContainText('Tara Teacher')
    await expect(team.rows.nth(1)).toContainText('Teacher')
    await expect(team.rows.nth(1)).toContainText('⭐ Admin')
    await expect(team.rows.nth(2)).toContainText('Sam Student')
    await expect(team.rows.nth(2)).toContainText('Student')
    await expect(team.row(STUDENT.email).getByRole('button', { name: 'Remove member' })).toBeVisible()
    await expect(team.row('automation.user@example.invalid').getByRole('button', { name: 'Remove member' })).toHaveCount(0)

    await team.search.fill('sam')
    await expect(page.getByText('Showing 1 of 3')).toBeVisible()
    await expect(team.rows).toHaveCount(1)
    await team.search.fill('zzz')
    await expect(page.getByText('No members match “zzz”.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(team.rows).toHaveCount(3)
    await team.sort.selectOption('name-desc')
    await expect(team.rows.nth(0)).toContainText('Automation User') // the owner outranks any sort
    await expect(team.rows.nth(1)).toContainText('Tara Teacher')
  })

  test('REG-561 a roster that cannot be read says why: not the owner, no such organisation, or a failure to retry', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    const team = new TeamMembersScreen(page)
    const reopen = async () => {
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await team.tabButton.click()
    }
    const fail = sharing.override('GET', new RegExp(`^${membersPath}$`), { status: 403, json: { message: 'Forbidden' } })
    await team.open()
    await expect(team.error('Only the team owner can see the member list. You are signed in with an account that is a member of this team, not its owner.')).toBeVisible()
    fail.clear()

    sharing.override('GET', new RegExp(`^${membersPath}$`), { status: 404, json: { message: 'Organization not found' } }, 1)
    await reopen()
    await expect(team.error('Organization not found. Please contact support if the issue persists.')).toBeVisible()

    sharing.override('GET', new RegExp(`^${membersPath}$`), { status: 500, json: {} }, 1)
    await reopen()
    await expect(team.error('Could not load team members. Please try again.')).toBeVisible()
    await app.toasts.expectShown('Could not load team members')
  })

  test('REG-562 an empty roster offers "Add your first member"', { tag: '@P3' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.orgs.set(ORG, [])
    const team = new TeamMembersScreen(page)
    await team.open()
    await expect(page.getByText('No team members yet')).toBeVisible()
    await page.getByRole('button', { name: 'Add your first member' }).click()
    await expect(new AddMemberDialog(page).dialog).toBeVisible()
  })

  test('REG-563 a member is found by their exact email and added to the team on the server', { tag: ['@P1'] }, async ({ signedIn: app, page, sharing }) => {
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.addMember.click()
    const add = new AddMemberDialog(page)
    await expect(add.dialog).toContainText('Enter their full email address — it has to match exactly, so a partial address won\'t find anyone.')
    await expect(add.dialog).toContainText('Type an email to search')

    await add.search.fill('automation.user@example.invalid')
    await expect(add.dialog).toContainText('That\'s you')
    await expect(add.dialog).toContainText('You already own this team — no need to add yourself.')
    await add.search.fill('nobody.here@example.invalid')
    await expect(add.dialog).toContainText('No users found for "nobody.here@example.invalid"')
    await expect(add.dialog).toContainText('Addresses must match exactly — check for a typo, or create an account for them below.')

    await add.search.fill(STUDENT.email)
    await add.row(STUDENT.email).getByRole('button', { name: 'Add', exact: true }).click()
    await app.toasts.expectShown('Member added to your team')
    await expect(add.dialog).toBeHidden()
    expect(sharing.callsTo('POST', membersPath).map((c) => c.json)).toEqual([{ userId: STUDENT.sub, product: 'cognitive-canvas', appRole: 'viewer', permissions: [] }])
    expect(sharing.orgs.get(ORG)!.map((r) => r.userId)).toEqual([TEACHER, STUDENT.sub])
    await expect(team.row(STUDENT.email)).toContainText('Sam Student')
    await expect(team.row(STUDENT.email)).toContainText('Student')
    await expect(page.getByText('✓ 1 member added to your team. They can now access shared projects and content.')).toBeVisible()

    // Searching again shows them as already on the team, with no Add.
    await team.addMember.click()
    await expect(add.row(STUDENT.email)).toContainText('On team') // offered from "recent" before any search
    await add.search.fill(STUDENT.email)
    await expect(add.row(STUDENT.email)).toContainText('On team')
    await expect(add.row(STUDENT.email).getByRole('button', { name: 'Add', exact: true })).toHaveCount(0)
  })

  test('REG-564 a new student account is created with checked details, then added to the team', { tag: ['@P1'] }, async ({ signedIn: app, page, sharing }) => {
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.addMember.click()
    await new AddMemberDialog(page).createStudent.click()
    const s = new CreateStudentDialog(page)
    await expect(s.dialog).toContainText('Creates an independent account the student signs in with anywhere, using this email and password. Share the password with them — we don\'t email it.')
    await expect(s.create).toBeDisabled()

    await s.email.fill('not-an-email')
    await expect(s.dialog).toContainText('That doesn\'t look like an email address.')
    await s.email.fill('new.student@example.invalid')
    await s.password.fill('short')
    for (const rule of ['Min 8 characters', 'Uppercase letter', 'Number (0-9)', 'Special char (!@#$…)']) {
      await expect(s.rule(rule).locator('span.bg-green-500\\/20'), rule).toHaveCount(0)
    }
    await expect(s.rule('Lowercase letter').locator('span.bg-green-500\\/20')).toHaveCount(1)
    await s.password.fill('Str0ng!Pass')
    for (const rule of ['Min 8 characters', 'Uppercase letter', 'Lowercase letter', 'Number (0-9)', 'Special char (!@#$…)', 'No spaces']) {
      await expect(s.rule(rule).locator('span.bg-green-500\\/20'), rule).toHaveCount(1)
    }
    await s.confirm.fill('Str0ng!Pas')
    await expect(s.dialog).toContainText('Passwords don\'t match.')
    await s.confirm.fill('Str0ng!Pass')
    await expect(s.dialog).toContainText('Passwords match.')
    await expect(s.create).toBeDisabled() // first name still missing
    await s.showPassword.click()
    await expect(s.password).toHaveAttribute('type', 'text')
    await expect(s.confirm).toHaveAttribute('type', 'text')
    await s.firstName.fill('Nina')
    await s.lastName.fill('New')
    await s.create.click()
    await app.toasts.expectShown('Student account created for new.student@example.invalid')

    const [signup] = sharing.callsTo('POST', '/api/iam/users/signup')
    expect(signup.json).toEqual({ product: 'cognitive-canvas', appRole: 'viewer', email: 'new.student@example.invalid', password: 'Str0ng!Pass', firstName: 'Nina', lastName: 'New' })
    const created = [...sharing.people.values()].find((p) => p.email === 'new.student@example.invalid')!
    await expect.poll(() => sharing.callsTo('POST', membersPath).map((c) => c.json)).toEqual([{ userId: created.id, product: 'cognitive-canvas', appRole: 'viewer', permissions: [] }])
    await expect(team.row('new.student@example.invalid')).toContainText('Nina New')
  })

  test('REG-565 creating a student the server refuses keeps the form and says why; leaving a filled form asks first', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.addMember.click()
    await new AddMemberDialog(page).createStudent.click()
    const s = new CreateStudentDialog(page)
    await s.email.fill(STUDENT.email) // already has an account
    await s.password.fill('Str0ng!Pass')
    await s.confirm.fill('Str0ng!Pass')
    await s.firstName.fill('Sam')
    await s.create.click()
    await app.toasts.expectShown('An account with this email already exists.')
    await expect(s.dialog).toBeVisible()
    expect(sharing.callsTo('POST', membersPath)).toEqual([])

    let message = ''
    page.once('dialog', (d) => { message = d.message(); void d.dismiss() })
    await s.cancel.click()
    expect(message).toBe('Discard this student’s details?')
    await expect(s.dialog).toBeVisible()
    page.once('dialog', (d) => void d.accept())
    await s.cancel.click()
    await expect(s.dialog).toBeHidden()
  })

  test('REG-566 a member is removed after a confirmation that names them', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    sharing.addOrgMember(ORG, STUDENT.sub)
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.row(STUDENT.email).getByRole('button', { name: 'Remove member' }).click()
    const modal = page.getByRole('dialog', { name: 'Remove member?' })
    await expect(modal).toContainText(`Remove ${STUDENT.email} from the team? They will lose access to shared projects.`)
    await modal.getByRole('button', { name: 'Cancel' }).click()
    expect(sharing.callsTo('DELETE', /\/members\//)).toEqual([])
    await team.row(STUDENT.email).getByRole('button', { name: 'Remove member' }).click()
    await modal.getByRole('button', { name: 'Remove', exact: true }).click()
    await app.toasts.expectShown(`${STUDENT.email} removed`)
    expect(sharing.callsTo('DELETE', `${membersPath}/${STUDENT.sub}`)).toHaveLength(1)
    await expect(team.row(STUDENT.email)).toHaveCount(0)
    expect(sharing.orgs.get(ORG)!.map((r) => r.userId)).toEqual([TEACHER])
  })

  test('REG-567 several members are removed at once in Select mode; the owner cannot be ticked', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    sharing.addOrgMember(ORG, STUDENT.sub)
    sharing.addOrgMember(ORG, STUDENT_2.sub)
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.select.click()
    await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await expect(page.getByText('2 selected')).toBeVisible()
    await team.row('automation.user@example.invalid').click() // not removable: stays unticked
    await expect(page.getByText('2 selected')).toBeVisible()
    await page.getByRole('button', { name: 'Remove the selected members from your team' }).click()
    const modal = page.getByRole('dialog', { name: 'Remove 2 members?' })
    await expect(modal).toContainText('These 2 people will be removed from your team.')
    await expect(modal).toContainText('Sam Student')
    await expect(modal).toContainText('Riya Reader')
    await expect(modal).toContainText('Their account is not deleted. You can add them again later.')
    await modal.getByRole('button', { name: 'Remove 2' }).click()
    await app.toasts.expectShown('2 members removed')
    expect(sharing.callsTo('DELETE', /\/members\/[^/]+$/).map((c) => c.path).sort()).toEqual([`${membersPath}/${STUDENT.sub}`, `${membersPath}/${STUDENT_2.sub}`].sort())
    await expect(team.rows).toHaveCount(1)
    await expect(team.select).toBeDisabled() // nobody left who can be selected
  })

  test('REG-568 people picked on the roster become a new class, and Sharing opens with the Share dialog addressed to it', { tag: '@P1' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.addOrgMember(ORG, STUDENT.sub)
    sharing.addOrgMember(ORG, STUDENT_2.sub)
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.select.click()
    await team.row(STUDENT.email).click()
    await team.row(STUDENT_2.email).click()
    await page.getByRole('button', { name: '⇪ Share a note' }).click()
    const flow = page.getByRole('dialog', { name: 'Choose a group' })
    await expect(flow).toBeVisible()
    await flow.getByPlaceholder('Group name — e.g. Physics 11th').fill('Study Group')
    await flow.getByRole('button', { name: 'Continue to Sharing' }).click()

    await expect(new SharingScreen(page).heading).toBeVisible() // the flow hands over once the class exists
    expect(sharing.callsTo('POST', '/api/sharing/lists').map((c) => c.json)).toEqual([{ name: 'Study Group', colorKey: 'teal', memberIds: [STUDENT.sub, STUDENT_2.sub] }])
    const c = new ShareComposerDialog(page)
    await c.expectOpen()
    await expect(c.removeChip('Study Group')).toBeVisible()
    await expect(c.dialog.getByText(/^· 2 people$/)).toBeVisible()
  })

  test('REG-569 sharing again with roster people who form part of an existing class only tops the class up', { tag: '@P2' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.addOrgMember(ORG, STUDENT.sub)
    sharing.addOrgMember(ORG, STUDENT_2.sub)
    const list = sharing.seedList(TEACHER, 'Physics 11', [STUDENT.sub])
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.select.click()
    await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await page.getByRole('button', { name: '⇪ Share a note' }).click()
    const flow = page.getByRole('dialog', { name: 'Choose a group' })
    await flow.getByRole('button', { name: /Physics 11/ }).click()
    await flow.getByRole('button', { name: 'Continue to Sharing' }).click()
    await expect(new ShareComposerDialog(page).removeChip('Physics 11')).toBeVisible()
    expect(sharing.callsTo('POST', `/api/sharing/lists/${list.id}/members`).map((c) => c.json)).toEqual([{ userId: STUDENT_2.sub }])
    expect(sharing.callsTo('POST', '/api/sharing/lists')).toEqual([])
    expect(list.memberIds).toEqual([STUDENT.sub, STUDENT_2.sub])
  })

  test('REG-570 "Share a note" goes to Sharing, where team members are listed as people to share with', { tag: '@P2' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.addOrgMember(ORG, STUDENT.sub)
    const team = new TeamMembersScreen(page)
    await team.open()
    await team.shareNote.click()
    const screen = new SharingScreen(page)
    await expect(screen.heading).toBeVisible()
    await screen.tab('Classes & people').click()
    await expect(screen.personRow('Sam Student')).toContainText('Team member')
  })
})

test.describe('Team members on Economy', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.use({ muulPlan: 'dev' })

  test('REG-571 an Economy account manages the people already on its team but is told adding needs Pro', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    sharing.addPerson(STUDENT, false)
    sharing.addOrgMember(ORG, STUDENT.sub)
    const team = new TeamMembersScreen(page)
    await team.open()
    await expect(team.row(STUDENT.email)).toBeVisible()
    await team.addMember.click()
    await app.toasts.expectShown('Adding team members needs the Pro plan. The people already here stay yours to manage.')
    await expect(new AddMemberDialog(page).dialog).toBeHidden()
    // Removal still works.
    await team.row(STUDENT.email).getByRole('button', { name: 'Remove member' }).click()
    await page.getByRole('dialog', { name: 'Remove member?' }).getByRole('button', { name: 'Remove', exact: true }).click()
    await app.toasts.expectShown(`${STUDENT.email} removed`)
    expect(sharing.callsTo('DELETE', `${membersPath}/${STUDENT.sub}`)).toHaveLength(1)
  })
})

test.describe('Team members signed out', { tag: ['@regression', '@sharing'] }, () => {
  test.use({ muulPlan: null })

  test('REG-572 signed out, Settings has no Team Members tab', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    await page.getByRole('button', { name: /^Settings( — new support reply)?$/ }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Team Members', exact: true })).toHaveCount(0)
  })
})
