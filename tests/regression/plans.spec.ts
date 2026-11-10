/**
 * Regression: which backup sources each plan unlocks, and every plan-facing
 * surface around them: the Data Center badges and SourceGate copy, the
 * "Checking your plan…" pending state, Sign in / Upgrade navigation,
 * Settings > Plan for paid plans, the subscription status banner, and the
 * sign-out flow (DataCenter/access.ts, SourceGate.tsx, PlanSection.tsx,
 * SubscriptionStatusBanner.tsx, SignOutConfirmModal.tsx, muulOriginAuth.ts).
 *
 * Plans come from the server's contract fixtures through the shared account
 * mock (helpers/mocks/muulAccount.ts). Many plans are checked in one boot:
 * the mock starts answering with the next plan and the app is asked to look
 * again (`cc2:plan-recheck`, what it does on window focus after a checkout),
 * which is also how a real plan change reaches an open tab.
 */
import { test, expect } from '../../fixtures/backup.js'
import { entitlementsFor, fakeJwt, MUUL_API, MUUL_WWW, type MuulApiMock, type PlanScenario } from '../../helpers/mocks/muulAccount.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { FIND_PDF } from '../../data/files.js'
import { bootToHome, createProjects } from '../../workflows/backup.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { BackupUi } from '../../pages/BackupScreens.js'
import type { Page } from '@playwright/test'
import { knownDefect } from '../../helpers/defects.js'

const PLANS_URL = `${MUUL_WWW}/products/cognitive-canvas#pricing`
/** The header's upgrade pill (GlobalSettingsBar): "Upgrade" on Free, "Upgrade to Pro" on Economy, absent on Pro and up. */
const headerUpgrade = (page: Page) => page.getByRole('button', { name: 'See plans and upgrade' })

/** Serve a tiny page for a www.muulorigin.com navigation, so the final URL (hash included) can be read. */
async function stubWww(page: Page, glob: string) {
  await page.route(`${MUUL_WWW}/${glob}`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }))
}

/** Make the server answer with `plan` and have the open app ask for it again. */
async function switchPlan(muul: MuulApiMock, page: Page, plan: PlanScenario) {
  await muul.on('GET', '/api/entitlements', () => ({ json: entitlementsFor(plan) }))
  const answered = page.waitForResponse((r) => r.url().startsWith(`${MUUL_API}/api/entitlements`))
  await page.evaluate(() => window.dispatchEvent(new Event('cc2:plan-recheck')))
  await answered
}

async function openSource(app: CognitiveCanvas, mode: 'Backup' | 'Restore', label: 'Cloud' | 'GitHub') {
  await app.dataCenter.openFromHeader()
  await app.dataCenter.choose(mode, label)
}

/** Expected chooser card names in Backup mode for a plan that unlocks nothing / GitHub only / both. */
const CARDS = {
  none: ['Pro Cloud Sync across all your devices', 'Economy GitHub Commit to your repository'],
  github: ['Pro Cloud Sync across all your devices', 'GitHub Commit to your repository'],
  both: ['Cloud Sync across all your devices', 'GitHub Commit to your repository'],
}

async function expectCards(app: CognitiveCanvas, names: string[], plan: string) {
  await expect(app.dataCenter.cards.nth(0), `Cloud card on ${plan}`).toHaveAccessibleName(names[0])
  await expect(app.dataCenter.cards.nth(1), `GitHub card on ${plan}`).toHaveAccessibleName(names[1])
}

async function expectCloudGate(app: CognitiveCanvas, plan: string) {
  const dc = app.dataCenter
  await expect(dc.gateHeading, plan).toHaveText('Cloud backup needs the Pro plan')
  await expect(dc.dialog.getByText('Back up your projects to the cloud and keep them in sync across your devices.')).toBeVisible()
  await expect(dc.gateButton('Upgrade to Pro'), plan).toBeVisible()
  await expect(dc.dialog.getByText('Unlocks Cloud backup & restore.')).toBeVisible()
  await expect(dc.dialog.getByRole('heading', { name: 'Backup to Cloud' })).toHaveCount(0)
}

async function expectGithubGate(app: CognitiveCanvas, plan: string) {
  const dc = app.dataCenter
  await expect(dc.gateHeading, plan).toHaveText('GitHub backup needs the Economy plan')
  await expect(dc.dialog.getByText('Commit your backups to a GitHub repository you control, versioned like code.')).toBeVisible()
  await expect(dc.gateButton('Upgrade to Economy'), plan).toBeVisible()
  await expect(dc.dialog.getByText('Unlocks GitHub backup & restore.')).toBeVisible()
}

/** A plan without paid features: both gates in Backup, the cloud list (restore-only) in Restore. */
async function expectLocked(app: CognitiveCanvas, plan: string) {
  const dc = app.dataCenter
  await dc.openFromHeader()
  await expectCards(app, CARDS.none, plan)
  await dc.source('Cloud').click()
  await expectCloudGate(app, plan)
  await dc.sidebarSource('GitHub').click()
  await expectGithubGate(app, plan)
  // Restoring what is already stored needs only the account.
  await dc.modeToggle('Restore').click()
  await dc.sidebarSource('Cloud').click()
  await expect(dc.dialog.getByRole('heading', { name: 'Restore from Cloud' }), plan).toBeVisible()
  await expect(dc.dialog.getByText('No backups found in Muul Cloud.')).toBeVisible()
  await expect(dc.storageFigure, plan).toHaveText('0.0 MB stored · uploading is not in your plan')
  await expect(dc.sidebarSource('Cloud')).toHaveAccessibleName('Cloud Sync across devices')
  await dc.close.click()
}

async function expectUnlocked(app: CognitiveCanvas, plan: string, meter: string) {
  const dc = app.dataCenter
  await dc.openFromHeader()
  await expectCards(app, CARDS.both, plan)
  await dc.source('Cloud').click()
  await expect(dc.dialog.getByRole('heading', { name: 'Backup to Cloud' }), plan).toBeVisible()
  await expect(dc.storageFigure, plan).toHaveText(meter)
  await dc.sidebarSource('GitHub').click()
  await expect(dc.panelHeading, plan).toHaveText('Back up to GitHub')
  await dc.close.click()
}

test.describe('Plan gates', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  test.describe('plans without paid features', () => {
    test.use({ muulPlan: 'free' })
    test('REG-421 Free, no subscription and every ended Pro lock Cloud and GitHub behind Upgrade buttons but still list cloud backups to restore', { tag: '@P1' }, async ({ signedIn: app, muul, page }) => {
      await expect(headerUpgrade(page)).toHaveText('Upgrade')
      await expectLocked(app, 'free')
      for (const plan of ['no-subscription', 'pro-cancelled-ended', 'pro-refunded', 'pro-seat-ended', 'pro-one-time-expired', 'pro-halted-after-grace'] as const) {
        await switchPlan(muul, page, plan)
        await expectLocked(app, plan)
      }
    })
  })

  test.describe('lapsed Pro plans', () => {
    test.use({ muulPlan: 'pro-paused' })
    test('REG-422 a paused, halted or cancelled Pro reads as Free: both sources locked, cloud backups still restorable', { tag: '@P1' }, async ({ signedIn: app, muul, page }) => {
      await expectLocked(app, 'pro-paused')
      for (const plan of ['pro-halted', 'pro-cancelled'] as const) {
        await switchPlan(muul, page, plan)
        await expectLocked(app, plan)
      }
    })
  })

  test.describe('plans with paid features', () => {
    test.use({ muulPlan: 'pro' })
    test('REG-423 Pro, Enterprise, a team seat and Pro in grace, retrying or cancelling unlock both sources with no badges and their storage allowance', { tag: '@P1' }, async ({ signedIn: app, muul, page }) => {
      await expectUnlocked(app, 'pro', '0.0 MB / 10.00 GB')
      await expect(headerUpgrade(page)).toHaveCount(0)
      await switchPlan(muul, page, 'enterprise')
      await expectUnlocked(app, 'enterprise', '0.0 MB used · no enforced limit')
      for (const plan of ['alias-fullcommunity', 'pro-seat', 'pro-cancelling', 'pro-grace', 'pro-retrying'] as const) {
        await switchPlan(muul, page, plan)
        await expectUnlocked(app, plan, '0.0 MB / 10.00 GB')
      }
    })
  })

  test.describe('Economy, then Pro', () => {
    test.use({ muulPlan: 'dev' })
    test('REG-109 Economy unlocks GitHub only; after an upgrade to Pro the next plan check unlocks Cloud without a reload', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, muul, page }) => {
      const dc = app.dataCenter
      await expect(headerUpgrade(page)).toHaveText('Upgrade to Pro')
      await dc.openFromHeader()
      await expectCards(app, CARDS.github, 'dev')
      await dc.source('GitHub').click()
      await expect(dc.panelHeading).toHaveText('Back up to GitHub')
      // In an ordinary browser GitHub needs the MoBrowser app.
      await expect(dc.openInMoBrowser).toBeVisible()
      await dc.sidebarSource('Cloud').click()
      await expectCloudGate(app, 'dev')
      await expect(dc.sidebarSource('Cloud')).toHaveAccessibleName('Cloud Sync across devices Pro')

      // Back from checkout: the server now says Pro, and the open app asks again.
      await switchPlan(muul, page, 'pro')
      await expect(dc.dialog.getByRole('heading', { name: 'Backup to Cloud' })).toBeVisible()
      await expect(dc.sidebarSource('Cloud')).toHaveAccessibleName('Cloud Sync across devices')
      await expect(headerUpgrade(page)).toHaveCount(0)
    })
  })

  test.describe('an unrecognised paid tier', () => {
    test.use({ muulPlan: 'unknown-paid-gold' })
    test('REG-424 an unknown paid tier counts as Economy: GitHub opens, Cloud stays behind Upgrade to Pro', { tag: '@P3' }, async ({ signedIn: app }) => {
      await openSource(app, 'Backup', 'GitHub')
      await expect(app.dataCenter.panelHeading).toHaveText('Back up to GitHub')
      await app.dataCenter.sidebarSource('Cloud').click()
      await expectCloudGate(app, 'unknown-paid-gold')
    })
  })

  test.describe('Free, with tier enforcement switched off', () => {
    test.use({ muulPlan: 'free' })
    test('REG-425 the tester kill switch for plan enforcement does not unlock the Data Center sources', { tag: '@P3' }, async ({ app, page }) => {
      await page.addInitScript(() => localStorage.setItem('cc2_flag_tier_enforcement', 'off'))
      await bootToHome(app)
      await openSource(app, 'Backup', 'Cloud')
      await expectCloudGate(app, 'free (enforcement off)')
    })
  })
})

test.describe('Signed out', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  test.use({ muulPlan: null })

  test('REG-426 Cloud restore asks a signed-out user only to sign in, never to pay; GitHub asks to sign in, then upgrade', { tag: '@P2' }, async ({ signedIn: app }) => {
    const dc = app.dataCenter
    await openSource(app, 'Restore', 'Cloud')
    await expect(dc.gateHeading).toHaveText('Sign in to see your cloud backups')
    await expect(dc.dialog.getByText('Backups you have already made stay yours to restore or delete, on every plan.')).toBeVisible()
    await expect(dc.gateButton('Sign in')).toBeVisible()
    await expect(dc.dialog.getByText('No plan is needed to restore — just your account.')).toBeVisible()
    // The gate shows no plan badge for a restore (the sidebar's badge is REG-436).
    await expect(dc.gateHeading.locator('xpath=preceding-sibling::span')).toHaveCount(0)
    await dc.sidebarSource('GitHub').click()
    await expect(dc.gateHeading).toHaveText('GitHub backup needs the Economy plan')
    await expect(dc.dialog.getByText('Sign in, then upgrade to unlock GitHub backup & restore.')).toBeVisible()
  })

  test('REG-436 signed out, Cloud is not marked "Pro" in Restore, where no plan is needed', { tag: '@P3' }, async ({ signedIn: app }) => {
    knownDefect('DEF-403')
    const dc = app.dataCenter
    await dc.openFromHeader()
    await dc.modeToggle('Restore').click()
    await expect(dc.cards.nth(0)).toHaveAccessibleName('Cloud Restore from your cloud backups')
    await dc.source('Cloud').click()
    await expect(dc.gateHeading).toHaveText('Sign in to see your cloud backups')
    await expect(dc.sidebarSource('Cloud')).toHaveAccessibleName('Cloud Sync across devices')
  })

  test('REG-427 Sign in on the gate goes to MuulOrigin sign-in with this page as returnUrl and clears a previous sign-out', { tag: '@P1' }, async ({ signedIn: app, page }) => {
    await page.evaluate(() => localStorage.setItem('cc2_explicit_signout', '1'))
    await openSource(app, 'Backup', 'Cloud')
    await expect(app.dataCenter.dialog.getByText('Sign in, then upgrade to unlock Cloud backup & restore.')).toBeVisible()
    const here = page.url()
    await stubWww(page, 'signin**')
    const flag = page.waitForEvent('framenavigated')
    await app.dataCenter.gateButton('Sign in').click()
    await flag
    await page.waitForURL(`${MUUL_WWW}/signin**`)
    const url = new URL(page.url())
    expect(url.origin + url.pathname).toBe(`${MUUL_WWW}/signin`)
    expect(url.search).toBe(`?returnUrl=${encodeURIComponent(here)}`)
    await page.goBack()
    expect(await page.evaluate(() => localStorage.getItem('cc2_explicit_signout'))).toBeNull()
  })

  test('REG-428 the header silhouette menu offers Sign in, which goes to the same sign-in page', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const here = page.url()
    await stubWww(page, 'signin**')
    await app.profileMenu.choose('Sign in')
    await page.waitForURL(`${MUUL_WWW}/signin**`)
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(here)
  })

  test('REG-429 a sign-in that lands without a reload unlocks Pro sources as soon as the plan arrives', { tag: '@P2' }, async ({ signedIn: app, muul, page }) => {
    const dc = app.dataCenter
    await openSource(app, 'Backup', 'Cloud')
    await expect(dc.gateHeading).toHaveText('Cloud backup needs the Pro plan')
    await muul.on('GET', '/api/entitlements', () => ({ json: entitlementsFor('pro') }))
    const asked = muul.waitForCall('GET', '/api/entitlements')
    await page.evaluate((token) => {
      localStorage.setItem('mo_token', token)
      window.dispatchEvent(new Event('cc2:sso-identity-updated'))
      window.dispatchEvent(new Event('cc2:plan-recheck'))
    }, fakeJwt())
    expect((await asked).headers()['authorization']).toBe(`Bearer ${fakeJwt()}`)
    await expect(dc.dialog.getByRole('heading', { name: 'Backup to Cloud' })).toBeVisible()
  })
})

test.describe('Upgrade navigation', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  test.use({ muulPlan: 'free' })
  test('REG-430 Upgrade to Pro and Upgrade to Economy open the Cognitive Canvas pricing section on muulorigin.com', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await stubWww(page, 'products/**')
    await openSource(app, 'Backup', 'Cloud')
    await app.dataCenter.gateButton('Upgrade to Pro').click()
    await page.waitForURL(`${MUUL_WWW}/products/**`)
    expect(page.url()).toBe(PLANS_URL)

    await page.goBack()
    await app.home.reach()
    await openSource(app, 'Backup', 'GitHub')
    await app.dataCenter.gateButton('Upgrade to Economy').click()
    await page.waitForURL(`${MUUL_WWW}/products/**`)
    expect(page.url()).toBe(PLANS_URL)
  })
})

test.describe('Plan not confirmed yet', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  test('REG-431 while the plan is being checked no badge, gate button or upgrade offer is shown anywhere; the answer then unlocks Pro', { tag: '@P2' }, async ({ app, muul, ui, page }) => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    await muul.on('GET', '/api/entitlements', async () => { await held; return { json: entitlementsFor('pro') } })
    await bootToHome(app)
    const dc = app.dataCenter
    await dc.openFromHeader()
    await expectCards(app, CARDS.both, 'pending')
    await dc.source('Cloud').click()
    await expect(dc.gateHeading).toHaveText('Checking your plan…')
    await expect(dc.dialog.getByRole('button', { name: /^(Sign in|Upgrade to .+)$/ })).toHaveCount(0)
    await expect(dc.sidebarSource('Cloud')).toHaveAccessibleName('Cloud Sync across devices')
    await dc.sidebarSource('Auto Backup').click()
    await expect(ui.cloudSync.heading).toBeVisible()
    await expect(dc.dialog.getByText('Checking your plan…')).toBeVisible()
    await expect(ui.cloudSync.seePlans).toHaveCount(0)
    await dc.close.click()
    await app.header.settings.click()
    await app.settings.openTab('Plan')
    await expect(ui.plan.status).toHaveText('Checking your plan…')

    release()
    await expect(ui.plan.status).toHaveText('Active')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await openSource(app, 'Backup', 'Cloud')
    await expect(dc.dialog.getByRole('heading', { name: 'Backup to Cloud' })).toBeVisible()
  })
})

test.describe('Settings > Plan for paid plans', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  const PRO_ROWS: [string, string, boolean][] = [
    ['Catalog downloads', 'Unlimited', true],
    ['Receive shares and join live classes', 'Included', true],
    ['Send a copy', 'Unlimited, including classes', true],
    ['Live sharing and classes', 'Up to 5 classes', true],
    ['Team members', 'Included', true],
    ['Private notes', 'Included', true],
    ['GitHub backup and restore', 'Included (in MoBrowser)', true],
    ['Scheduled backup', 'To a folder on this device, GitHub, the cloud', true],
    ['Cloud backup and sync', '10 GB', true],
    ['Support', 'Priority replies', true],
  ]
  const ECONOMY_ROWS: [string, string, boolean][] = [
    ['Catalog downloads', 'Unlimited', true],
    ['Receive shares and join live classes', 'Included', true],
    ['Send a copy', 'Up to 10 people', true],
    ['Live sharing and classes', 'Not included', false],
    ['Team members', 'Not included', false],
    ['Private notes', 'Included', true],
    ['GitHub backup and restore', 'Included (in MoBrowser)', true],
    ['Scheduled backup', 'To a folder on this device, GitHub', true],
    ['Cloud backup and sync', 'Not included', false],
    ['Support', 'Email replies', true],
  ]

  async function expectRows(ui: BackupUi, rows: [string, string, boolean][]) {
    for (const [label, value, ok] of rows) await expect(ui.plan.row(label)).toHaveText(`${ok ? '✓' : '–'}${label}${value}`)
  }

  test.use({ muulPlan: 'pro' })
  test('REG-432 Settings > Plan names each paid plan, its state and what it includes, and offers the right button', { tag: '@P2' }, async ({ signedIn: app, ui, muul, page }) => {
    await app.header.settings.click()
    await app.settings.openTab('Plan')
    await expect(ui.plan.name).toHaveText('Pro')
    await expect(ui.plan.status).toHaveText('Active')
    await expect(ui.plan.button).toHaveText('See plans')
    await expect(ui.plan.includesHeading).toHaveText('What Pro includes')
    await expectRows(ui, PRO_ROWS)

    await switchPlan(muul, page, 'enterprise')
    await expect(ui.plan.name).toHaveText('Enterprise')
    await expect(ui.plan.row('Live sharing and classes')).toHaveText('✓Live sharing and classesUnlimited classes')
    await expect(ui.plan.row('Cloud backup and sync')).toHaveText('✓Cloud backup and syncUnlimited storage')
    await expect(ui.plan.row('Support')).toHaveText('✓SupportDedicated support')
    await expect(ui.plan.button).toHaveText('See plans')

    await switchPlan(muul, page, 'pro-grace')
    await expect(ui.plan.name).toHaveText('Pro')
    await expect(ui.plan.status).toHaveText('Payment failed — update billing by Oct 22 to keep your Pro features')

    await switchPlan(muul, page, 'pro-halted')
    await expect(ui.plan.name).toHaveText('Free')
    await expect(ui.plan.status).toHaveText('Payment failed — update billing to restore your Pro features')
    await expect(ui.plan.button).toHaveText('Upgrade')
    await expect(ui.plan.row('Cloud backup and sync')).toHaveText('–Cloud backup and syncNot included')

    await switchPlan(muul, page, 'pro-paused')
    await expect(ui.plan.status).toHaveText('Paused — contact support')

    await switchPlan(muul, page, 'dev')
    await expect(ui.plan.name).toHaveText('Economy')
    await expect(ui.plan.status).toHaveText('Active')
    await expect(ui.plan.includesHeading).toHaveText('What Economy includes')
    await expectRows(ui, ECONOMY_ROWS)
    await stubWww(page, 'products/**')
    await ui.plan.button.filter({ hasText: 'Upgrade to Pro' }).click()
    await page.waitForURL(`${MUUL_WWW}/products/**`)
    expect(page.url()).toBe(PLANS_URL)
  })
})

test.describe('Subscription status banner', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  const CASES: Array<{ plan: PlanScenario; text: string | null; button: string | null }> = [
    { plan: 'pro-grace', text: 'Payment failed — update billing by Oct 22 to keep your Pro features', button: 'Update billing' },
    { plan: 'pro-retrying', text: 'Your last Pro payment did not go through — it will be retried automatically', button: null },
    { plan: 'pro-halted', text: 'Payment failed — update billing to restore your Pro features', button: 'Update billing' },
    { plan: 'pro-paused', text: 'Subscription paused — contact support', button: 'Contact support' },
    { plan: 'pro-cancelled', text: 'Your Pro subscription has ended', button: 'Renew' },
    { plan: 'pro-cancelled-ended', text: 'Your Pro subscription has ended', button: 'Renew' },
    { plan: 'pro-cancelling', text: null, button: null },
    { plan: 'pro', text: null, button: null },
  ]

  test.use({ muulPlan: 'pro' })
  test('REG-433 the status banner names each billing problem with the right action, and stays away when there is none', { tag: '@P2' }, async ({ signedIn: app, ui, muul, page }) => {
    await createProjects(app, ['Banner Project'])
    await expect(ui.banner.bar).toHaveCount(0)
    for (const c of CASES) {
      await switchPlan(muul, page, c.plan)
      if (c.text === null) {
        await expect(ui.banner.bar, c.plan).toHaveCount(0)
        continue
      }
      await expect(ui.banner.bar, c.plan).toHaveText(c.text + (c.button ?? ''))
      await expect(ui.banner.bar.getByRole('button'), c.plan).toHaveCount(c.button ? 1 : 0)
    }
  })

  test.describe('navigation', () => {
    // redirectToCheckout() throws on purpose after setting location.href, so a click on it always logs this.
    test.use({ allowedPageErrors: [/Redirecting to checkout/] })
  test('REG-434 Update billing and Renew open the checkout for the plan, Contact support opens the support page', { tag: '@P2' }, async ({ signedIn: app, ui, muul, page }) => {
    await createProjects(app, ['Billing Project'])
    await stubWww(page, 'checkout**')
    await stubWww(page, 'support')
    const checkout = new RegExp(`^${MUUL_WWW}/checkout\\?product=CognitiveCanvas&tier=pro&billing=monthly&price=1&returnUrl=`)
    for (const [plan, button, target] of [['pro-grace', 'Update billing', checkout], ['pro-cancelled', 'Renew', checkout], ['pro-paused', 'Contact support', `${MUUL_WWW}/support`]] as const) {
      await switchPlan(muul, page, plan)
      const here = page.url()
      await ui.banner.button(button).click()
      await page.waitForURL(`${MUUL_WWW}/**`)
      if (typeof target === 'string') expect(page.url(), plan).toBe(target)
      else {
        expect(page.url(), plan).toMatch(target)
        expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(here)
      }
      await page.goBack()
      await app.home.reach()
    }
  })
  })
})

test.describe('Sign out', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  test('REG-435 Sign out asks first; Cancel keeps the account, Sign out tells the server, clears the session and plan, and keeps the projects', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, muul, ui, page }) => {
    await createProjects(app, ['Stays Local'])
    const projectsBefore = await readStore(page, 'projects')
    await page.evaluate(() => {
      localStorage.setItem('mo_refresh_token', 'e2e-refresh')
      localStorage.setItem('mo_user', '{"email":"automation.user@example.invalid"}')
    })
    const header = ui.signOut.accountButton(`${muul.identity.firstName} ${muul.identity.lastName}`)
    await header.click()
    await ui.signOut.menuItem.click()
    await expect(ui.signOut.dialog).toContainText('Are you sure you want to sign out of your MuulOrigin account? Your projects and data stay on this device, and you can sign back in anytime.')
    await ui.signOut.cancel.click()
    await expect(ui.signOut.dialog).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('mo_token'))).toBe(muul.token)

    await header.click()
    await ui.signOut.menuItem.click()
    const presence = muul.waitForCall('PATCH', '/api/sharing/live/presence')
    const logout = muul.waitForCall('POST', '/api/iam/auth/logout')
    await ui.signOut.confirm.click()
    const p = await presence
    expect(p.postDataJSON()).toEqual({ away: true })
    expect(p.headers()['authorization']).toBe(`Bearer ${muul.token}`)
    expect((await logout).postDataJSON()).toEqual({ refreshToken: 'e2e-refresh' })
    await expect(app.header.profile).toBeVisible()
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^(mo_token|mo_refresh_token|mo_user_profile|mo_user|cc2_subscription_(tier|status|caps|billing))/.test(k)))
    expect(left).toEqual([])
    expect(await readStore(page, 'projects')).toEqual(projectsBefore)
    await openSource(app, 'Backup', 'Cloud')
    await expect(app.dataCenter.gateButton('Sign in')).toBeVisible()
  })
})

test.describe('Local storage allowance', { tag: ['@regression', '@backup', '@plans', '@api'] }, () => {
  test.use({ muulPlan: 'free' })
  test('REG-959 an upload that would go over the plan\'s storage allowance is refused with a message to free space, and nothing is stored', { tag: '@P2' }, async ({ signedIn: app, muul, page }) => {
    // The plan says how much this device may hold (caps.localQuotaBytes, 10 GB on Free). Served as 1 KB here,
    // smaller than any document, so the very next upload goes over it. (A real allowance is whole gigabytes.)
    const tiny = entitlementsFor('free') as { caps: { localQuotaBytes: number } }
    tiny.caps.localQuotaBytes = 1024
    await muul.on('GET', '/api/entitlements', () => ({ json: tiny }))
    const answered = page.waitForResponse((r) => r.url().startsWith(`${MUUL_API}/api/entitlements`))
    await page.evaluate(() => window.dispatchEvent(new Event('cc2:plan-recheck')))
    await answered
    // The app keeps the plan's caps per account, under cc2_subscription_caps:<account>.
    const storedAllowance = () => page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('cc2_subscription_caps:'))
      return key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { localQuotaBytes?: number }).localQuotaBytes : undefined
    })
    await expect.poll(storedAllowance, { message: 'the app took the new allowance' }).toBe(1024)

    await app.home.createProject('Over Allowance')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.toasts.expectShown(/^You've reached your \d+ GB storage limit\. Delete items to free space\.$/)
    await expectStoreCount(page, 'documents', 0)
  })
})
