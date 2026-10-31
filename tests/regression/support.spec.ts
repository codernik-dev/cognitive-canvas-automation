/**
 * Regression: Settings › Support against a STATEFUL MOCKED support API
 * (helpers/mocks/supportBackend.ts on the shared account mock). Tickets,
 * messages and attachments live in the fake, so a ticket filed through the
 * UI can be answered by "staff" and the app's polling picks the answer up.
 * Polls (45 s app-wide, 30 s in an open ticket) are reached with page.clock.
 */
import { readFileSync } from 'node:fs'
import { supportTest as test, expect } from '../../fixtures/content.js'
import { SupportPanel } from '../../pages/ContentSupport.js'
import { AGENT } from '../../helpers/mocks/supportBackend.js'
import { buildTextPdf } from '../../data/builders/pdf.js'
import { buildPng } from '../../data/builders/png.js'
import { IMAGES } from '../../data/files.js'
import { baseURL } from '../../config/env.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

const png = (name: string, seed = 0) => ({ name, mimeType: 'image/png', buffer: buildPng(16 + seed, 16, [200, 40, 40], [40, 40, 200]) })
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: buildTextPdf([{ heading: 'Support attachment', lines: ['SUPPORTPDFMARKER'] }], name) })
const DESCRIPTION = 'Pressing Export does nothing at all on the second document.'
/** Size as the new-ticket form prints it (SupportNewTicket formatBytes). */
const formSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)
/** Size as an attachment card prints it (AttachmentGallery formatBytes). */
const cardSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)

/** Boot by hand (for specs that install the clock or seed tickets first). */
async function boot(app: CognitiveCanvas) {
  await app.open()
  await app.pinSetup.createPin()
  await app.firstRunCatalogShown()
  await app.home.reach()
}

test.describe('Support tickets (stateful mocked API)', { tag: ['@regression', '@support', '@api'] }, () => {
  test('REG-108 create a support ticket and see the staff reply in its conversation', { tag: ['@P2', '@sanity'] }, async ({ signedIn: app, page, support }) => {
    const panel = new SupportPanel(page)
    await panel.open()
    await panel.fillTicket('Export button does nothing', DESCRIPTION)
    await panel.submit.click()
    await app.toasts.expectShown('Support ticket submitted')
    // Submitting lands on My tickets, with the new ticket listed.
    await expect(panel.ticketRow('Export button does nothing')).toBeVisible()
    expect(support.tickets).toHaveLength(1)
    const ticketId = support.tickets[0].ticketId

    support.agentReply(ticketId, 'Thanks! Which browser are you using?')
    await panel.ticketRow('Export button does nothing').click()
    await expect(page.getByRole('heading', { name: 'Export button does nothing' })).toBeVisible()
    await expect(panel.bubbles).toHaveCount(2)
    await expect(panel.bubbles.nth(0)).toContainText('You')
    await expect(panel.bubbles.nth(0)).toContainText(DESCRIPTION)
    await expect(panel.bubbles.nth(1)).toContainText(AGENT.name)
    await expect(panel.bubbles.nth(1)).toContainText('Thanks! Which browser are you using?')
    await expect(page.getByText(`· Assigned to ${AGENT.name}`)).toBeVisible()
  })

  test.describe('signed out', () => {
    test.use({ muulPlan: null })

    test('REG-757 signed out, Support asks to sign in and never calls the support API', { tag: '@P2' }, async ({ signedIn: _app, page, muul }) => {
      const panel = new SupportPanel(page)
      await panel.open()
      await expect(panel.gateTitle).toBeVisible()
      await expect(page.getByText('Support tickets are tied to your MuulOrigin account so we can reply to you and keep your history. Sign in once and come back to this panel.')).toBeVisible()
      await expect(panel.signInLink).toHaveAttribute('href', 'https://www.muulorigin.com/signin')
      await expect(panel.signInLink).toHaveAttribute('target', '_blank')
      await panel.signedInButton.click()
      await expect(page.getByRole('alert').filter({ hasText: 'Still not signed in.' })).toHaveText('Still not signed in. Finish signing in on the MuulOrigin tab, then press this again. If you are signed in there already, reload this page.')
      await expect(panel.newTicketTab).toHaveCount(0)
      expect(muul.callsTo('GET', /^\/api\/support\//)).toEqual([])
      expect(muul.callsTo('POST', /^\/api\/support\//)).toEqual([])
    })
  })

  test('REG-758 subject and description are checked before Submit is allowed', { tag: '@P2' }, async ({ signedIn: _app, page, muul }) => {
    const panel = new SupportPanel(page)
    await panel.open()
    await expect(panel.submit).toBeDisabled()
    await panel.subject.fill('ab')
    await panel.subject.blur()
    await expect(page.getByText('At least 3 characters')).toBeVisible()
    await expect(page.getByText('At least 10 characters')).toBeVisible()
    await panel.description.fill('too short')
    await expect(page.getByText('At least 10 characters')).toBeVisible()
    await expect(panel.submit).toBeDisabled()
    // Spaces do not count.
    await panel.subject.fill('  ab  ')
    await expect(page.getByText('At least 3 characters')).toBeVisible()

    await panel.subject.fill('abc')
    await panel.description.fill('ten chars!')
    await expect(page.getByText('At least 3 characters')).toBeHidden()
    await expect(page.getByText('At least 10 characters')).toBeHidden()
    await expect(panel.submit).toBeEnabled()
    expect(muul.callsTo('POST', '/api/support/tickets')).toEqual([])
  })

  test('REG-759 a new ticket sends its fields, MEDIUM priority, the product and client context, uploads each file, and is listed', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, support, muul }) => {
    const panel = new SupportPanel(page)
    const image = IMAGES.png()
    const doc = pdf('steps-to-reproduce.pdf')
    await panel.open()
    await panel.fillTicket('  Export button does nothing  ', DESCRIPTION)
    await panel.category.selectOption({ label: 'Account access' })
    await panel.chooseFiles(panel.addFiles, [image, doc])
    await expect(panel.stagedFile(image.name)).toContainText(formSize(image.buffer.length))
    await expect(panel.stagedFile(doc.name)).toBeVisible()

    const created = muul.waitForCall('POST', '/api/support/tickets')
    await panel.submit.click()
    const req = await created
    await app.toasts.expectShown('Support ticket submitted', 30_000)

    const body = JSON.parse(req.postData() ?? '{}') as Record<string, string>
    expect(Object.keys(body).sort()).toEqual(['category', 'clientContext', 'description', 'priority', 'product', 'subject'])
    expect(body).toMatchObject({ subject: 'Export button does nothing', description: DESCRIPTION, priority: 'MEDIUM', category: 'ACCESS', product: 'cognitive-canvas' })
    expect(JSON.parse(body.clientContext)).toMatchObject({ appName: 'cognitive-canvas', url: `${baseURL}/`, online: true, timezone: 'UTC' })
    expect(req.headers()['authorization']).toBe(`Bearer ${muul.token}`)

    const ticketId = support.tickets[0].ticketId
    expect(support.uploads.map((u) => [u.ticketId, u.fileName, u.contentType, u.messageId])).toEqual([
      [ticketId, image.name, 'image/png', null],
      [ticketId, doc.name, 'application/pdf', null],
    ])
    expect(support.uploads[0].bytes.equals(image.buffer)).toBe(true)
    expect(support.uploads[1].bytes.equals(doc.buffer)).toBe(true)

    await expect(panel.ticketRow('Export button does nothing')).toContainText('Open')
    await expect(panel.ticketRow('Export button does nothing')).toContainText('Med')
    // The form starts empty again.
    await panel.newTicketTab.click()
    await expect(panel.subject).toHaveValue('')
    await expect(panel.description).toHaveValue('')
    await expect(panel.category).toHaveValue('APPLICATION')
    await expect(panel.stagedFile(image.name)).toHaveCount(0)
  })

  test('REG-760 attachments of the wrong type, renamed files, oversize files, duplicates and a sixth file are refused with a message', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const panel = new SupportPanel(page)
    await panel.open()
    await panel.chooseFiles(panel.addFiles, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain notes') }])
    await app.toasts.expectShown('"notes.txt" can\'t be attached — that file type is not accepted — images, PDF, video (MP4, WEBM, MOV) or ZIP.')
    await panel.chooseFiles(panel.addFiles, [{ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('hello, I am text') }])
    await app.toasts.expectShown('"fake.png" can\'t be attached — its contents don’t match its type.')
    await panel.chooseFiles(panel.addFiles, [{ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25) }])
    await app.toasts.expectShown('"huge.pdf" can\'t be attached — it is over the 10 MB limit for this file type.')
    await expect(page.locator('li').filter({ hasText: /notes\.txt|fake\.png|huge\.pdf/ })).toHaveCount(0)

    await panel.chooseFiles(panel.addFiles, [png('shot-1.png', 1)])
    await panel.chooseFiles(panel.addFiles, [png('shot-1.png', 1)])
    await app.toasts.expectShown('"shot-1.png" is already attached.')
    await expect(panel.stagedFile('shot-1.png')).toHaveCount(1)

    await panel.chooseFiles(panel.addFiles, [png('shot-2.png', 2), png('shot-3.png', 3), png('shot-4.png', 4), png('shot-5.png', 5), png('shot-6.png', 6)])
    await app.toasts.expectShown('At most 5 files per ticket — 1 not added.')
    await expect(page.getByText('Limit of 5 files reached')).toBeVisible()
    await expect(panel.addFiles).toBeDisabled()
    await expect(panel.stagedFile('shot-6.png')).toHaveCount(0)

    await panel.removeFile('shot-3.png').click()
    await expect(panel.stagedFile('shot-3.png')).toHaveCount(0)
    await expect(panel.addFiles).toBeEnabled()
    await expect(page.getByText('or drop them here')).toBeVisible()
  })

  test('REG-761 while a file uploads, a progress bar names it and the form says Submitting', { tag: '@P3' }, async ({ signedIn: app, page, support }) => {
    const panel = new SupportPanel(page)
    const doc = pdf('screen-recording-notes.pdf')
    await panel.open()
    await panel.fillTicket('Upload progress check', DESCRIPTION)
    await panel.chooseFiles(panel.addFiles, [doc])
    const release = support.hold('upload')
    await panel.submit.click()
    await expect(panel.progress).toHaveText(`Uploading ${doc.name}`)
    await expect(page.getByText('Large files take a while — keep this open until it finishes.')).toBeVisible()
    await expect(panel.submit).toHaveText('Submitting…')
    await expect(panel.submit).toBeDisabled()
    release()
    await app.toasts.expectShown('Support ticket submitted', 30_000)
    await expect(panel.progress).toHaveCount(0)
    expect(support.uploads).toHaveLength(1)
  })

  test('REG-762 an attachment the server refuses keeps the ticket and names the file and the reason', { tag: '@P2' }, async ({ signedIn: app, page, support }) => {
    const panel = new SupportPanel(page)
    const image = IMAGES.png()
    await panel.open()
    await panel.fillTicket('Refused attachment', DESCRIPTION)
    await panel.chooseFiles(panel.addFiles, [image])
    support.failNext('upload', { status: 415, json: { message: 'PNG files are not accepted on this plan' } })
    await panel.submit.click()
    await app.toasts.expectShown(`Ticket created. Not attached: ${image.name} — PNG files are not accepted on this plan`, 30_000)
    expect(support.tickets.map((t) => t.subject)).toEqual(['Refused attachment'])
    expect(support.uploads).toHaveLength(0)
    await expect(panel.ticketRow('Refused attachment')).toBeVisible()
  })

  test('REG-763 a ticket the server rejects shows its message and keeps everything typed', { tag: '@P2' }, async ({ signedIn: app, page, support }) => {
    const panel = new SupportPanel(page)
    await panel.open()
    await panel.fillTicket('Rejected ticket', DESCRIPTION)
    await panel.chooseFiles(panel.addFiles, [IMAGES.png()])
    support.failNext('create', { status: 400, json: { message: 'Subject contains blocked words' } })
    await panel.submit.click()
    await app.toasts.expectShown('Subject contains blocked words')
    await expect(panel.subject).toHaveValue('Rejected ticket')
    await expect(panel.description).toHaveValue(DESCRIPTION)
    await expect(panel.stagedFile(IMAGES.png().name)).toBeVisible()
    await expect(panel.submit).toHaveText('Submit ticket')
    expect(support.tickets).toHaveLength(0)
    expect(support.uploads).toHaveLength(0)
  })

  test('REG-764 a draft survives a visit to My tickets and back, and is gone after a reload', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const panel = new SupportPanel(page)
    await panel.open()
    await panel.fillTicket('Half-written ticket', DESCRIPTION)
    await panel.category.selectOption({ label: 'Payment / billing' })
    await panel.chooseFiles(panel.addFiles, [IMAGES.png()])
    await panel.myTicketsTab.click()
    await expect(page.getByText('No tickets yet')).toBeVisible()
    await panel.newTicketTab.click()
    await expect(panel.subject).toHaveValue('Half-written ticket')
    await expect(panel.description).toHaveValue(DESCRIPTION)
    await expect(panel.category).toHaveValue('PAYMENT')
    await expect(panel.stagedFile(IMAGES.png().name)).toBeVisible()

    await app.reload()
    await panel.open()
    await panel.newTicketTab.click()
    await expect(panel.subject).toHaveValue('')
    await expect(panel.description).toHaveValue('')
    await expect(panel.stagedFile(IMAGES.png().name)).toHaveCount(0)
  })

  test('REG-765 My tickets shows an empty state, recovers from a load error, filters by status and sorts', { tag: '@P2' }, async ({ signedIn: _app, page, support }) => {
    const panel = new SupportPanel(page)
    await panel.open()
    await panel.myTicketsTab.click()
    await expect(page.getByText('No tickets yet')).toBeVisible()
    await expect(page.getByText("When you submit one, it'll show up here.")).toBeVisible()

    support.seed({ subject: 'Alpha printer issue', status: 'OPEN', createdAtUtc: '2026-10-01T10:00:00.000Z', updatedAtUtc: '2026-10-01T10:00:00.000Z' })
    support.seed({ subject: 'Beta export bug', status: 'RESOLVED', priority: 'HIGH', createdAtUtc: '2026-10-02T10:00:00.000Z', updatedAtUtc: '2026-10-05T10:00:00.000Z' })
    support.seed({ subject: 'Gamma login loop', status: 'CLOSED', priority: 'LOW', createdAtUtc: '2026-10-03T10:00:00.000Z', updatedAtUtc: '2026-10-03T10:00:00.000Z' })
    support.failNext('list', { status: 403, json: { message: 'Support is paused for this account' } })
    await panel.newTicketTab.click()
    await panel.myTicketsTab.click()
    await expect(page.getByText("Couldn't load your tickets")).toBeVisible()
    await expect(page.getByText('Support is paused for this account')).toBeVisible()
    await panel.tryAgain.click()

    await expect(panel.listedSubjects).toHaveText(['Beta export bug', 'Gamma login loop', 'Alpha printer issue'])
    await expect(panel.ticketRow('Beta export bug')).toContainText('Resolved')
    await expect(panel.ticketRow('Beta export bug')).toContainText('High')
    await expect(panel.ticketRow('Gamma login loop')).toContainText('Closed')
    await expect(panel.ticketRow('Gamma login loop')).toContainText('Low')
    await expect(panel.ticketRow('Alpha printer issue')).toContainText('Oct 1, 2026')

    await panel.sortOrder.selectOption({ label: 'Oldest' })
    await expect(panel.listedSubjects).toHaveText(['Alpha printer issue', 'Gamma login loop', 'Beta export bug'])
    await panel.sortOrder.selectOption({ label: 'Z–A' })
    await expect(panel.listedSubjects).toHaveText(['Gamma login loop', 'Beta export bug', 'Alpha printer issue'])
    await panel.sortOrder.selectOption({ label: 'A–Z' })
    await expect(panel.listedSubjects).toHaveText(['Alpha printer issue', 'Beta export bug', 'Gamma login loop'])

    await panel.statusFilter.selectOption({ label: 'Resolved' })
    await expect(panel.listedSubjects).toHaveText(['Beta export bug'])
    await panel.statusFilter.selectOption({ label: 'In progress' })
    await expect(page.getByText('No tickets match this filter.')).toBeVisible()
    await panel.statusFilter.selectOption({ label: 'All status' })
    await expect(panel.listedSubjects).toHaveCount(3)
  })

  test('REG-766 a ticket opens on its conversation: description first, then replies, with status, priority and assignee', { tag: '@P2' }, async ({ signedIn: _app, page, support }) => {
    const panel = new SupportPanel(page)
    const t = support.seed({ subject: 'Sync stopped', description: 'My second laptop stopped syncing.', status: 'OPEN', priority: 'HIGH', createdAtUtc: '2026-10-01T10:00:00.000Z' })
    support.agentReply(t.ticketId, 'Can you send a screenshot of Settings?')
    support.seed({ subject: 'Quiet ticket', createdAtUtc: '2026-10-02T10:00:00.000Z' })
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.ticketRow('Sync stopped').click()

    await expect(page.getByRole('heading', { name: 'Sync stopped' })).toBeVisible()
    await expect(page.getByText('In progress', { exact: true })).toBeVisible()
    await expect(page.getByText('High', { exact: true })).toBeVisible()
    await expect(page.getByText(`Opened Oct 1, 2026, 10:00 AM · Assigned to ${AGENT.name}`)).toBeVisible()
    await expect(panel.bubbles).toHaveCount(2)
    await expect(panel.bubbles.nth(0)).toContainText('You')
    await expect(panel.bubbles.nth(0)).toContainText('My second laptop stopped syncing.')
    await expect(panel.bubbles.nth(1)).toContainText(AGENT.name)
    await expect(page.getByText('No replies yet. An agent will respond here.')).toHaveCount(0)

    await panel.backToTickets.click()
    await panel.ticketRow('Quiet ticket').click()
    await expect(page.getByText('No replies yet. An agent will respond here.')).toBeVisible()
    await expect(page.getByText(/^Opened Oct 2, 2026/)).toBeVisible()
  })

  test('REG-767 a reply is posted and shown, Ctrl+Enter sends too, and a file sent with a reply is attached to that message', { tag: '@P2' }, async ({ signedIn: _app, page, support, muul }) => {
    const panel = new SupportPanel(page)
    const t = support.seed({ subject: 'Reply flow' })
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.ticketRow('Reply flow').click()
    await expect(panel.send).toBeDisabled()

    const posted = muul.waitForCall('POST', `/api/support/tickets/${t.ticketId}/messages`)
    await panel.reply.fill('Here is more detail about the problem.')
    await panel.send.click()
    expect(JSON.parse((await posted).postData() ?? '{}')).toEqual({ body: 'Here is more detail about the problem.' })
    await expect(panel.bubbles).toHaveCount(2)
    await expect(panel.bubbles.nth(1)).toContainText('Here is more detail about the problem.')
    await expect(panel.reply).toHaveValue('')

    await panel.reply.fill('Sent with the keyboard.')
    await panel.reply.press('Control+Enter')
    await expect(panel.bubbles).toHaveCount(3)
    await expect(panel.bubbles.nth(2)).toContainText('Sent with the keyboard.')

    const shot = png('reply-shot.png', 7)
    await panel.chooseFiles(panel.attach, [shot])
    await expect(panel.stagedFile(shot.name)).toBeVisible()
    await panel.reply.fill('Screenshot attached.')
    await panel.send.click()
    await expect(page.getByRole('button', { name: shot.name })).toBeVisible()
    const reply = support.ticket(t.ticketId).messages.find((m) => m.body === 'Screenshot attached.')!
    expect(support.uploads.map((u) => [u.fileName, u.messageId])).toEqual([[shot.name, reply.messageId]])
    expect(support.ticket(t.ticketId).messages.map((m) => m.authorKind)).toEqual(['USER', 'USER', 'USER'])
  })

  test.describe('polling', () => {
    test.use({ withClock: true })

    test('REG-768 a staff reply raises a "New reply" toast and unread badges, and opening the ticket clears them', { tag: ['@P1', '@sanity'] }, async ({ app, page, support }) => {
      const panel = new SupportPanel(page)
      const t = support.seed({ subject: 'Printer jams' })
      await boot(app)
      support.agentReply(t.ticketId, 'We pushed a fix, please update.')
      await page.clock.fastForward(45_000)
      await app.toasts.expectShown('New reply on “Printer jams”')
      await expect(page.getByRole('button', { name: 'Settings — new support reply' })).toBeVisible()

      await panel.open()
      await expect(panel.settingsTab).toHaveText(/Support\s*1/)
      await expect(panel.myTicketsTab).toHaveText(/My tickets\s*1/)
      await panel.myTicketsTab.click()
      await expect(panel.ticketRow('Printer jams').getByLabel('New reply')).toBeVisible()
      await expect(panel.ticketRow('Printer jams')).toContainText('· New')

      await panel.ticketRow('Printer jams').click()
      await expect(panel.bubbles.last()).toContainText('We pushed a fix, please update.')
      await panel.backToTickets.click()
      await expect(panel.ticketRow('Printer jams').getByLabel('New reply')).toHaveCount(0)
      await expect(panel.myTicketsTab).toHaveText('My tickets')
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
      const seen = JSON.parse((await page.evaluate(() => localStorage.getItem('cc2_support_seen_v1'))) ?? '{}') as Record<string, string>
      expect(seen[t.ticketId]).toBe(support.ticket(t.ticketId).updatedAtUtc)
    })

    test('REG-769 an open conversation picks up a staff reply on its 30-second refresh', { tag: '@P2' }, async ({ app, page, support, muul }) => {
      const panel = new SupportPanel(page)
      const t = support.seed({ subject: 'Live conversation' })
      await boot(app)
      await panel.open()
      await panel.myTicketsTab.click()
      await panel.ticketRow('Live conversation').click()
      await expect(panel.bubbles).toHaveCount(1)
      const detailCalls = muul.callsTo('GET', `/api/support/tickets/${t.ticketId}`).length

      support.agentReply(t.ticketId, 'Looking into it now.')
      await page.clock.fastForward(30_000)
      await expect(panel.bubbles).toHaveCount(2)
      await expect(panel.bubbles.nth(1)).toContainText('Looking into it now.')
      expect(muul.callsTo('GET', `/api/support/tickets/${t.ticketId}`).length).toBeGreaterThan(detailCalls)
    })
  })

  test('REG-770 a closed ticket cannot be replied to, while a resolved one still can', { tag: '@P2' }, async ({ signedIn: _app, page, support }) => {
    const panel = new SupportPanel(page)
    support.seed({ subject: 'Closed one', status: 'CLOSED' })
    support.seed({ subject: 'Resolved one', status: 'RESOLVED' })
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.ticketRow('Closed one').click()
    await expect(page.getByText('This ticket is closed. Open a new ticket if you need further help.')).toBeVisible()
    await expect(panel.reply).toHaveCount(0)
    await expect(panel.attach).toHaveCount(0)
    await panel.backToTickets.click()
    await panel.ticketRow('Resolved one').click()
    await expect(panel.reply).toBeVisible()
    await expect(page.getByText('This ticket is closed. Open a new ticket if you need further help.')).toHaveCount(0)
  })

  test('REG-771 a ticket that cannot be loaded says so; Try again loads it and Back returns to the list', { tag: '@P3' }, async ({ signedIn: _app, page, support }) => {
    const panel = new SupportPanel(page)
    support.seed({ subject: 'Flaky ticket' })
    await panel.open()
    await panel.myTicketsTab.click()
    support.failNext('detail', { status: 404, json: { message: 'Ticket not found' } })
    await panel.ticketRow('Flaky ticket').click()
    await expect(page.getByText("Couldn't load ticket")).toBeVisible()
    await expect(page.getByText('Ticket not found')).toBeVisible()
    await panel.tryAgain.click()
    await expect(page.getByRole('heading', { name: 'Flaky ticket' })).toBeVisible()

    await panel.backToTickets.click()
    support.failNext('detail', { status: 404, json: { message: 'Ticket not found' } })
    await panel.ticketRow('Flaky ticket').click()
    await expect(page.getByText("Couldn't load ticket")).toBeVisible()
    // The error's own Back (Settings has an icon-only "Back" too).
    await page.getByRole('button', { name: 'Back', exact: true }).filter({ hasText: 'Back' }).click()
    await expect(panel.ticketRow('Flaky ticket')).toBeVisible()
  })

  test('REG-772 a reply the server rejects shows its message and keeps the text', { tag: '@P3' }, async ({ signedIn: app, page, support }) => {
    const panel = new SupportPanel(page)
    const t = support.seed({ subject: 'Locked ticket' })
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.ticketRow('Locked ticket').click()
    support.failNext('reply', { status: 409, json: { message: 'This ticket is locked' } })
    await panel.reply.fill('Please reopen it.')
    await panel.send.click()
    await app.toasts.expectShown('This ticket is locked')
    await expect(panel.reply).toHaveValue('Please reopen it.')
    await expect(panel.send).toHaveText('Send')
    expect(support.ticket(t.ticketId).messages).toHaveLength(0)
  })

  test('REG-774 files dropped on the attachments area are checked and attached like picked ones', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const panel = new SupportPanel(page)
    await panel.open()
    // Playwright cannot drag a file in from the operating system, so the drop is
    // emulated: real File objects in a DataTransfer, dispatched as dragover + drop.
    const drop = (files: { name: string; type: string; b64: string }[]) => page.evaluateHandle((list) => {
      const dt = new DataTransfer()
      for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
      return dt
    }, files)
    const shot = png('dropped.png', 9)
    const dataTransfer = await drop([
      { name: shot.name, type: shot.mimeType, b64: shot.buffer.toString('base64') },
      { name: 'dropped.txt', type: 'text/plain', b64: Buffer.from('not allowed').toString('base64') },
    ])
    await panel.dropZone.dispatchEvent('dragover', { dataTransfer })
    await expect(page.getByText('Drop to attach')).toBeVisible()
    await panel.dropZone.dispatchEvent('drop', { dataTransfer })
    await expect(panel.stagedFile(shot.name)).toBeVisible()
    await app.toasts.expectShown('"dropped.txt" can\'t be attached — that file type is not accepted — images, PDF, video (MP4, WEBM, MOV) or ZIP.')
    await expect(panel.stagedFile('dropped.txt')).toHaveCount(0)
    await expect(page.getByText('or drop them here')).toBeVisible()
  })

  test('REG-775 a files-only reply groups its files in one bubble, and the attach button stops at five files per ticket', { tag: '@P3' }, async ({ signedIn: _app, page, support }) => {
    const panel = new SupportPanel(page)
    const t = support.seed({ subject: 'Files only' })
    for (let i = 1; i <= 3; i++) support.addTicketFile(t.ticketId, `earlier-${i}.png`, 'image/png', buildPng(20 + i, 20, [90, 90, 90], [200, 200, 200]))
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.ticketRow('Files only').click()
    // Description + one bubble per earlier file (no record of how they were sent).
    await expect(panel.bubbles).toHaveCount(4)
    await expect(panel.attach).toHaveAttribute('title', 'Attach images, videos, or files')

    await panel.chooseFiles(panel.attach, [png('new-a.png', 11), png('new-b.png', 12)])
    await expect(panel.attach).toBeDisabled()
    await expect(panel.attach).toHaveAttribute('title', 'Max 5 files per ticket')
    await expect(panel.reply).toHaveAttribute('placeholder', 'Write a reply…')
    await expect(panel.send).toBeEnabled()
    await panel.send.click()

    // The two files of this one Send share a bubble.
    await expect(panel.bubbles).toHaveCount(5)
    await expect(panel.bubbles.last().getByRole('button')).toHaveCount(2)
    expect(support.uploads.map((u) => [u.fileName, u.messageId])).toEqual([['new-a.png', null], ['new-b.png', null]])
    expect(support.ticket(t.ticketId).messages).toHaveLength(0)
    await expect(panel.attach).toBeDisabled()
  })

  test('REG-793 a reply file lost by the network is retried once, then kept in the composer so Send can try again', { tag: '@P3' }, async ({ signedIn: app, page, support }) => {
    const panel = new SupportPanel(page)
    const t = support.seed({ subject: 'Dropped upload' })
    const shot = png('flaky.png', 13)
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.ticketRow('Dropped upload').click()
    await panel.chooseFiles(panel.attach, [shot])
    await panel.reply.fill('With a screenshot')
    support.dropUploads(2)
    await panel.send.click()
    await app.toasts.expectShown('Reply sent. Not attached: flaky.png — the connection dropped during upload. It is still attached below — press Send to try again.', 30_000)
    // The words went; the file stayed for another try.
    expect(support.droppedUploads).toBe(2)
    expect(support.ticket(t.ticketId).messages.map((m) => m.body)).toEqual(['With a screenshot'])
    await expect(panel.reply).toHaveValue('')
    await expect(panel.stagedFile(shot.name)).toBeVisible()
    expect(support.uploads).toHaveLength(0)

    await panel.send.click()
    await expect(panel.stagedFile(shot.name)).toHaveCount(0)
    await expect(page.getByRole('button', { name: shot.name })).toBeVisible()
    expect(support.uploads.map((u) => [u.fileName, u.messageId])).toEqual([[shot.name, null]])
    expect(support.uploads[0].bytes.equals(shot.buffer)).toBe(true)
  })

  test('REG-773 images in a reply open in a full-screen viewer with Previous and Next, and a PDF card downloads under its own name', { tag: '@P3' }, async ({ signedIn: _app, page, support }) => {
    const panel = new SupportPanel(page)
    const report = buildTextPdf([{ heading: 'Diagnostics', lines: ['REPORTMARKER'] }], 'report')
    const t = support.seed({ subject: 'Gallery ticket' })
    support.agentReply(t.ticketId, 'Here are the screenshots and the report.', [
      { fileName: 'before.png', contentType: 'image/png', bytes: buildPng(40, 30, [10, 160, 10], [250, 250, 250]) },
      { fileName: 'after.png', contentType: 'image/png', bytes: buildPng(40, 30, [10, 10, 160], [250, 250, 250]) },
      { fileName: 'report.pdf', contentType: 'application/pdf', bytes: report },
    ])
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.ticketRow('Gallery ticket').click()
    await expect(page.getByText('2 photos')).toBeVisible()
    const before = page.getByRole('button', { name: 'before.png' })
    await expect(before.locator('img')).toHaveJSProperty('complete', true)
    expect(await before.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40)

    await before.click()
    await expect(page.getByText('1 / 2')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText('2 / 2')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByText('1 / 2')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('1 / 2')).toHaveCount(0)

    const card = page.getByRole('link', { name: /report\.pdf/ })
    await expect(card).toContainText(`PDF · ${cardSize(report.length)}`)
    const download = page.waitForEvent('download')
    await card.click()
    const file = await download
    expect(file.suggestedFilename()).toBe('report.pdf')
    expect(readFileSync(await file.path()).equals(report)).toBe(true)
  })
})
