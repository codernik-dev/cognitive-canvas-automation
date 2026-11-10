/**
 * The steps the live sharing specs repeat, done through the UI as a teacher or
 * student does them: a workspace with a PDF, sending a copy, going live, a
 * class, and waiting for what arrives on a student's device.
 *
 * Arrival is awaited on its result (the project in the student's library),
 * never on a toast alone: a toast can come and go while the teacher's side is
 * still being checked.
 */
import { expect } from '@playwright/test'
import { FIND_PDF } from '../data/files.js'
import { SharingScreen, ShareComposerDialog, NewGroupDialog, LiveHeader } from '../pages/SharingScreen.js'
import { projectRows, type ProjectRow } from '../helpers/sharingFlows.js'
import type { CognitiveCanvas } from '../pages/CognitiveCanvas.js'

/**
 * How long something may take to reach a student: the app checks its inbox
 * every 20 s and its live shares every 3 s, and the upload and download are real.
 */
export const ARRIVAL = 120_000

export interface Person { email: string; name: string }

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/** Home -> a new project with the 4-page PDF open in the workspace. */
export async function workspaceWithPdf(app: CognitiveCanvas, name: string) {
  await app.home.createProject(name)
  await app.documents.expectOpen(name)
  await app.documents.uploadFiles(FIND_PDF.payload())
  await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
}

/** Fill the open Share dialog's recipients, check the button's count and send. */
async function compose(c: ShareComposerDialog, to: Person[], how: 'Copy' | 'Live') {
  await c.how(how).click()
  for (const person of to) await (await c.findPerson(person.email, person.name)).click()
  await c.sized()
  await expect(c.send).toHaveText(how === 'Copy' ? `Send a copy to ${to.length}` : `Share live with ${to.length}`)
  await c.send.click()
}

/** From anywhere: Sharing › Share, the preselected project to each person. `untick` leaves documents out. */
async function shareFromSharing(app: CognitiveCanvas, teacherName: string, to: Person[], how: 'Copy' | 'Live', untick: string[]) {
  const screen = new SharingScreen(app.page)
  await screen.open(teacherName)
  await screen.share.click()
  const c = new ShareComposerDialog(app.page)
  await c.expectOpen()
  for (const doc of untick) await c.doc(doc).uncheck()
  await compose(c, to, how)
  await app.toasts.expectShown(how === 'Copy' ? `Sent a copy to ${people(to.length)}` : `Shared live with ${people(to.length)} — your changes will reach them automatically`, ARRIVAL)
}

/** A copy of the preselected project, from the Sharing screen. */
export const sendCopy = (app: CognitiveCanvas, teacherName: string, to: Person[], untick: string[] = []) => shareFromSharing(app, teacherName, to, 'Copy', untick)

/** The preselected project live, every document ticked (a whole-project share: new documents join on their own), from the Sharing screen. */
export const sendLive = (app: CognitiveCanvas, teacherName: string, to: Person[]) => shareFromSharing(app, teacherName, to, 'Live', [])

/** From the open workspace: the header's Share, live, to each person. */
export async function goLive(app: CognitiveCanvas, to: Person[]) {
  const header = new LiveHeader(app.page)
  await header.shareButton.click()
  await compose(new ShareComposerDialog(app.page), to, 'Live')
  await app.toasts.expectShown(`Shared live with ${people(to.length)} — your changes will reach them automatically`, ARRIVAL)
  await expect(header.livePill).toHaveText(`Live · ${to.length}`)
}

/** Sharing › Classes & people › + New class, with these members; ends on its open Manage panel. */
export async function createClass(app: CognitiveCanvas, teacherName: string, className: string, members: Person[]) {
  const screen = new SharingScreen(app.page)
  await screen.open(teacherName)
  await screen.tab('Classes & people').click()
  await screen.newClass.click()
  const group = new NewGroupDialog(app.page)
  await group.name.fill(className)
  for (const m of members) {
    await group.search.fill(m.email)
    await group.resultRow(m.email).getByRole('button', { name: 'Add', exact: true }).click()
  }
  await group.create.click()
  await expect(screen.managePanel(className)).toBeVisible({ timeout: 30_000 })
  // DEF-515: straight after it is made, the class can show fewer members than it has (an overview check that left
  // before it was saved) until the app's 20-second refresh, and sharing then leaves the others out. REG-945 proves
  // that defect; the tests using this one are about what reaches the class, so they share once it shows everyone.
  await expect(screen.managePanel(className), 'the class shows all its members').toContainText(`${members.length} ${members.length === 1 ? 'person' : 'people'} · `, { timeout: 60_000 })
  return screen
}

/**
 * From the class's open Manage panel: Share to class, a copy or live, sent to
 * all of its members. Returns what the dialog's button and the toast said, so
 * the caller asserts the count the teacher was shown.
 */
export async function shareToClass(app: CognitiveCanvas, className: string, how: 'Copy' | 'Live') {
  await new SharingScreen(app.page).managePanel(className).getByRole('button', { name: 'Share to class' }).click()
  const c = new ShareComposerDialog(app.page)
  await c.expectOpen()
  await c.how(how).click()
  await c.sized()
  const button = ((await c.send.textContent()) ?? '').trim()
  await c.send.click()
  const toast = app.toasts.withText(how === 'Copy' ? /^Sent a copy to \d+ (person|people)$/ : /^Shared live with \d+ (person|people) — /).first()
  await expect(toast).toBeVisible({ timeout: ARRIVAL })
  return { button, toast: ((await toast.textContent()) ?? '').trim() }
}

/** Wait until the project `name` is in the student's library (one copy); returns its row. */
export async function arrived(student: { app: CognitiveCanvas }, name: string): Promise<ProjectRow> {
  const page = student.app.page
  await expect.poll(async () => (await projectRows(page)).filter((p) => p.name === name).length, { timeout: ARRIVAL, message: `"${name}" reached the student` }).toBe(1)
  return (await projectRows(page)).find((p) => p.name === name)!
}
