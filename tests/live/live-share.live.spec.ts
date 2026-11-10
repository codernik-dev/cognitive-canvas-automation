/**
 * LIVE sharing, live shares: the build under test against the REAL MuulOrigin
 * sharing service, with real accounts (fixtures/liveSharing.ts). The teacher
 * goes live; from then on every change is pushed by the teacher's app and
 * pulled by each student's app on its own (it checks every 3 s), as in a class.
 *
 * A live copy keeps the teacher's record ids (only the project id is the
 * student's own), so after each change the student's rows must equal the
 * teacher's, field by field, binaries by SHA-256 (helpers/shareFidelity.ts).
 *
 * Opt-in: `npm run live` with CC_LIVE_EMAIL / CC_LIVE_PASSWORD (the teacher)
 * and CC_LIVE_STUDENTS / CC_LIVE_STUDENT_PASSWORD (the students) set. Every
 * live share, class and received note a test creates is removed afterwards.
 */
import type { Page } from '@playwright/test'
import { test, expect, bootLive, type StudentDevice } from '../../fixtures/liveSharing.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { LiveApi, pageGet, type LiveShareRow } from '../../helpers/live/sharingApi.js'
import { knownDefect } from '../../helpers/defects.js'
import { SharingScreen, LiveHeader, AddPeopleDialog } from '../../pages/SharingScreen.js'
import { documentDigests, projectRows } from '../../helpers/sharingFlows.js'
import { readStore } from '../../helpers/idb.js'
import { snapshotDb, RESTORED_STORES } from '../../helpers/backupState.js'
import { expectSameAsSent } from '../../helpers/shareFidelity.js'
import { addEveryKindOfContent, settle } from '../../workflows/richContent.js'
import { ARRIVAL, arrived, createClass, goLive, sendLive, shareToClass, workspaceWithPdf } from '../../workflows/liveSharing.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'

/** The student's live copy holds exactly the teacher's project now: same rows, same ids, the project id mapped. */
async function expectInSync(teacherPage: Page, student: StudentDevice, teacherProjectId: string, copyId: string, label: string, timeout = ARRIVAL) {
  const sent = await snapshotDb(teacherPage, RESTORED_STORES)
  await expect(async () => expectSameAsSent(await snapshotDb(student.page, RESTORED_STORES), sent, { [teacherProjectId]: copyId }, label))
    .toPass({ timeout, intervals: [3_000, 5_000, 10_000] })
}

/** The teacher's live shares of `title`, as the server lists them. */
const liveShares = async (page: Page, title: string) => (await pageGet<{ items: LiveShareRow[] }>(page, '/api/sharing/live/mine')).items.filter((s) => s.title === title)

/**
 * How long a poll of that list may take. The real server spends about 0.9 s per live share the account
 * has ever made (DEF-516: 42 s at 45 on 2026-11-09, and every run adds more), so a single read outlasted
 * the 30 s these polls used to allow and they failed without ever getting an answer.
 */
const SERVER_LIST = 180_000

const teacherProjectId = async (page: Page, name: string) => (await projectRows(page)).find((p) => p.name === name)!.id

/** In the open workspace: a note written on the canvas and a highlight on page 1, saved. */
async function noteAndHighlight(app: CognitiveCanvas, text: string, existing = { workspaceItems: 0, highlights: 0 }) {
  const note = (await app.canvas.place('note', 0.4, 0.3 + existing.workspaceItems * 0.1))!
  await app.canvas.writeNote(note, text)
  await app.viewer.tool('highlight').click()
  await app.viewer.dragOnPage(1, [0.12, 0.3 + existing.highlights * 0.05], [0.7, 0.3 + existing.highlights * 0.05])
  await settle(app.page, { workspaceItems: existing.workspaceItems + 1, highlights: existing.highlights + 1 })
}

/** The student's notes in their copy, by text. */
const studentNotes = async (student: StudentDevice, projectId: string) =>
  (await readStore<{ type: string; projectId: string; data: { content?: string } }>(student.page, 'workspaceItems'))
    .filter((i) => i.type === 'note' && i.projectId === projectId).map((n) => n.data.content ?? '')

/** POSTs of live pushes the page sends, timestamped, from now on. */
function countPushes(page: Page) {
  const at: number[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/sharing\/live\/[^/]+\/push$/.test(new URL(r.url()).pathname)) at.push(Date.now()) })
  return at
}

test.describe('Live: live shares on the real server', { tag: ['@live', '@sharing', '@live-share'] }, () => {
  // DEF-311: the note editor now and then throws React error 185 while a note is written (tracked by REG-336).
  // It is not what these tests are about, so it does not fail them; each occurrence is recorded on the test.
  test.use({ allowedPageErrors: [/Minified React error #185/] })
  test.beforeEach(({ page }, testInfo) => {
    page.on('pageerror', (e) => { if (/Minified React error #185/.test(e.message)) testInfo.annotations.push({ type: 'DEF-311 seen', description: e.message.slice(0, 160) }) })
  })

  test('REG-930 going live delivers the project to the student as a live copy: same document and bytes, a Live badge from the teacher, and the server lists them as its recipient', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Live ${nameTag}`
    await workspaceWithPdf(app, name)
    const [teacherDoc] = await documentDigests(page)

    await goLive(app, [student])
    const [share] = await liveShares(page, name)
    expect(share.recipientIds).toEqual([student.userId])

    const copy = await arrived(student, name)
    expect(copy).toMatchObject({ sourceProjectId: await teacherProjectId(page, name), liveShareId: expect.any(String) })
    const [doc] = (await documentDigests(student.page)).filter((d) => d.projectId === copy.id)
    expect(doc).toMatchObject({ id: teacherDoc.id, name: teacherDoc.name, sha256: teacherDoc.sha256 })

    await student.app.home.openProject(name)
    const badge = new LiveHeader(student.page).subscriptionBadge
    await expect(badge).toHaveText('Live', { timeout: 30_000 })
    await expect(badge).toHaveAttribute('title', `Kept up to date by ${teacher.name}`)
    const screen = new SharingScreen(student.page)
    await screen.open(student.name)
    const card = screen.receivedCard(name)
    await expect(card).toContainText(`from ${teacher.name}`)
    await expect(card).toContainText('Live ·')
  })

  test('REG-931 after going live, the teacher\'s note and highlight reach the student\'s copy by themselves, identical', { tag: '@P1' }, async ({ app, page, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Notes ${nameTag}`
    await workspaceWithPdf(app, name)
    await goLive(app, [student])
    const copy = await arrived(student, name)

    await noteAndHighlight(app, `Teacher note ${nameTag}`)
    await expectInSync(page, student, await teacherProjectId(page, name), copy.id, 'after the teacher\'s note and highlight')
    expect(await studentNotes(student, copy.id)).toEqual([expect.stringContaining(`Teacher note ${nameTag}`)])
  })

  test('REG-932 every kind of content the teacher makes while live reaches the student identical: notes, text box, links, ink, line, highlights, image, audio, video and two new documents', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    // Twelve kinds of content, each pushed live, including two media files and two more documents.
    test.setTimeout(900_000)
    const [student] = await students(1)
    await bootLive(app)
    const name = `Everything ${nameTag}`
    await workspaceWithPdf(app, name)
    await app.header.home.click()
    // A whole-project share, so the documents added below join it on their own.
    await sendLive(app, teacher.name, [student])
    const copy = await arrived(student, name)

    await app.home.reach()
    await app.home.openProject(name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await addEveryKindOfContent(app, page, name)
    await expectInSync(page, student, await teacherProjectId(page, name), copy.id, 'after every kind of content', 300_000)
  })

  test('REG-933 a document the teacher adds to a whole-project live share joins the student\'s copy on its own, and Push now from Shares sends the latest', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Growing ${nameTag}`
    await workspaceWithPdf(app, name)
    await app.header.home.click()
    await sendLive(app, teacher.name, [student])
    const copy = await arrived(student, name)

    await app.home.reach()
    await app.home.openProject(name)
    await app.documents.uploadFiles(SECOND_PDF.payload())
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    const second = (await documentDigests(page)).find((d) => d.name === SECOND_PDF.displayName)!
    await expect.poll(async () => (await documentDigests(student.page)).find((d) => d.id === second.id)?.sha256, { timeout: ARRIVAL, message: 'the new document reached the student' }).toBe(second.sha256)
    expect((await documentDigests(student.page)).filter((d) => d.projectId === copy.id)).toHaveLength(2)

    // Push now, from the share's detail panel.
    await app.header.home.click()
    const screen = new SharingScreen(page)
    await screen.open(teacher.name)
    await screen.tab('Shares').click()
    await screen.shareCard(name).click()
    await screen.detail.getByRole('button', { name: 'Push now' }).click()
    await app.toasts.expectShown('Your latest changes are on their way')
    await expectInSync(page, student, await teacherProjectId(page, name), copy.id, 'after Push now')
  })

  test('REG-939 after a document is added to a live project and Push now is pressed, with nothing else changed, the teacher\'s app sends no further push', { tag: '@P2' }, async ({ app, page, teacher, students, nameTag }, testInfo) => {
    knownDefect('DEF-510')
    const [student] = await students(1)
    await bootLive(app)
    const name = `Quiet ${nameTag}`
    await workspaceWithPdf(app, name)
    await app.header.home.click()
    await sendLive(app, teacher.name, [student])
    await arrived(student, name)
    // The condition the loop needs: the live project gained a document (with none added, Push now sends once).
    await app.home.reach()
    await app.home.openProject(name)
    await app.documents.uploadFiles(SECOND_PDF.payload())
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    await expect.poll(async () => (await documentDigests(student.page)).length, { timeout: ARRIVAL, message: 'the new document reached the student' }).toBe(2)

    await app.header.home.click()
    const screen = new SharingScreen(page)
    await screen.open(teacher.name)
    await screen.tab('Shares').click()
    await screen.shareCard(name).click()
    const pushes = countPushes(page)
    await screen.detail.getByRole('button', { name: 'Push now' }).click()
    await app.toasts.expectShown('Your latest changes are on their way')
    // Push now sends once. Then nothing changes: 45 s here, and 45 s back on Home, must send nothing more.
    await expect.poll(() => pushes.length, { timeout: 30_000, message: 'Push now sent' }).toBe(1)
    await page.waitForTimeout(45_000)
    await app.home.reach()
    await page.waitForTimeout(45_000)
    const start = pushes[0]
    testInfo.annotations.push({ type: 'pushes', description: pushes.map((t) => `+${Math.round((t - start) / 1000)}s`).join(' ') })
    expect(pushes.length - 1, 'pushes in 90 s with no change after Push now').toBe(0)
  })

  test('REG-934 the teacher stops the live share from the header: the student keeps the copy exactly as it is, is told, and the server marks it stopped', { tag: '@P1' }, async ({ app, page, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Stopping ${nameTag}`
    await workspaceWithPdf(app, name)
    await goLive(app, [student])
    const copy = await arrived(student, name)
    const kept = await documentDigests(student.page)

    const header = new LiveHeader(page)
    await header.livePill.click()
    await expect(header.panelHeading).toBeVisible()
    await header.stopLive.click()
    await app.toasts.expectShown('Stopped — recipients no longer receive updates', 60_000)
    await expect(header.shareButton).toBeVisible()
    // The server keeps a stopped share as history: listed, marked stopped.
    await expect.poll(async () => (await liveShares(page, name)).map((sh) => sh.stopped), { timeout: SERVER_LIST, message: 'stopped on the server' }).toEqual([true])

    const screen = new SharingScreen(student.page)
    await screen.open(student.name)
    await expect(screen.receivedCard(name)).toContainText('Stopped · you keep your copy', { timeout: ARRIVAL })
    expect((await projectRows(student.page)).map((p) => p.id)).toContain(copy.id)
    expect(await documentDigests(student.page)).toEqual(kept)
  })

  test('REG-935 the student stops receiving: their copy stays, and the teacher\'s next note no longer reaches it', { tag: '@P2' }, async ({ app, page, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Leaving ${nameTag}`
    await workspaceWithPdf(app, name)
    await goLive(app, [student])
    const copy = await arrived(student, name)

    const screen = new SharingScreen(student.page)
    await screen.open(student.name)
    const card = screen.receivedCard(name)
    let message = ''
    student.page.once('dialog', (d) => { message = d.message(); void d.accept() })
    await screen.menu(card, 'Stop receiving updates…')
    await expect.poll(() => message).toBe(`Stop receiving updates for “${name}”?\n\nYour copy stays as it is; it just won't change again.`)
    await student.app.toasts.expectShown(`You no longer receive updates for “${name}”`, 30_000)
    await expect.poll(async () => (await liveShares(page, name))[0]?.recipientIds ?? [], { timeout: SERVER_LIST, message: 'the server dropped the student' }).toEqual([])

    await noteAndHighlight(app, `After leaving ${nameTag}`)
    // A negative check: give the student's app ten of its 3-second checks to (wrongly) pull the note.
    await student.page.waitForTimeout(30_000)
    expect((await projectRows(student.page)).map((p) => p.id)).toContain(copy.id)
    expect(await studentNotes(student, copy.id)).toEqual([])
  })

  test('REG-936 the student keeps a live share out of their projects and adds it back: it leaves Home, stays under Received, and returns up to date', { tag: '@P2' }, async ({ app, page, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Outside ${nameTag}`
    await workspaceWithPdf(app, name)
    await goLive(app, [student])
    await arrived(student, name)

    const screen = new SharingScreen(student.page)
    await screen.open(student.name)
    const card = screen.receivedCard(name)
    await screen.menu(card, 'Keep it out of my projects…')
    const dialog = student.page.getByRole('dialog', { name: 'Keep it out of your projects?' })
    await dialog.getByRole('button', { name: 'Remove from my projects' }).click()
    await student.app.toasts.expectShown(`“${name}” is out of your projects. It stays here under Received.`, 30_000)
    await expect.poll(async () => (await projectRows(student.page)).filter((p) => p.name === name).length, { timeout: 30_000 }).toBe(0)
    await expect(card).toContainText('Live · kept out of your projects')

    // While it is out, the teacher keeps working; adding it back brings the latest.
    await noteAndHighlight(app, `While away ${nameTag}`)
    await card.getByRole('button', { name: 'Add to my projects' }).click()
    await student.app.toasts.expectShown(`“${name}” is back in your projects`, 60_000)
    const copy = await arrived(student, name)
    await expectInSync(page, student, await teacherProjectId(page, name), copy.id, 'after adding it back')
  })

  test('REG-937 a project shared live to a class of two reaches both students, and the teacher\'s next note reaches both', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const pair = await students(2)
    await bootLive(app)
    const name = `Class live ${nameTag}`
    const className = `L${nameTag}`.slice(0, 20)
    await workspaceWithPdf(app, name)
    await app.header.home.click()
    await createClass(app, teacher.name, className, pair)
    expect(await shareToClass(app, className, 'Live'), 'what the teacher is told').toEqual({ button: 'Share live with 2', toast: 'Shared live with 2 people — your changes will reach them automatically' })
    const copies = []
    for (const student of pair) copies.push(await arrived(student, name))

    await app.home.reach()
    await app.home.openProject(name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await noteAndHighlight(app, `For the class ${nameTag}`)
    const pid = await teacherProjectId(page, name)
    for (const [i, student] of pair.entries()) await expectInSync(page, student, pid, copies[i].id, `${student.email} after the class note`)
  })

  test('REG-938 a student added to the class after it went live joins the live share and receives the project, up to date', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const [first, late] = await students(2)
    await bootLive(app)
    const name = `Late ${nameTag}`
    const className = `J${nameTag}`.slice(0, 20)
    await workspaceWithPdf(app, name)
    await noteAndHighlight(app, `Before joining ${nameTag}`)
    await app.header.home.click()
    const screen = await createClass(app, teacher.name, className, [first])
    expect(await shareToClass(app, className, 'Live'), 'what the teacher is told').toEqual({ button: 'Share live with 1', toast: 'Shared live with 1 person — your changes will reach them automatically' })
    await arrived(first, name)

    const manage = screen.managePanel(className)
    if (!(await manage.isVisible())) await screen.classCard(className).getByRole('button', { name: 'Manage' }).click()
    await manage.getByRole('button', { name: 'Add people' }).click()
    const add = new AddPeopleDialog(page, `Add people to “${className}”`)
    await add.search.fill(late.email)
    await add.person(late.name).click()
    await app.toasts.expectShown(`${late.name} added to ${className}`, 30_000)
    await expect.poll(async () => [...((await liveShares(page, name))[0]?.recipientIds ?? [])].sort(), { timeout: SERVER_LIST, message: 'the live share now reaches both' })
      .toEqual([first.userId, late.userId].sort())

    const copy = await arrived(late, name)
    await expectInSync(page, late, await teacherProjectId(page, name), copy.id, 'the late joiner\'s copy')
  })

  test('REG-946 the server lists the teacher\'s live shares within 10 seconds, however many they have made', { tag: '@P2' }, async ({ context }, testInfo) => {
    // On an account with few live shares this passes; the QA teacher account keeps every live share the suite has
    // made (stopped ones are never removed), so it shows the defect, and more clearly on each run.
    knownDefect('DEF-516')
    const started = Date.now()
    const rows = await new LiveApi(context).liveMine()
    const ms = Date.now() - started
    testInfo.annotations.push({ type: 'live/mine', description: `${rows.length} live shares (${rows.filter((r) => r.stopped).length} stopped) listed in ${(ms / 1000).toFixed(1)} s` })
    expect(ms, `listing ${rows.length} live shares took`).toBeLessThan(10_000)
  })
})
