/** Sanity: the PIN lock a returning user meets every day. */
import { test, expect } from '../../fixtures/test.js'
import { ENV } from '../../config/env.js'

test.describe('Auth sanity', { tag: ['@sanity', '@auth'] }, () => {
  test('SAN-001 Lock returns to the unlock screen and the right PIN opens the app again', { tag: '@P1' }, async ({ signedIn: app }) => {
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    await app.login.unlockWith(ENV.testPin)
    await expect(app.header.home).toBeVisible()
  })

  test('SAN-002 a wrong PIN is refused with the attempts left', { tag: '@P1' }, async ({ signedIn: app }) => {
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    await app.login.failWith('000000')
    await expect(app.login.message).toHaveText('Incorrect PIN. 4 of 5 attempts left.')
    await expect(app.login.prompt).toBeVisible()
  })

  test('SAN-003 reloading the page keeps the session unlocked', { tag: '@P1' }, async ({ signedIn: app }) => {
    await app.reload()
    await expect(app.header.home).toBeVisible()
    await expect(app.login.prompt).toBeHidden()
  })
})
