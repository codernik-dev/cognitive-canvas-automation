/**
 * Regression: the profile menu of a user signed in to MuulOrigin, and
 * signing out (ProfileMenuButton.tsx, SignOutConfirmModal.tsx,
 * muulOriginAuth.logout). Uses the shared mocked account
 * (fixtures/account.ts): the token and /me are mocks, so this proves the
 * app's side only. Signing out of MuulOrigin must leave the PIN session,
 * and every project, exactly as they were.
 */
import { test, expect } from '../../fixtures/account.js'
import { readStore } from '../../helpers/idb.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { ShellBanners } from '../../pages/ShellPages.js'

test.use({ muulPlan: 'free' })

const identity = { name: 'Automation User', email: 'automation.user@example.invalid' }

test.describe('Signed-in profile menu', { tag: ['@regression', '@auth', '@api'] }, () => {
  test('REG-611 a signed-in user\'s profile button shows their initial and the menu their name, email, Sharing and Sign out', { tag: '@P2' }, async ({ signedIn: app, page, muul }) => {
    const profile = page.getByRole('button', { name: identity.name, exact: true })
    await expect(profile).toHaveText('A')
    await expect(profile).toHaveAttribute('title', identity.name)
    await expect(app.header.profile).toBeHidden() // no "Sign in" button any more
    expect(muul.callsTo('GET', '/api/iam/auth/me').length).toBeGreaterThan(0)
    expect(muul.callsTo('GET', '/api/iam/auth/me')[0].headers['authorization']).toBe(`Bearer ${muul.token}`)

    await profile.click()
    await expect(app.profileMenu.menu).toContainText(identity.name)
    await expect(app.profileMenu.menu).toContainText(identity.email)
    await expect(app.profileMenu.menu.getByRole('menuitem')).toHaveText(['Sharing', 'Data Center', 'Change PIN', 'Lock', 'Sign out'])
  })

  test('REG-612 Sign out asks first; Cancel keeps the session; confirming signs out of MuulOrigin only, leaving the PIN session and projects', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, muul }) => {
    const banners = new ShellBanners(page)
    await app.home.createProject('Survives Sign Out')
    await app.documents.backToProjects.click()
    const profile = page.getByRole('button', { name: identity.name, exact: true })

    await profile.click()
    await app.profileMenu.menu.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(banners.signOut).toContainText('Are you sure you want to sign out of your MuulOrigin account? Your projects and data stay on this device, and you can sign back in anytime.')
    await page.keyboard.press('Escape') // persistent: Escape does not dismiss it
    await expect(banners.signOut).toBeVisible()
    await banners.signOut.getByRole('button', { name: 'Cancel' }).click()
    await expect(banners.signOut).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('mo_token'))).toBe(muul.token)
    expect(muul.callsTo('POST', '/api/iam/auth/logout')).toHaveLength(0)

    await profile.click()
    await app.profileMenu.menu.getByRole('menuitem', { name: 'Sign out' }).click()
    const logout = muul.waitForCall('POST', '/api/iam/auth/logout')
    await banners.signOut.getByRole('button', { name: 'Sign out', exact: true }).click()
    expect((await logout).postDataJSON()).toEqual({ refreshToken: '' })

    await expect(app.header.profile).toBeVisible() // back to the "Sign in" silhouette
    await expect(profile).toBeHidden()
    expect(await page.evaluate(() => [localStorage.getItem('mo_token'), localStorage.getItem('mo_user_profile')])).toEqual([null, null])
    // Still unlocked, still on Home, the project untouched.
    await expect(app.login.prompt).toBeHidden()
    await expect(app.home.card('Survives Sign Out')).toBeVisible()
    expect((await readStore<{ name: string }>(page, 'projects')).map((p) => p.name)).toEqual(['Survives Sign Out'])

    await app.reload()
    await expect(app.header.profile).toBeVisible()
    await expect(app.home.card('Survives Sign Out')).toBeVisible()
  })

  test('REG-613 signing out in one tab signs the other tab out too, without locking it', { tag: '@P2' }, async ({ signedIn: app, page, context }) => {
    const other = new CognitiveCanvas(await context.newPage())
    await other.open()
    const otherProfile = other.page.getByRole('button', { name: identity.name, exact: true })
    await expect(otherProfile).toBeVisible()

    await page.getByRole('button', { name: identity.name, exact: true }).click()
    await app.profileMenu.menu.getByRole('menuitem', { name: 'Sign out' }).click()
    await new ShellBanners(page).signOut.getByRole('button', { name: 'Sign out', exact: true }).click()

    await expect(other.header.profile).toBeVisible()
    await expect(otherProfile).toBeHidden()
    await expect(other.login.prompt).toBeHidden()
    await expect(other.header.home).toBeVisible()
  })
})
