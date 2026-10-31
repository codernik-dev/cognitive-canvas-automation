/**
 * Regression: live sharing end to end (components/sharing/LiveShareControl.tsx,
 * LiveAutoSync.tsx, LiveSubscriptionBadge.tsx, board/ShareDetailPanel.tsx,
 * board/ReceivedBoard.tsx; services/sharing/liveSyncService.ts, liveFiles.ts).
 *
 * The teacher (main page) goes live from the workspace header; the student
 * (a second context, another identity) is served by the same stateful fake,
 * so every version the teacher pushes is the one the student downloads.
 * "Send and fetch only what changed" is asserted on the wire: a push after an
 * edit carries the changed records but not the PDF bytes the student already
 * holds (format 1), and with format 2 a file is uploaded and downloaded once.
 * Mocked backend: proves the app's side of the contract only.
 */
import type { Page } from '@playwright/test'
import { test, expect, STUDENT, STUDENT_2, type SecondUser } from '../../fixtures/sharing.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { SharingBackend } from '../../helpers/mocks/sharingBackend.js'
import { knownDefect } from '../../helpers/defects.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { readStore } from '../../helpers/idb.js'
import { ShellBanners } from '../../pages/ShellPages.js'
import { SharingScreen, ShareComposerDialog, LiveHeader, AddPeopleDialog } from '../../pages/SharingScreen.js'
import { documentDigests, localJson, projectRows, readSnapshot } from '../../helpers/sharingFlows.js'

const TEACHER = 'e2e-user-0001'
const pushPath = /^\/api\/sharing\/live\/[^/]+\/push$/

/** From the open workspace: header Share -> pick Sam -> Share live. */
async function goLiveToSam(app: CognitiveCanvas, sharing: SharingBackend) {
  const header = new LiveHeader(app.page)
  await header.shareButton.click()
  const c = new ShareComposerDialog(app.page)
  await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
  await c.sized()
  await expect(c.send).toHaveText('Share live with 1')
  await c.send.click()
  await app.toasts.expectShown('Shared live with 1 person — your changes will reach them automatically')
  await expect(header.livePill).toHaveText('Live · 1')
  return sharing.liveOf(TEACHER)[0]
}

/** The student's copy of the live project, once it has arrived. */
async function studentCopy(student: SecondUser, title = 'Automation Project') {
  await expect(student.app.home.card(title)).toBeVisible({ timeout: 20_000 })
  const [p] = await projectRows(student.page)
  return p
}

const sharingOf = (page: Page) => new SharingScreen(page)

/** A project with two PDFs, shared live with Sam from the Sharing screen: every document, or only the first. */
async function twoDocsLive(app: CognitiveCanvas, sharing: SharingBackend, scope: 'all' | 'first') {
  await app.home.createProject('Two Docs')
  await app.documents.uploadMany([FIND_PDF.payload(), SECOND_PDF.payload()])
  const docs = await documentDigests(app.page)
  const find = docs.find((d) => d.name === FIND_PDF.displayName)!
  const second = docs.find((d) => d.name === SECOND_PDF.displayName)!
  await app.home.reach()
  await sharingOf(app.page).open()
  await sharingOf(app.page).share.click()
  const c = new ShareComposerDialog(app.page)
  if (scope === 'first') await c.doc(SECOND_PDF.displayName).uncheck()
  await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
  await c.sized()
  await c.send.click()
  await app.toasts.expectShown('Shared live with 1 person — your changes will reach them automatically')
  return { find, second, share: sharing.liveOf(TEACHER)[0] }
}

test.describe('Live sharing', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.beforeEach(({ sharing }) => {
    sharing.addPerson(STUDENT, false)
    sharing.addPerson(STUDENT_2, false)
  })

  test('REG-530 going live delivers the project to the student, who gets a working copy marked as shared and reports the version seen', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    const [teacherProject] = await projectRows(page)
    const [teacherDoc] = await documentDigests(page)
    const share = await goLiveToSam(app, sharing)

    const [go] = sharing.callsTo('POST', '/api/sharing/live')
    expect([...go.form!.keys()]).toEqual(['projectId', 'title', 'recipientIds', 'documentIds', 'blob']) // no listId: shared with a person
    expect(JSON.parse(go.form!.get('recipientIds')!.text)).toEqual([STUDENT.sub])
    expect(JSON.parse(go.form!.get('documentIds')!.text)).toEqual([teacherDoc.id])
    expect(readSnapshot(go.form!.get('blob')!.data).fileSha(`documents/${teacherDoc.id}/file.pdf`)).toBe(teacherDoc.sha256)

    await student.app.toasts.expectShown('“Automation Project” updated from your teacher', 20_000)
    const copy = await studentCopy(student)
    expect(copy).toMatchObject({ name: 'Automation Project', liveShareId: share.shareId, sourceProjectId: teacherProject.id })
    const [doc] = await documentDigests(student.page)
    expect(doc).toMatchObject({ id: teacherDoc.id, projectId: copy.id, sha256: teacherDoc.sha256 })
    await expect.poll(() => sharing.callsTo('POST', `/api/sharing/live/${share.shareId}/seen`, STUDENT.sub).map((x) => x.json)).toEqual([{ version: 1 }])
    expect(share.recipients.get(STUDENT.sub)?.lastSeenVersion).toBe(1)
    const mirrors = sharing.callsTo('GET', `/api/sharing/live/${share.shareId}/mirror`, STUDENT.sub)
    expect(mirrors.map((x) => x.query.toString())).toEqual(['version=1&format=2']) // the first answer was reused for v1
    expect(await localJson<Record<string, { projectId: string; lastMergedVersion: number }>>(student.page, 'cc2_live_sub_v3'))
      .toEqual({ [share.shareId]: expect.objectContaining({ projectId: copy.id, lastMergedVersion: 1 }) })

    const screen = new SharingScreen(student.page)
    await screen.open('Sam Student')
    const card = screen.receivedCard('Automation Project')
    await expect(card).toContainText('from Automation User')
    await expect(card).toContainText('Live · updated just now')
    await expect(card.getByRole('button', { name: 'Open', exact: true })).toBeVisible()
    await expect(student.page.getByText('Everything is up to date')).toBeVisible()
  })

  test('REG-531 a teacher\'s edit is pushed on its own and the push carries the changed records but not the PDF the student already has', { tag: ['@P1', '@sanity'] }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    const [teacherDoc] = await documentDigests(page)
    const share = await goLiveToSam(app, sharing)
    await studentCopy(student)
    await expect.poll(() => share.recipients.get(STUDENT.sub)?.lastSeenVersion ?? 0).toBe(1)

    const noteId = (await app.canvas.place('note', 0.5, 0.4))!
    await expect.poll(() => sharing.callsTo('POST', pushPath).length, { timeout: 20_000, message: 'automatic push after the edit' }).toBe(1)
    const [push] = sharing.callsTo('POST', pushPath)
    expect(push.path).toBe(`/api/sharing/live/${share.shareId}/push`)
    expect([...push.form!.keys()]).toEqual(['blob']) // no title: the project was not renamed
    const delta = readSnapshot(push.form!.get('blob')!.data)
    expect(delta.json<Array<{ id: string; type: string }>>('data/workspaceItems.json').map((i) => i.id)).toContain(noteId)
    expect(delta.names).toContain(`documents/${teacherDoc.id}/meta.json`)
    expect(delta.names).not.toContain(`documents/${teacherDoc.id}/file.pdf`) // bytes the student already holds stay home
    expect(share.versions.map((v) => v.version)).toEqual([1, 2])

    // The student's copy gains the note; its PDF bytes are untouched by the delta.
    await expect.poll(async () => (await readStore<{ id: string }>(student.page, 'workspaceItems')).map((i) => i.id), { timeout: 20_000 }).toContain(noteId)
    const [doc] = await documentDigests(student.page)
    expect(doc.sha256).toBe(teacherDoc.sha256)
    await expect.poll(() => sharing.callsTo('POST', `/api/sharing/live/${share.shareId}/seen`, STUDENT.sub).map((x) => x.json)).toEqual([{ version: 1 }, { version: 2 }])
  })

  test('REG-532 with format 2 a file is uploaded once and downloaded once; later versions move only the changed tables', { tag: '@P1' }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    sharing.capabilities = { maxUploadBytes: 90 * 1024 * 1024, chunkedUpload: false, maxChunkBytes: 0, applicationMaxBytes: 0, liveFiles: true }
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    const [teacherDoc] = await documentDigests(page)
    const share = await goLiveToSam(app, sharing)
    const pdfPath = `documents/${teacherDoc.id}/file.pdf`

    // Go-live: ask which files the server lacks, upload exactly that one, then a data-only version.
    const checks = sharing.callsTo('POST', '/api/sharing/live/files/check')
    expect(checks.map((x) => x.json)).toEqual([{ hashes: [teacherDoc.sha256] }])
    const uploads = sharing.callsTo('POST', /^\/api\/sharing\/live\/files\/[0-9a-f]{64}$/)
    expect(uploads.map((x) => x.path)).toEqual([`/api/sharing/live/files/${teacherDoc.sha256}`])
    expect(uploads[0].raw!.length).toBe(teacherDoc.bytes)
    const [go] = sharing.callsTo('POST', '/api/sharing/live')
    expect(go.form!.get('format')!.text).toBe('2')
    const v1 = readSnapshot(go.form!.get('blob')!.data)
    expect(v1.names).not.toContain(pdfPath)
    expect(v1.json('live-manifest.json')).toEqual({
      manifestKind: 'cognitive-canvas-live-manifest', format: 2,
      files: [{ path: pdfPath, kind: 'doc', id: teacherDoc.id, sha256: teacherDoc.sha256, size: teacherDoc.bytes }],
    })

    // The student fetches the data version, then the one file it lacks, and checks it.
    await studentCopy(student)
    const [doc] = await documentDigests(student.page)
    expect(doc.sha256).toBe(teacherDoc.sha256)
    expect(sharing.callsTo('GET', `/api/sharing/live/${share.shareId}/files/${teacherDoc.sha256}`, STUDENT.sub)).toHaveLength(1)

    // An edit: the server already holds the file, so nothing is uploaded and nothing is downloaded again.
    const noteId = (await app.canvas.place('note', 0.5, 0.4))!
    await expect.poll(() => sharing.callsTo('POST', pushPath).length, { timeout: 20_000 }).toBe(1)
    const [push] = sharing.callsTo('POST', pushPath)
    expect(push.form!.get('format')!.text).toBe('2')
    const v2 = readSnapshot(push.form!.get('blob')!.data)
    expect(v2.names).not.toContain(pdfPath)
    expect(v2.json<Array<{ id: string }>>('data/workspaceItems.json').map((i) => i.id)).toContain(noteId)
    expect(sharing.callsTo('POST', /^\/api\/sharing\/live\/files\/[0-9a-f]{64}$/)).toHaveLength(1)
    await expect.poll(async () => (await readStore<{ id: string }>(student.page, 'workspaceItems')).map((i) => i.id), { timeout: 20_000 }).toContain(noteId)
    expect(sharing.callsTo('GET', /\/files\/[0-9a-f]{64}$/, STUDENT.sub)).toHaveLength(1)
    expect(sharing.callsTo('GET', `/api/sharing/live/${share.shareId}/mirror`, STUDENT.sub).map((x) => x.query.toString()))
      .toEqual(['version=1&format=2', 'version=2&format=2'])
  })

  test('REG-533 stopping a live share from the header ends it for everyone; the student keeps the copy and is told once', { tag: '@P1' }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    const header = new LiveHeader(page)
    const share = await goLiveToSam(app, sharing)
    await studentCopy(student)
    await expect.poll(() => share.recipients.get(STUDENT.sub)?.lastSeenVersion ?? 0).toBe(1)

    await header.livePill.click()
    await expect(header.panelHeading).toBeVisible()
    await expect(page.getByText('Your edits auto-sync to everyone below. Private notes are never sent.')).toBeVisible()
    await header.stopLive.click()
    await app.toasts.expectShown('Stopped — recipients no longer receive updates')
    expect(sharing.callsTo('DELETE', `/api/sharing/live/${share.shareId}`)).toHaveLength(1)
    expect(share.stopped).toBe(true)
    await expect(header.shareButton).toBeVisible()
    expect(Object.keys((await localJson<Record<string, unknown>>(page, 'cc2_live_owner_v1')) ?? {})).toEqual([])

    await student.app.toasts.expectShown('“Automation Project” is no longer being updated — your copy stays exactly as it is.', 20_000)
    await expect.poll(() => share.recipients.get(STUDENT.sub)?.stopNoticeAcknowledged).toBe(true)
    expect(await projectRows(student.page)).toHaveLength(1)
    const screen = new SharingScreen(student.page)
    await screen.open('Sam Student')
    const card = screen.receivedCard('Automation Project')
    await expect(card).toContainText('Stopped · you keep your copy')
    // Told once: the acknowledgement is on the server, so no second notice arrives.
    expect(sharing.callsTo('PATCH', `/api/sharing/live/${share.shareId}/recipients/me`, STUDENT.sub).map((x) => x.json)).toEqual([{ stopNoticeAcknowledged: true }])

  })

  test('REG-534 the header Live panel pushes on demand and adds and removes recipients on the server', { tag: '@P2' }, async ({ pdfOpen: app, page, sharing }) => {
    const header = new LiveHeader(page)
    const share = await goLiveToSam(app, sharing)
    share.recipients.set(STUDENT.sub, { lastSeenVersion: 1, lastSeenAt: Date.now() })
    await header.livePill.click()
    const sam = page.getByTitle('Has the latest version')
    await expect(sam).toContainText('Sam Student')

    await header.pushChanges.click()
    await app.toasts.expectShown('Changes pushed to recipients')
    expect(sharing.callsTo('POST', pushPath)).toHaveLength(1)

    await page.getByPlaceholder('Add people by email…').fill(STUDENT_2.email)
    await page.getByRole('button', { name: /Riya Reader/ }).click()
    await expect(header.livePill).toHaveText('Live · 2')
    expect(sharing.callsTo('POST', `/api/sharing/live/${share.shareId}/recipients`).map((x) => x.json)).toEqual([{ userId: STUDENT_2.sub }])
    expect(share.recipientIds).toEqual([STUDENT.sub, STUDENT_2.sub])

    await page.locator('span[title="Has the latest version"]').getByRole('button', { name: 'Remove' }).click()
    await expect(header.livePill).toHaveText('Live · 1')
    expect(sharing.callsTo('DELETE', `/api/sharing/live/${share.shareId}/recipients/${STUDENT.sub}`)).toHaveLength(1)
    expect(share.recipientIds).toEqual([STUDENT_2.sub])
    expect(share.stopped).toBe(false)
  })

  test('REG-583 a live share stopped for everyone stays in the owner\'s Shares under Stopped, ready to share again', { tag: '@P3' }, async ({ signedIn: app, page, sharing }) => {
    knownDefect('DEF-503')
    await app.home.createProject('Stop Me')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    await app.home.reach()
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown('Shared live with 1 person — your changes will reach them automatically')
    await screen.shareCard('Stop Me').click()
    await screen.menu(screen.detail, 'Stop updating for everyone…')
    await page.getByRole('dialog', { name: 'Stop updating for everyone?' }).getByRole('button', { name: 'Stop updating' }).click()
    await app.toasts.expectShown('Stopped updating “Stop Me” — everyone keeps their copy')
    expect(sharing.liveOf(TEACHER)[0].stopped).toBe(true)
    await expect(screen.filter(screen.sharesFilter, 'Stopped')).toHaveAccessibleName('Stopped 1')
    await expect(screen.shareCard('Stop Me')).toHaveAccessibleName('Stop Me — Stopped · they keep their copies')
    await screen.shareCard('Stop Me').click()
    await expect(screen.detail.getByRole('button', { name: 'Share again, live' })).toBeVisible()
  })

  test('REG-535 a push the server refuses is reported in the header and on Shares, and "Push again" recovers it', { tag: '@P1' }, async ({ pdfOpen: app, page, sharing }) => {
    knownDefect('DEF-504')
    const header = new LiveHeader(page)
    await goLiveToSam(app, sharing)
    sharing.override('POST', pushPath, { status: 500, json: { message: 'Mirror store offline' } }, 1)
    await app.canvas.place('note', 0.5, 0.4)
    await app.toasts.expectShown(/^“Automation Project” has stopped syncing — recipients are NOT receiving new notes\.\s*Mirror store offline$/, 20_000)
    await expect(header.notSyncingPill).toHaveAccessibleName('Recipients are NOT receiving updates — Mirror store offline')
    await expect(header.notSyncingPill).toHaveText('Not syncing')

    const screen = new SharingScreen(page)
    await screen.open()
    await expect(screen.shareCard('Automation Project')).toHaveAccessibleName('Automation Project — Live · couldn’t send your last change')
    const strip = page.getByRole('status').filter({ hasText: 'couldn’t reach Sam Student' })
    await expect(strip).toContainText('Automation Project couldn’t reach Sam Student — Mirror store offline. It will retry on its own; you can push again now.')
    await strip.getByRole('button', { name: 'Push again' }).click()
    await app.toasts.expectShown('Your latest changes are on their way')
    await expect(screen.shareCard('Automation Project')).toHaveAccessibleName('Automation Project — Live · 1 person')
    await expect(strip).toBeHidden()
    expect(sharing.callsTo('POST', pushPath).map((x) => x.status)).toEqual([500, 200])
  })

  test('REG-536 the student\'s header shows a Live badge on the shared project, and "Away" once the teacher signs out', { tag: '@P2' }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    await goLiveToSam(app, sharing)
    await studentCopy(student)
    await student.app.home.openProject('Automation Project')
    const badge = new LiveHeader(student.page).subscriptionBadge
    await expect(badge).toHaveText('Live')
    await expect(badge).toHaveAttribute('title', 'Kept up to date by Automation User')
    await badge.click()
    await expect(student.page.getByText('Kept up to date', { exact: true })).toBeVisible()
    await expect(student.page.getByText('Automation User is sharing this document live. New changes arrive on their own — you don\'t need to do anything.')).toBeVisible()
    await expect(student.page.getByText('Your own notes on this document stay yours — they\'re never sent back, and an update won\'t overwrite them.')).toBeVisible()

    // The teacher signs out: the app tells the server, and the student's badge softens.
    await page.getByRole('button', { name: 'Automation User', exact: true }).click()
    await app.profileMenu.menu.getByRole('menuitem', { name: 'Sign out' }).click()
    await new ShellBanners(page).signOut.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect.poll(() => sharing.callsTo('PATCH', '/api/sharing/live/presence', TEACHER).map((x) => x.json)).toContainEqual({ away: true })
    await expect(badge).toHaveText('Away', { timeout: 20_000 })
    await expect(badge).toHaveAttribute('title', 'Automation User is signed out — updates resume when they return')
  })

  test('REG-537 the student can keep a live share out of their projects and add it back', { tag: '@P2' }, async ({ pdfOpen: app, sharing, secondUser }) => {
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    const share = await goLiveToSam(app, sharing)
    await studentCopy(student)
    const screen = new SharingScreen(student.page)
    await screen.open('Sam Student')
    const card = screen.receivedCard('Automation Project')
    await screen.menu(card, 'Keep it out of my projects…')
    const dialog = student.page.getByRole('dialog', { name: 'Keep it out of your projects?' })
    await expect(dialog).toContainText('“Automation Project” leaves your home screen and stops updating on this device. It stays here under Received, and you can add it back any time.')
    await expect(dialog).toContainText('The copy on this device is deleted, including any notes you added to it.')
    await dialog.getByRole('button', { name: 'Remove from my projects' }).click()
    await student.app.toasts.expectShown('“Automation Project” is out of your projects. It stays here under Received.')
    expect(share.recipients.get(STUDENT.sub)?.mirrorToLibrary).toBe(false)
    await expect.poll(async () => (await projectRows(student.page)).length).toBe(0)
    await expect(card).toContainText('Live · kept out of your projects')

    await card.getByRole('button', { name: 'Add to my projects' }).click()
    await student.app.toasts.expectShown('“Automation Project” is back in your projects')
    expect(share.recipients.get(STUDENT.sub)?.mirrorToLibrary).toBe(true)
    await expect.poll(async () => (await projectRows(student.page)).map((p) => p.liveShareId)).toEqual([share.shareId])
    const prefs = sharing.callsTo('PATCH', `/api/sharing/live/${share.shareId}/recipients/me`, STUDENT.sub).map((x) => x.json)
    expect(prefs[0]).toEqual({ mirrorToLibrary: false })
    expect(prefs.at(-1)).toEqual({ mirrorToLibrary: true })
  })

  test('REG-538 the student can stop receiving a live share; their copy stays', { tag: '@P2' }, async ({ pdfOpen: app, sharing, secondUser }) => {
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    const share = await goLiveToSam(app, sharing)
    await studentCopy(student)
    const screen = new SharingScreen(student.page)
    await screen.open('Sam Student')
    const card = screen.receivedCard('Automation Project')
    let message = ''
    student.page.once('dialog', (d) => { message = d.message(); void d.accept() })
    await screen.menu(card, 'Stop receiving updates…')
    await expect.poll(() => message).toBe('Stop receiving updates for “Automation Project”?\n\nYour copy stays as it is; it just won\'t change again.')
    await student.app.toasts.expectShown('You no longer receive updates for “Automation Project”')
    expect(sharing.callsTo('DELETE', `/api/sharing/live/${share.shareId}/recipients/${STUDENT.sub}`, STUDENT.sub)).toHaveLength(1)
    expect(share.recipientIds).toEqual([])
    await expect(card).toHaveCount(0)
    await expect(student.page.getByText('Nothing here yet')).toBeVisible()
    expect(await projectRows(student.page)).toHaveLength(1)
  })

  test('REG-539 the Shares detail panel lists the people, and stopping one document keeps it out of every later push', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    knownDefect('DEF-505')
    const { find } = await twoDocsLive(app, sharing, 'all')
    await sharingOf(page).shareCard('Two Docs').click()
    const panel = sharingOf(page).detail
    await expect(panel.getByRole('heading', { name: 'Two Docs' })).toBeVisible()
    await expect(panel).toContainText('Live · 1 person')
    await expect(panel).toContainText('Documents · 2')
    await expect(panel).toContainText('People · 1')
    await expect(panel).toContainText('Shared live with Sam Student')
    await expect(panel).toContainText('Everyone sees this as a share from you. Nobody sees the class or each other.')

    // Two presses, then a push without that document.
    const row = panel.locator('div.h-10').filter({ hasText: SECOND_PDF.displayName })
    await row.getByRole('button', { name: 'Stop', exact: true }).click()
    await row.getByRole('button', { name: 'Stop this one?' }).click()
    await app.toasts.expectShown(`“${SECOND_PDF.displayName}” has stopped updating — they keep the copy they have`)
    await expect.poll(() => sharing.callsTo('POST', pushPath).length).toBe(1)
    expect(readSnapshot(sharing.callsTo('POST', pushPath)[0].form!.get('blob')!.data).docIds).toEqual([find.id])

    // ...and it stays out: the next push still carries only the other document.
    await expect.poll(async () => Object.values((await localJson<Record<string, { documentIds: string[] }>>(page, 'cc2_live_owner_v1'))!)[0].documentIds).toEqual([find.id])
    await panel.getByRole('button', { name: 'Push now' }).click()
    await app.toasts.expectShown('Your latest changes are on their way')
    await expect.poll(() => sharing.callsTo('POST', pushPath).length).toBe(2)
    expect(readSnapshot(sharing.callsTo('POST', pushPath)[1].form!.get('blob')!.data).docIds).toEqual([find.id])
  })

  test('REG-584 a live share of one document says the project has more, adds them in one press, and can be stopped for everyone', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    const { find, second, share } = await twoDocsLive(app, sharing, 'first')
    await sharingOf(page).shareCard('Two Docs').click()
    const panel = sharingOf(page).detail
    await expect(panel).toContainText('1 document in this project is not in this share. Only a whole-project share takes new documents on its own.')
    await panel.getByRole('button', { name: 'Add them' }).click()
    await app.toasts.expectShown('1 document added to the share — from now on new documents join automatically')
    await expect.poll(() => sharing.callsTo('POST', pushPath).length).toBe(1)
    const widened = readSnapshot(sharing.callsTo('POST', pushPath)[0].form!.get('blob')!.data)
    expect(new Set(widened.docIds)).toEqual(new Set([find.id, second.id]))
    await expect(panel).not.toContainText('not in this share')

    await sharingOf(page).menu(panel, 'Stop updating for everyone…')
    const modal = page.getByRole('dialog', { name: 'Stop updating for everyone?' })
    await expect(modal).toContainText('“Two Docs” stops reaching Sam Student. Everyone keeps the copy they already have — nothing is taken back, and nobody is notified. You can share it live again later.')
    await modal.getByRole('button', { name: 'Cancel' }).click()
    expect(share.stopped).toBe(false)
    await sharingOf(page).menu(panel, 'Stop updating for everyone…')
    await modal.getByRole('button', { name: 'Stop updating' }).click()
    await app.toasts.expectShown('Stopped updating “Two Docs” — everyone keeps their copy')
    expect(sharing.callsTo('DELETE', `/api/sharing/live/${share.shareId}`)).toHaveLength(1)
    expect(share.stopped).toBe(true)
    await expect(panel).toBeHidden()
  })

  test('REG-540 a student added to a class later joins its live share, and the next push resends the full project once for them', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    const list = sharing.seedList(TEACHER, 'Physics 11', [STUDENT.sub])
    await app.home.createProject('Class Project')
    await app.documents.uploadFiles(FIND_PDF.payload())
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    const [doc] = await documentDigests(page)
    await app.home.reach()
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Classes & people').click()
    await screen.classCard('Physics 11').getByRole('button', { name: 'Share to class' }).click()
    const c = new ShareComposerDialog(page)
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown('Shared live with 1 person — your changes will reach them automatically')
    const share = sharing.liveOf(TEACHER)[0]

    await screen.classCard('Physics 11').getByRole('button', { name: 'Manage' }).click()
    const manage = screen.managePanel('Physics 11')
    await manage.getByRole('button', { name: 'Add people' }).click()
    const add = new AddPeopleDialog(page, 'Add people to “Physics 11”')
    await expect(add.dialog).toContainText('Search by email. They join this class and start receiving its live shares.')
    await add.search.fill(STUDENT_2.email)
    await add.person('Riya Reader').click()
    await app.toasts.expectShown('Riya Reader added to Physics 11')
    expect(sharing.callsTo('POST', `/api/sharing/lists/${list.id}/members`).map((x) => x.json)).toEqual([{ userId: STUDENT_2.sub }])
    expect(share.recipientIds).toEqual([STUDENT.sub, STUDENT_2.sub])
    await expect(manage).toContainText('People · 2')

    // The late joiner has nothing yet: the next push carries the PDF again, the one after does not.
    await screen.tab('Shares').click()
    await screen.shareCard('Class Project').click()
    await screen.detail.getByRole('button', { name: 'Push now' }).click()
    await app.toasts.expectShown('Your latest changes are on their way')
    await screen.detail.getByRole('button', { name: 'Push now' }).click()
    await expect.poll(() => sharing.callsTo('POST', pushPath).length).toBe(2)
    const [first, second] = sharing.callsTo('POST', pushPath).map((x) => readSnapshot(x.form!.get('blob')!.data))
    expect(first.fileSha(`documents/${doc.id}/file.pdf`)).toBe(doc.sha256)
    expect(second.names).not.toContain(`documents/${doc.id}/file.pdf`)
  })
})
