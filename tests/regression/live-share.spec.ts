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
import { BINARY, FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { readStore } from '../../helpers/idb.js'
import { CanvasDialogs } from '../../components/CanvasWorkbench.js'
import { settle } from '../../workflows/richContent.js'
import { ShellBanners, ProjectsScreen } from '../../pages/ShellPages.js'
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

const mirrorPath = /^\/api\/sharing\/live\/[^/]+\/mirror$/

/** A canvas card's transfer bar (MediaTransferOverlay.tsx: Uploading / Waiting to upload / Receiving). */
const progressBar = (page: Page, itemId: string) => page.locator(`[data-workspace-item][data-item-id="${itemId}"]`).getByRole('progressbar')

/** Recording sizes in bytes, by blob id. */
async function blobSizes(page: Page) {
  return Object.fromEntries((await readStore<{ id: string; data?: { __bytes?: number } }>(page, 'mediaBlobs')).map((b) => [b.id, b.data?.__bytes ?? 0]))
}

type AudioCard = { id: string; type: string; data: { name?: string; blobId?: string } }

/**
 * Teacher live to Sam, who has the project open. The teacher's next push (a note)
 * is held at the server while two recordings are added, so the push after it has
 * both to carry: it sends one and holds the other back for the push after that.
 * Returns with the first of those recording pushes waiting at the server.
 */
async function twoRecordingsQueued(app: CognitiveCanvas, sharing: SharingBackend, secondUser: (id: typeof STUDENT, plan?: 'free') => Promise<SecondUser>) {
  const student = await secondUser(STUDENT, 'free')
  await student.signIn()
  await goLiveToSam(app, sharing)
  await studentCopy(student)
  await student.app.home.openProject('Automation Project')
  await student.app.documents.openDocument(FIND_PDF.displayName)

  const notePush = sharing.hold('POST', pushPath)
  await app.canvas.place('note', 0.5, 0.2)
  await notePush.reached
  await addAudioNote(app, 0.3, 'Tone A')
  await addAudioNote(app, 0.7, 'Tone B')
  await settle(app.page, { mediaBlobs: 2 })
  const audioCards = async () => new Map((await readStore<AudioCard>(app.page, 'workspaceItems')).filter((i) => i.type === 'audio').map((i) => [i.data.name!, i]))
  await expect.poll(async () => [...(await audioCards()).keys()].sort(), { message: 'both audio notes saved' }).toEqual(['Tone A', 'Tone B'])
  const cards = await audioCards()
  const firstRecordingPush = sharing.hold('POST', pushPath)
  const secondRecordingPush = sharing.hold('POST', pushPath, { pass: 1 })
  notePush.release()
  await firstRecordingPush.reached
  return { student, cards, firstRecordingPush, secondRecordingPush }
}

/** An uploaded audio note (the tone fixture) at a spot on the canvas. */
async function addAudioNote(app: CognitiveCanvas, x: number, name: string) {
  const dialogs = new CanvasDialogs(app.page)
  await app.canvas.place('audio', x, 0.5)
  const audio = dialogs.media(dialogs.audio, 'Audio')
  await audio.tab('Upload').click()
  await audio.file.setInputFiles(BINARY.toneMp3)
  await expect(audio.name).toHaveValue('tone') // suggested from the file name; typing before it lands gets prefixed
  await audio.name.fill(name)
  await expect(audio.name).toHaveValue(name)
  await audio.create.click()
  await expect(dialogs.audio).toBeHidden({ timeout: 30_000 })
}

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

  test('REG-952 deleting a project that is shared live says so first; Cancel keeps it, and Delete ends the live share on the server before the project goes', { tag: '@P1' }, async ({ pdfOpen: app, page, sharing }) => {
    const share = await goLiveToSam(app, sharing)
    await app.header.home.click()
    await app.home.cardAction('Automation Project', 'Delete')
    const dialog = page.getByRole('dialog', { name: 'Delete Project' })
    await expect(dialog).toContainText('This project is shared Live with 1 person. Deleting it ends the broadcast — they keep what they already received, and stop seeing it as live.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(share.stopped).toBe(false)
    expect(await projectRows(page)).toHaveLength(1)

    await app.home.cardAction('Automation Project', 'Delete')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(sharing.callsTo('DELETE', `/api/sharing/live/${share.shareId}`)).toHaveLength(1)
    expect(share.stopped).toBe(true)
    expect(await projectRows(page)).toEqual([])
    expect(Object.keys((await localJson<Record<string, unknown>>(page, 'cc2_live_owner_v1')) ?? {})).toEqual([])
    await expect(app.home.card('Automation Project')).toHaveCount(0)
  })

  test('REG-953 a live project deleted while the server cannot be reached is still deleted, and the teacher is told its recipients may still see it as live', { tag: '@P2' }, async ({ pdfOpen: app, page, sharing }) => {
    const share = await goLiveToSam(app, sharing)
    await app.header.home.click()
    sharing.override('DELETE', /^\/api\/sharing\/live\/[^/]+$/, { status: 503, json: { message: 'Service unavailable' } }, 1)
    await app.home.cardAction('Automation Project', 'Delete')
    const dialog = page.getByRole('dialog', { name: 'Delete Project' })
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await app.toasts.expectShown('Project deleted. We could not reach the server to end its live share, so recipients may still see it as live until you are back online.')
    expect(sharing.callsTo('DELETE', `/api/sharing/live/${share.shareId}`).map((c) => c.status)).toEqual([503])
    expect(share.stopped).toBe(false)
    expect(await projectRows(page)).toEqual([])
  })

  test('REG-954 deleting several projects, one of them shared live, says so first; when the server cannot end that live share both are still deleted and the teacher is told', { tag: '@P2' }, async ({ pdfOpen: app, page, sharing }) => {
    const share = await goLiveToSam(app, sharing)
    await app.header.home.click()
    await app.home.createProject('Plain Project')
    await app.documents.backToProjects.click() // a new project opens on creation
    const projects = new ProjectsScreen(page)
    await projects.selectButton.click()
    await projects.selectAll.click()
    await expect(projects.selectedCount).toHaveText('2 selected')
    await projects.deleteSelected.click()
    const dialog = projects.bulkDialog('Delete 2 Projects')
    await expect(dialog).toContainText('One of these is shared Live. Deleting ends that broadcast — recipients keep what they already received, and stop seeing it as live.')

    sharing.override('DELETE', /^\/api\/sharing\/live\/[^/]+$/, { status: 503, json: { message: 'Service unavailable' } }, 1)
    await dialog.getByRole('button', { name: 'Delete 2', exact: true }).click()
    await app.toasts.expectShown('Deleted. 1 live share could not be ended on the server — those recipients may still see them as live until you are back online.')
    expect(share.stopped).toBe(false)
    expect(await projectRows(page)).toEqual([])
  })

  test('REG-957 a note the teacher sent opens read-only for the student, marked VIEW ONLY; Duplicate to edit puts the student\'s own editable copy beside it', { tag: '@P2' }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    type Note = { id: string; type: string; projectId: string; x: number; y: number; data: { content?: string; private?: boolean } }
    const noteId = (await app.canvas.place('note', 0.4, 0.3))!
    await app.canvas.writeNote(noteId, 'From the teacher')
    await settle(page, { workspaceItems: 1 })
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()
    await goLiveToSam(app, sharing)
    const copy = await studentCopy(student)
    await student.app.home.openProject('Automation Project')
    await student.app.documents.openDocument(FIND_PDF.displayName)
    // A live copy keeps the teacher's record ids.
    await expect(student.app.canvas.item(noteId)).toBeVisible({ timeout: 20_000 })

    const dialog = await student.app.canvas.openNoteEditor(noteId)
    await expect(dialog.getByRole('heading', { name: 'Teacher\'s note' })).toBeVisible()
    await expect(dialog.getByText('VIEW ONLY', { exact: true })).toHaveAttribute('title', 'Sent by your teacher. It updates when they change it, and cannot be edited here.')
    await expect(dialog).toContainText('From the teacher')
    await expect(dialog.locator('[contenteditable="true"]')).toHaveCount(0)
    const duplicate = dialog.getByRole('button', { name: 'Duplicate to edit' })
    await expect(duplicate).toHaveAttribute('title', 'Make your own copy of this note and edit that')
    await duplicate.click()
    await expect(dialog).toBeHidden()
    await student.app.toasts.expectShown('Your editable copy is beside the original — double-tap it to edit')

    const notes = async () => (await readStore<Note>(student.page, 'workspaceItems')).filter((i) => i.type === 'note' && i.projectId === copy.id)
    await expect.poll(async () => (await notes()).length, { timeout: 15_000, message: 'the copy is saved' }).toBe(2)
    const all = await notes()
    const original = all.find((n) => n.id === noteId)!
    const mine = all.find((n) => n.id !== noteId)!
    expect(mine.data.content).toBe(original.data.content)
    expect(mine.data.private).toBe(false)
    expect([mine.x - original.x, mine.y - original.y]).toEqual([24, 24])

    // The copy is the student's own: it opens for editing, without the mark.
    const own = await student.app.canvas.openNoteEditor(mine.id)
    await expect(own.getByRole('heading', { name: 'Edit Note' })).toBeVisible()
    await expect(own.getByText('VIEW ONLY', { exact: true })).toHaveCount(0)
    await expect(own.locator('[contenteditable="true"]').first()).toBeVisible()
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

  test('REG-941 a recording still on its way shows "Receiving audio…" on the student\'s card, only on that card, and plays once it lands', { tag: '@P2' }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    test.setTimeout(180_000)
    const { student, cards, firstRecordingPush, secondRecordingPush } = await twoRecordingsQueued(app, sharing, secondUser)

    // The first recording push lands: the student gets both cards, but only one recording. The other is described with no bytes,
    // stored empty, and its card says so (AudioItem.tsx) until the next sync.
    firstRecordingPush.release()
    await secondRecordingPush.reached
    const missing = student.page.getByText('This audio arrived empty. It should be resent on the next sync.', { exact: true })
    await expect(missing).toHaveCount(1, { timeout: 20_000 })
    const secondId = (await student.page.locator('[data-workspace-item]').filter({ has: missing }).getAttribute('data-item-id'))!
    const [second, secondCard] = [...cards].find(([, c]) => c.id === secondId)!
    const [, firstCard] = [...cards].find(([, c]) => c.id !== secondId)!
    const pushed = readSnapshot(sharing.callsTo('POST', pushPath)[1].form!.get('blob')!.data)
    const recordingFiles = (blobId: string) => pushed.names.filter((n) => n.startsWith(`media/${blobId}/file.`))
    expect(recordingFiles(firstCard.data.blobId!), 'the first recording push carries one recording').toHaveLength(1)
    expect(recordingFiles(secondCard.data.blobId!), 'and holds the other one back').toEqual([])
    expect(pushed.names, 'though it does describe it').toContain(`media/${secondCard.data.blobId}/meta.json`)
    const studentCard = (id: string) => student.app.canvas.item(id)
    await expect(studentCard(firstCard.id).locator('audio')).toHaveCount(1)
    await expect(studentCard(firstCard.id)).not.toContainText('arrived empty')

    // The second recording reaches the server; the student's download of it is held, so the card says it is on its way.
    const download = sharing.hold('GET', mirrorPath)
    secondRecordingPush.release()
    await download.reached
    const overlay = studentCard(secondId).getByRole('status')
    await expect(overlay).toHaveText(`${second}Receiving audio…`)
    await expect(studentCard(firstCard.id).getByRole('status')).toHaveCount(0) // a recording already here does not claim to be arriving
    await expect(student.page.getByText('Receiving audio…', { exact: true })).toHaveCount(1)
    await expect(progressBar(student.page, firstCard.id)).toHaveAttribute('aria-label', 'Receiving')
    await expect(progressBar(student.page, secondId)).toHaveAttribute('aria-label', 'Receiving')

    // It lands: the card plays, with nothing left saying it is missing or arriving, and the student holds the same recordings as the teacher.
    download.release()
    await expect(overlay).toBeHidden({ timeout: 20_000 })
    await expect(studentCard(secondId).locator('audio')).toHaveCount(1, { timeout: 20_000 })
    await expect(missing).toHaveCount(0)
    await expect(progressBar(student.page, secondId)).toHaveCount(0)
    const teacherSizes = await blobSizes(page)
    expect(Object.values(teacherSizes).every((n) => n > 0) && Object.keys(teacherSizes).length === 2, 'the teacher holds two recordings').toBe(true)
    await expect.poll(() => blobSizes(student.page)).toEqual(teacherSizes)
    expect(sharing.callsTo('POST', pushPath).map((x) => x.status)).toEqual([200, 200, 200])
  })

  test('REG-942 while recordings go one per push, the teacher\'s cards say which one is uploading and which is waiting its turn', { tag: '@P3' }, async ({ pdfOpen: app, page, sharing, secondUser }) => {
    knownDefect('DEF-514')
    test.setTimeout(180_000)
    const { cards, firstRecordingPush, secondRecordingPush } = await twoRecordingsQueued(app, sharing, secondUser)
    const stateOf = async (id: string) => {
      const bar = progressBar(page, id)
      return (await bar.count()) ? (await bar.first().getAttribute('aria-label')) ?? '' : 'no bar'
    }
    const ids = [...cards.values()].map((c) => c.id)
    await expect.poll(async () => [await stateOf(ids[0]), await stateOf(ids[1])].sort(), { message: 'one uploading, one waiting' }).toEqual(['Uploading', 'Waiting to upload'])
    const [waitingId] = (await Promise.all(ids.map(async (id) => [id, await stateOf(id)] as const))).filter(([, s]) => s === 'Waiting to upload').map(([id]) => id)
    const doneId = ids.find((id) => id !== waitingId)!
    firstRecordingPush.release()
    await secondRecordingPush.reached
    await expect(progressBar(page, waitingId)).toHaveAttribute('aria-label', 'Uploading')
    await expect(progressBar(page, doneId)).toHaveCount(0)
    secondRecordingPush.release()
    await expect(progressBar(page, waitingId)).toHaveCount(0, { timeout: 20_000 })
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
