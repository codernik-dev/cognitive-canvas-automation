/**
 * The local PIN screens: Setup (first run), Login (unlock), the lockout
 * view and the Forgot-PIN captcha. Rules (authService.ts / pinLockout.ts):
 * exactly 6 digits; 5 wrong attempts, then a 30 s lockout kept in
 * localStorage; the unlock itself lives in sessionStorage.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { ENV } from '../config/env.js'

export type PinInput = 'keyboard' | 'keypad'

class PinPad {
  constructor(protected readonly page: Page) {}

  digit(d: string): Locator {
    return this.page.getByRole('button', { name: d, exact: true })
  }

  get backspace() {
    return this.page.getByRole('button', { name: 'Backspace' })
  }

  /** The `aria-live` line both PIN screens write their errors to. */
  get message() {
    return this.page.locator('p[aria-live="polite"]')
  }

  async enter(pin: string, via: PinInput = 'keyboard') {
    if (via === 'keyboard') {
      await this.page.keyboard.type(pin)
      return
    }
    for (const d of pin) await this.digit(d).click()
  }
}

export class PinSetupPage extends PinPad {
  readonly heading = this.page.getByRole('heading', { name: 'Welcome', level: 1 })
  readonly createStep = this.page.getByText('Create a 6-digit PIN to lock the app on this device')
  readonly confirmStep = this.page.getByText('Confirm your PIN')
  readonly next = this.page.getByRole('button', { name: 'Next', exact: true })
  readonly createAccount = this.page.getByRole('button', { name: 'Create Account' })
  readonly back = this.page.getByRole('button', { name: 'Back', exact: true })
  readonly languageButton = this.page.getByRole('button', { name: /^Language:/ })

  async expectVisible() {
    await expect(this.heading).toBeVisible()
    await expect(this.createStep).toBeVisible()
  }

  /** Create and confirm a PIN on a fresh profile; resolves once the app has left the PIN screens. */
  async createPin(pin = ENV.testPin, via: PinInput = 'keyboard') {
    await this.expectVisible()
    await this.enter(pin, via)
    await expect(this.next).toBeEnabled()
    await this.next.click()
    await expect(this.confirmStep).toBeVisible()
    await this.enter(pin, via)
    await expect(this.createAccount).toBeEnabled()
    await this.createAccount.click()
    await expect(this.heading).toBeHidden({ timeout: 20_000 })
  }
}

export class LoginPage extends PinPad {
  readonly heading = this.page.getByRole('heading', { name: 'Cognitive Canvas', level: 1 })
  readonly prompt = this.page.getByText('Enter your PIN to continue')
  readonly unlock = this.page.getByRole('button', { name: 'Unlock', exact: true })
  readonly forgotPin = this.page.getByRole('button', { name: 'Forgot PIN?' })
  readonly lockedHeading = this.page.getByRole('heading', { name: 'Account locked' })
  readonly lockedBody = this.page.getByText('Too many incorrect PIN attempts. PIN entry is disabled until the timer ends.')

  async expectVisible() {
    await expect(this.prompt).toBeVisible()
  }

  async unlockWith(pin = ENV.testPin) {
    await this.expectVisible()
    await this.enter(pin)
    await this.unlock.click()
    await expect(this.prompt).toBeHidden({ timeout: 20_000 })
  }

  /** Enter a PIN that should be refused and wait for the refusal to be shown. */
  async failWith(pin: string) {
    await this.enter(pin)
    await this.unlock.click()
  }
}

/** "Reset PIN" dialog: a maths captcha guarding resetPin(). */
export class ForgotPinDialog {
  readonly dialog: Locator
  constructor(page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Reset PIN' })
  }

  get answer() {
    return this.dialog.getByPlaceholder('?')
  }

  get submit() {
    return this.dialog.getByRole('button', { name: 'Reset PIN', exact: true })
  }

  get error() {
    return this.dialog.getByRole('alert')
  }

  /** Read "a + b =" / "a × b =" off the dialog and compute it. */
  async solve(): Promise<number> {
    const q = await this.dialog.getByText(/^\s*\d+\s*[+×]\s*\d+\s*=\s*$/).innerText()
    const m = q.match(/(\d+)\s*([+×])\s*(\d+)/)
    if (!m) throw new Error(`Unrecognised captcha question: "${q}"`)
    const [a, op, b] = [Number(m[1]), m[2], Number(m[3])]
    return op === '+' ? a + b : a * b
  }
}

/**
 * "Change PIN" dialog, opened from the profile menu. Its <label>s are not
 * tied to the inputs (no htmlFor/id: a11y finding in 08-DEFECTS), so the
 * fields are found by placeholder.
 */
export class ChangePinDialog {
  readonly dialog: Locator
  constructor(page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Change PIN' })
  }

  get current() { return this.dialog.getByPlaceholder('••••••') }
  get next() { return this.dialog.getByPlaceholder('6 digits') }
  get confirm() { return this.dialog.getByPlaceholder('Re-enter new PIN') }
  get submit() { return this.dialog.getByRole('button', { name: 'Update PIN' }) }
  get error() { return this.dialog.getByRole('alert') }

  async change(current: string, next: string, confirm = next) {
    await this.current.fill(current)
    await this.next.fill(next)
    await this.confirm.fill(confirm)
    await this.submit.click()
  }
}
