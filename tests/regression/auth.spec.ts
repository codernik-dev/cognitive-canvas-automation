/**
 * Regression: PIN setup, lockout, reset and change. Rules under test
 * (authService.ts, pinLockout.ts): exactly 6 digits; 5 wrong attempts lock
 * entry for 30 s; the lockout survives a reload; Forgot PIN keeps the data.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test.js'
import { ENV } from '../../config/env.js'
import { readStore } from '../../helpers/idb.js'
import { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import { knownDefect } from '../../helpers/defects.js'

test.describe('PIN setup', { tag: ['@regression', '@auth'] }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open()
    await app.pinSetup.expectVisible()
  })

  test('REG-001 a confirm PIN that does not match is rejected and setup stays on the confirm step', { tag: '@P1' }, async ({ app }) => {
    await app.pinSetup.enter('111111')
    await app.pinSetup.next.click()
    await expect(app.pinSetup.confirmStep).toBeVisible()
    await app.pinSetup.enter('222222')
    await app.pinSetup.createAccount.click()
    await expect(app.pinSetup.message).toHaveText('PINs do not match')
    await expect(app.pinSetup.confirmStep).toBeVisible()
    await expect(app.pinSetup.createAccount).toBeDisabled() // the confirm field was cleared
  })

  test('REG-002 Back on the confirm step returns to the create step', { tag: '@P3' }, async ({ app }) => {
    await app.pinSetup.enter('111111')
    await app.pinSetup.next.click()
    await app.pinSetup.back.click()
    await expect(app.pinSetup.createStep).toBeVisible()
  })

  test('REG-003 the keypad needs all 6 digits and Backspace removes the last one', { tag: '@P2' }, async ({ app }) => {
    await app.pinSetup.enter('12345', 'keypad')
    await expect(app.pinSetup.next).toBeDisabled()
    await app.pinSetup.digit('6').click()
    await expect(app.pinSetup.next).toBeEnabled()
    await app.pinSetup.backspace.click()
    await expect(app.pinSetup.next).toBeDisabled()
    // A 7th digit is ignored: the pad stops at 6.
    await app.pinSetup.enter('99', 'keypad')
    await app.pinSetup.next.click()
    await app.pinSetup.enter('123459', 'keypad')
    await app.pinSetup.createAccount.click()
    await expect(app.header.home).toBeVisible()
  })
})

test.describe('PIN lockout and recovery', { tag: ['@regression', '@auth'] }, () => {
  test('REG-004 five wrong PINs lock entry for 30 s, the lock survives a reload, then expires', { tag: '@P1' }, async ({ page, app }) => {
    await page.clock.install()
    await app.open()
    await app.pinSetup.createPin()
    await app.firstRunCatalogShown()
    await app.home.reach()
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    for (let left = 4; left >= 1; left--) {
      await app.login.failWith('000000')
      await expect(app.login.message).toHaveText(`Incorrect PIN. ${left} of 5 attempts left.`)
    }
    await app.login.failWith('000000')
    await expect(app.login.lockedHeading).toBeVisible()
    await expect(app.login.lockedBody).toBeVisible()

    await app.reload()
    await expect(app.login.lockedHeading).toBeVisible()

    await page.clock.fastForward('00:31')
    await expect(app.login.lockedHeading).toBeHidden()
    await app.login.unlockWith(ENV.testPin)
    await expect(app.header.home).toBeVisible()
  })

  test('REG-005 Forgot PIN: a wrong answer is refused, the right one clears the PIN and keeps the projects', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.home.createProject('Kept Through Reset')
    await app.documents.expectOpen('Kept Through Reset')
    await app.profileMenu.choose('Lock')
    await app.login.forgotPin.click()
    await expect(app.forgotPin.dialog).toBeVisible()

    const right = await app.forgotPin.solve()
    await app.forgotPin.answer.fill(String(right + 1))
    await app.forgotPin.submit.click()
    await expect(app.forgotPin.error).toHaveText('That answer is incorrect. Try a new question.')

    const answer = await app.forgotPin.solve()
    await app.forgotPin.answer.fill(String(answer))
    await Promise.all([page.waitForEvent('load'), app.forgotPin.submit.click()])
    await app.pinSetup.createPin('246802')
    await app.home.reach()
    await expect(app.home.card('Kept Through Reset')).toBeVisible()
  })

  // Open issue #295: "change pin > wrong current pin is accepted and new pin is created".
  test('REG-006 Change PIN refuses a wrong current PIN', { tag: '@P1' }, async ({ signedIn: app, page }) => {
    const before = (await readStore<{ pinHash: string }>(page, 'users'))[0].pinHash
    await app.profileMenu.choose('Change PIN')
    await expect(app.changePin.dialog).toBeVisible()
    await app.changePin.change('999999', '112233')
    await expect(app.changePin.error).toBeVisible()
    await expect(app.changePin.dialog).toBeVisible()
    const after = (await readStore<{ pinHash: string }>(page, 'users'))[0].pinHash
    expect(after, 'the stored PIN must not change').toBe(before)
  })

  test('REG-007 a changed PIN unlocks the app and the old one no longer does', { tag: '@P1' }, async ({ signedIn: app }) => {
    await app.profileMenu.choose('Change PIN')
    await app.changePin.change(ENV.testPin, '112233')
    await app.toasts.expectShown('PIN updated.')
    await app.profileMenu.choose('Lock')
    await app.login.failWith(ENV.testPin)
    await expect(app.login.message).toHaveText('Incorrect PIN. 4 of 5 attempts left.')
    await app.login.unlockWith('112233')
    await expect(app.header.home).toBeVisible()
  })

  test('REG-008 Change PIN refuses a new PIN that is the same as the current one', { tag: '@P3' }, async ({ signedIn: app }) => {
    await app.profileMenu.choose('Change PIN')
    await app.changePin.change(ENV.testPin, ENV.testPin)
    await expect(app.changePin.error).toHaveText('New PIN must be different from your current PIN.')
  })
})

test.describe('Sessions across tabs', { tag: ['@regression', '@auth', '@persistence'] }, () => {
  test('REG-009 a second tab opens unlocked, and Lock in one tab locks the other', { tag: '@P2' }, async ({ signedIn: app, context }) => {
    const second = await context.newPage()
    const app2 = new CognitiveCanvas(second)
    await app2.open()
    await expect(app2.header.home).toBeVisible()
    await expect(app2.login.prompt).toBeHidden()

    await app2.profileMenu.choose('Lock')
    await app2.login.expectVisible()
    await app.login.expectVisible()
  })
})

/* ── Added by the shell suite (REG-600..610) ─────────────────────────────── */

const failedAttempts = (page: Page) =>
  page.evaluate(() => [localStorage.getItem('cc2_pin_failed_attempts'), localStorage.getItem('cc2_pin_locked_until')])

/** Five wrong PINs, each refusal awaited (a PIN typed while the last one is still being checked is cleared). */
async function failFiveTimes(app: CognitiveCanvas) {
  for (let left = 4; left >= 1; left--) {
    await app.login.failWith('000000')
    await expect(app.login.message).toHaveText(`Incorrect PIN. ${left} of 5 attempts left.`)
  }
  await app.login.failWith('000000')
  await expect(app.login.lockedHeading).toBeVisible()
}

test.describe('PIN entry by keyboard', { tag: ['@regression', '@auth'] }, () => {
  test('REG-600 Enter moves setup to the confirm step and creates the account; only a salted hash of the PIN is stored; Enter unlocks', { tag: '@P1' }, async ({ app, page }) => {
    await app.open()
    await app.pinSetup.expectVisible()
    await page.keyboard.type(ENV.testPin)
    await page.keyboard.press('Enter')
    await expect(app.pinSetup.confirmStep).toBeVisible()
    await page.keyboard.type(ENV.testPin)
    await page.keyboard.press('Enter')
    await expect(app.pinSetup.heading).toBeHidden({ timeout: 20_000 })
    const users = await readStore<{ pinHash: string; id: string }>(page, 'users')
    expect(users).toHaveLength(1)
    expect(users[0].pinHash).toMatch(/^pbkdf2\$sha256\$200000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(JSON.stringify(users)).not.toContain(ENV.testPin)

    await app.firstRunCatalogShown()
    await app.home.reach()
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    await page.keyboard.type(ENV.testPin)
    await page.keyboard.press('Enter')
    await expect(app.header.home).toBeVisible()
    await expect(app.login.prompt).toBeHidden()
  })

  test('REG-601 typed PINs stop at six digits, Backspace removes one, letters are ignored, and Enter waits for all six', { tag: '@P2' }, async ({ app, page }) => {
    await app.open()
    await app.pinSetup.expectVisible()
    await page.keyboard.type('12345')
    await page.keyboard.press('Enter') // five digits: Enter does nothing
    await expect(app.pinSetup.createStep).toBeVisible()
    await expect(app.pinSetup.next).toBeDisabled()
    await page.keyboard.type('abc6')
    await expect(app.pinSetup.next).toBeEnabled()
    await page.keyboard.type('9') // a seventh digit is dropped
    await page.keyboard.press('Backspace')
    await expect(app.pinSetup.next).toBeDisabled()
    await page.keyboard.type('6')
    await app.pinSetup.next.click()
    await page.keyboard.type('123456')
    await app.pinSetup.createAccount.click()
    await app.firstRunCatalogShown()
    await app.home.reach()
    await app.profileMenu.choose('Lock')
    await app.login.unlockWith('123456') // the PIN is 123456, not 1234569
    await expect(app.header.home).toBeVisible()
  })
})

test.describe('Unlock screen', { tag: ['@regression', '@auth'] }, () => {
  test('REG-602 Lock survives a reload: the unlock is dropped from this tab and the PIN is asked again', { tag: '@P1' }, async ({ signedIn: app, page }) => {
    expect(await page.evaluate(() => sessionStorage.getItem('cc-auth-session'))).toContain('"authenticated":true')
    await app.profileMenu.choose('Lock')
    await app.login.expectVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('cc-auth-session'))).toBeNull()
    await app.reload()
    await app.login.expectVisible()
    await expect(app.header.home).toBeHidden()
    await app.login.unlockWith()
    await expect(app.header.home).toBeVisible()
  })

  test('REG-603 the unlock keypad needs six digits, Backspace removes one, and a right PIN resets the attempt counter', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await app.profileMenu.choose('Lock')
    await app.login.failWith('000000')
    await expect(app.login.message).toHaveText('Incorrect PIN. 4 of 5 attempts left.')
    expect(await failedAttempts(page)).toEqual(['1', null])

    await app.login.enter(ENV.testPin.slice(0, 5), 'keypad')
    await expect(app.login.message).not.toContainText('Incorrect PIN') // a new digit clears the message
    await expect(app.login.unlock).toBeDisabled()
    await app.login.backspace.click()
    await app.login.enter(ENV.testPin.slice(4), 'keypad')
    await expect(app.login.unlock).toBeEnabled()
    await app.login.unlock.click()
    await expect(app.header.home).toBeVisible()
    expect(await failedAttempts(page)).toEqual([null, null])

    await app.profileMenu.choose('Lock')
    await app.login.failWith('000000')
    await expect(app.login.message).toHaveText('Incorrect PIN. 4 of 5 attempts left.')
  })

  test('REG-604 the locked screen counts down, ignores typed digits, and Forgot PIN there clears the lock and keeps the data', { tag: '@P1' }, async ({ page, app }) => {
    await page.clock.install()
    await app.open()
    await app.pinSetup.createPin()
    await app.firstRunCatalogShown()
    await app.home.reach()
    await app.home.createProject('Kept Through Lockout')
    await app.documents.expectOpen('Kept Through Lockout')
    await app.profileMenu.choose('Lock')
    await failFiveTimes(app)
    await expect(page.getByText('Try again in')).toBeVisible()
    await expect(page.getByText(/^(30|29)s$/)).toBeVisible()
    await page.clock.fastForward('00:10')
    await expect(page.getByText(/^(20|19)s$/)).toBeVisible()
    // No keypad while locked, and typed digits are not collected behind the lock.
    await expect(app.login.digit('1')).toHaveCount(0)
    await page.keyboard.type(ENV.testPin)
    await page.clock.fastForward('00:21')
    await expect(app.login.lockedHeading).toBeHidden()
    await expect(app.login.unlock).toBeDisabled()
    expect(await failedAttempts(page)).toEqual([null, null])

    await failFiveTimes(app)
    await page.getByRole('button', { name: 'Forgot PIN?' }).click()
    await app.forgotPin.answer.fill(String(await app.forgotPin.solve()))
    await Promise.all([page.waitForEvent('load'), app.forgotPin.submit.click()])
    expect(await failedAttempts(page)).toEqual([null, null])
    await app.pinSetup.createPin('864200')
    await app.home.reach()
    await expect(app.home.card('Kept Through Lockout')).toBeVisible()
  })

  test('REG-605 Forgot PIN explains what is kept, refuses a non-number, needs an answer, and Cancel changes nothing', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const before = (await readStore<{ pinHash: string }>(page, 'users'))[0].pinHash
    await app.profileMenu.choose('Lock')
    await app.login.forgotPin.click()
    await expect(app.forgotPin.dialog).toContainText('Heads up')
    await expect(app.forgotPin.dialog).toContainText('This clears your PIN so you can set a new one. Your projects, documents, and highlights stay on this device — only the PIN is erased.')
    await expect(app.forgotPin.submit).toBeDisabled()
    await app.forgotPin.answer.fill('abc')
    await app.forgotPin.submit.click()
    await expect(app.forgotPin.error).toHaveText('Please enter a number.')
    await app.forgotPin.dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(app.forgotPin.dialog).toBeHidden()
    expect((await readStore<{ pinHash: string }>(page, 'users'))[0].pinHash).toBe(before)
    await app.login.unlockWith()
    await expect(app.header.home).toBeVisible()
  })
})

test.describe('Change PIN rules', { tag: ['@regression', '@auth'] }, () => {
  test('REG-606 Change PIN waits for three six-digit fields, keeps only digits, refuses a mismatched confirmation, and Cancel changes nothing', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const before = (await readStore<{ pinHash: string }>(page, 'users'))[0].pinHash
    await app.profileMenu.choose('Change PIN')
    await expect(app.changePin.submit).toBeDisabled()
    await app.changePin.current.fill(ENV.testPin)
    await app.changePin.next.fill('1a2b3c') // pasted letters are stripped
    await expect(app.changePin.next).toHaveValue('123')
    await expect(app.changePin.submit).toBeDisabled()
    await app.changePin.next.fill('112233')
    await app.changePin.confirm.fill('112234')
    await app.changePin.submit.click()
    await expect(app.changePin.error).toHaveText('New PINs do not match.')
    await app.changePin.dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(app.changePin.dialog).toBeHidden()
    expect((await readStore<{ pinHash: string }>(page, 'users'))[0].pinHash).toBe(before)
    // Reopened, the form starts empty.
    await app.profileMenu.choose('Change PIN')
    for (const f of [app.changePin.current, app.changePin.next, app.changePin.confirm]) await expect(f).toHaveValue('')
  })

  test('REG-607 wrong current PINs in Change PIN count towards the same lockout as the unlock screen', { tag: '@P1' }, async ({ signedIn: app, page }) => {
    await app.profileMenu.choose('Change PIN')
    for (let left = 4; left >= 1; left--) {
      await app.changePin.change('999999', '112233')
      await expect(app.changePin.error).toHaveText(`Incorrect PIN. ${left} of 5 attempts left.`)
    }
    await app.changePin.change('999999', '112233')
    await expect(app.changePin.error).toHaveText('Account locked. Please wait.')
    await app.changePin.change(ENV.testPin, '112233') // even the right PIN is refused while locked
    await expect(app.changePin.error).toHaveText(/^Too many attempts\. Try again in \d+s$/)
    expect((await failedAttempts(page))[0]).toBe('5')
    await app.changePin.dialog.getByRole('button', { name: 'Cancel' }).click()
    await app.profileMenu.choose('Lock')
    await expect(app.login.lockedHeading).toBeVisible()
  })

  test('REG-608 Forgot PIN? inside Change PIN opens the same reset captcha', { tag: '@P3' }, async ({ signedIn: app }) => {
    await app.profileMenu.choose('Change PIN')
    await app.changePin.dialog.getByRole('button', { name: 'Forgot PIN?' }).click()
    await expect(app.forgotPin.dialog).toBeVisible()
    await expect(app.forgotPin.dialog.getByText(/^\s*\d+\s*[+×]\s*\d+\s*=\s*$/)).toBeVisible()
    await app.forgotPin.dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(app.forgotPin.dialog).toBeHidden()
    await expect(app.changePin.dialog).toBeVisible()
  })
})

test.describe('Profile menu and tabs (signed out of MuulOrigin)', { tag: ['@regression', '@auth'] }, () => {
  test('REG-609 a PIN created in one tab takes a second tab off the setup screen and into the same session', { tag: '@P2' }, async ({ app, context, page }) => {
    await app.open()
    await app.pinSetup.expectVisible()
    const second = new CognitiveCanvas(await context.newPage())
    await second.open()
    await second.pinSetup.expectVisible()
    await app.pinSetup.createPin()
    // The 'pin-created' broadcast makes the second tab re-check; it then adopts the live session (as REG-009).
    await expect(second.pinSetup.heading).toBeHidden()
    await expect(second.header.home).toBeVisible()
    expect(await readStore(page, 'users')).toHaveLength(1)
  })

  test('REG-610 the signed-out profile menu offers Sign in, Data Center, Change PIN and Lock, closes on Escape or outside, and Sign in goes to MuulOrigin', { tag: '@P2' }, async ({ signedIn: app, page, blockedRequests }) => {
    await app.header.profile.click()
    await expect(app.profileMenu.menu.getByRole('menuitem')).toHaveText(['Sign in', 'Data Center', 'Change PIN', 'Lock'])
    await page.keyboard.press('Escape')
    await expect(app.profileMenu.menu).toBeHidden()
    await app.header.profile.click()
    await page.mouse.click(683, 600)
    await expect(app.profileMenu.menu).toBeHidden()

    await app.profileMenu.choose('Data Center')
    await expect(app.dataCenter.modeToggle('Backup')).toBeVisible()
    await app.dataCenter.dialog.getByRole('button', { name: 'Close' }).click() // persistent: Escape does not close it
    await expect(app.dataCenter.modeToggle('Backup')).toBeHidden()

    const href = page.url()
    const signin = page.waitForRequest((r) => r.url().startsWith('https://www.muulorigin.com/signin'))
    await app.profileMenu.choose('Sign in')
    const url = new URL((await signin).url())
    expect(url.origin + url.pathname).toBe('https://www.muulorigin.com/signin')
    expect(url.searchParams.get('returnUrl')).toBe(href)
    expect(blockedRequests.some((r) => r.startsWith('GET https://www.muulorigin.com/signin?returnUrl='))).toBe(true)
  })
})

/* ── Boot screen when the data cannot be opened (App.tsx LoadingScreen) ──── */

/**
 * A same-origin blank page (served by a route, so the app does not boot on
 * it) where the test can prepare this profile's IndexedDB the way another
 * build or another tab would have left it.
 */
async function blankOnAppOrigin(page: Page) {
  await page.route('**/__automation_blank', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' }))
  await page.goto('/__automation_blank')
}

/** Another tab of an older build: holds the database open at version 1 and ignores requests to close. */
async function holdDataInAnotherTab(context: BrowserContext) {
  const holder = await context.newPage()
  await blankOnAppOrigin(holder)
  await holder.evaluate(() => new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('cognitive-canvas', 1)
    r.onsuccess = () => { (window as unknown as { held: IDBDatabase }).held = r.result; resolve() }
    r.onerror = () => reject(r.error)
  }))
  return holder
}

/**
 * Each open gives up after 20 s and the boot retries three times (pausing 0.4,
 * 1.5 and 4 s). A clock jump fires what is due once, so the chain needs seven
 * jumps; one more covers an open that started just after the first jump.
 */
async function runOutTheOpenRetries(page: Page) {
  for (let i = 0; i < 8; i++) await page.clock.fastForward('00:25')
}

test.describe('Boot screen', { tag: ['@regression', '@auth', '@persistence'] }, () => {
  // The loading screen is the user-facing handler; other boot-time readers of the
  // database (the storage meter among them) reject with the same DbOpenError
  // without catching it, which the page reports as an unhandled rejection.
  test.use({ allowedPageErrors: [/^DbOpenError: (Your data on this device was saved by a newer version|Another Cognitive Canvas tab is holding your data|Your data did not open within)/] })

  test('REG-615 data saved by a newer build is explained on the loading screen, with Try again and Reload instead of an endless spinner', { tag: '@P2' }, async ({ app, page }) => {
    await blankOnAppOrigin(page)
    // What a rollback leaves behind: the database at a version newer than this build's.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('cognitive-canvas', 999)
      r.onsuccess = () => { r.result.close(); resolve() }
      r.onerror = () => reject(r.error)
    }))
    await app.open()
    await expect(page.getByText('Could not open your data')).toBeVisible({ timeout: 30_000 }) // three retries, ~6 s
    await expect(page.getByText(/^Your data on this device was saved by a newer version of Cognitive Canvas than the one that just loaded \(this build expects data version \d+\)\./)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Loading...')).toBeVisible()
    await expect(page.getByText('Could not open your data')).toBeVisible({ timeout: 30_000 })
    await expect(app.pinSetup.heading).toBeHidden() // the newer data was not overwritten by a fresh setup
    expect(await page.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === 'cognitive-canvas')?.version)).toBe(999)
  })

  test('REG-616 a tab holding the data at an older version stalls the boot: "Still loading…" after 12 s, then an error with Try again, which works once that tab is closed', { tag: '@P3' }, async ({ app, page, context }) => {
    const holder = await holdDataInAnotherTab(context)
    await page.clock.install()
    await app.open()
    await expect(page.getByText('Loading...')).toBeVisible()
    await page.clock.fastForward('00:12')
    await expect(page.getByText('Still loading…')).toBeVisible()
    await expect(page.getByText('If this keeps happening, close other Cognitive Canvas tabs and reload.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await runOutTheOpenRetries(page)
    await expect(page.getByText('Could not open your data')).toBeVisible()
    await expect(app.pinSetup.heading).toBeHidden()

    await holder.close()
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.clock.resume()
    await app.pinSetup.expectVisible()
  })

  test('REG-617 when another tab holds the data at an older version, the error says to close the other tabs', { tag: '@P3' }, async ({ app, page, context }) => {
    knownDefect('DEF-606')
    await holdDataInAnotherTab(context)
    await page.clock.install()
    await app.open()
    await expect(page.getByText('Loading...')).toBeVisible()
    await runOutTheOpenRetries(page)
    await expect(page.getByText('Could not open your data')).toBeVisible()
    await expect(page.getByText('Another Cognitive Canvas tab is holding your data at an older version. Close the other tabs and try again.')).toBeVisible()
  })
})
