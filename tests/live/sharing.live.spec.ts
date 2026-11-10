/**
 * LIVE sharing, copies: the build under test against the REAL MuulOrigin
 * sharing service, with real accounts (fixtures/liveSharing.ts). The teacher
 * is the QA account (paid plan, so it can share); the students are real Free
 * accounts, each in its own browser. A copy goes up from the teacher's app
 * and is downloaded and imported by the student's app, exactly as in use.
 *
 * What arrives is compared with what was sent, not counted: document bytes by
 * SHA-256, and for the full project every row of every store, field by field
 * (helpers/shareFidelity.ts).
 *
 * Opt-in: `npm run live` with CC_LIVE_EMAIL / CC_LIVE_PASSWORD (the teacher)
 * and CC_LIVE_STUDENTS / CC_LIVE_STUDENT_PASSWORD (the students) set.
 * Everything a test creates carries its run tag and is removed afterwards.
 */
import { test, expect, bootLive } from '../../fixtures/liveSharing.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { scannedPdf } from '../../data/documents-files.js'
import { OCR_PAGE_TIMEOUT } from '../../components/DocumentsOcr.js'
import { pageGet, type SharingOverview } from '../../helpers/live/sharingApi.js'
import { SharingScreen, NotificationBellControl } from '../../pages/SharingScreen.js'
import { documentDigests, projectRows, projectWithDocs } from '../../helpers/sharingFlows.js'
import { documentByName, searchRows, waitForPages, wordsOf } from '../../helpers/documents.js'
import { readStore } from '../../helpers/idb.js'
import { snapshotDb, RESTORED_STORES } from '../../helpers/backupState.js'
import { expectSameAsSent, receivedCopy } from '../../helpers/shareFidelity.js'
import { knownDefect } from '../../helpers/defects.js'
import { addEveryKindOfContent, settle, RICH_STORES } from '../../workflows/richContent.js'
import { ARRIVAL, arrived, createClass, sendCopy, shareToClass, workspaceWithPdf } from '../../workflows/liveSharing.js'

test.describe('Live: sharing copies on the real server', { tag: ['@live', '@sharing'] }, () => {
  test('REG-910 on the real server the Pro teacher gets the full Sharing screen and the Free student a receive-only one', { tag: '@P1' }, async ({ app, page, teacher, students }) => {
    const [student] = await students(1)
    await bootLive(app)

    const screen = new SharingScreen(page)
    await screen.open(teacher.name)
    for (const tab of ['Shares', 'Received', 'Classes & people'] as const) await expect(screen.tab(tab)).toBeVisible()
    await expect(screen.share).toBeVisible()
    expect(await pageGet<SharingOverview>(page, '/api/sharing/overview')).toMatchObject({ canShare: true, me: { subscribed: true } })

    const studentScreen = new SharingScreen(student.page)
    await studentScreen.open(student.name)
    await expect(studentScreen.tab('Received')).toBeVisible()
    await expect(studentScreen.tab('People')).toBeVisible()
    await expect(studentScreen.tab('Shares')).toHaveCount(0)
    await expect(studentScreen.share).toHaveCount(0)
    expect(await pageGet<SharingOverview>(student.page, '/api/sharing/overview')).toMatchObject({ canShare: false, me: { subscribed: false } })
  })

  test('REG-911 a copy of a one-PDF project sent to a student reaches their device by itself, byte for byte, marked as from the teacher', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Physics ${nameTag}`
    await projectWithDocs(app, name, [FIND_PDF.payload()])
    const [teacherProject] = (await projectRows(page)).filter((p) => p.name === name)
    const [teacherDoc] = (await documentDigests(page)).filter((d) => d.projectId === teacherProject.id)

    await sendCopy(app, teacher.name, [student])
    // The teacher's Shares board lists it.
    await expect(new SharingScreen(page).shareCard(name)).toBeVisible({ timeout: 30_000 })

    // The student: it is imported on its own, as a new copy holding the same bytes.
    const copy = await arrived(student, name)
    await expect(student.app.home.card(name)).toBeVisible()
    expect(copy).toMatchObject({ name, sourceProjectId: teacherProject.id })
    expect(copy.id).not.toBe(teacherProject.id)
    const docs = (await documentDigests(student.page)).filter((d) => d.projectId === copy.id)
    expect(docs.map((d) => ({ name: d.name, sha256: d.sha256 }))).toEqual([{ name: teacherDoc.name, sha256: teacherDoc.sha256 }])

    // Its Received board shows where it came from, and the server has it in the student's inbox.
    const screen = new SharingScreen(student.page)
    await screen.open(student.name)
    const card = screen.receivedCard(name)
    await expect(card).toContainText(`from ${teacher.name}`)
    await expect(card).toContainText('Copy · in your projects')
    const inbox = (await pageGet<SharingOverview>(student.page, '/api/sharing/overview')).inbox.filter((n) => n.title === name)
    expect(inbox).toEqual([expect.objectContaining({ fromUserId: teacher.userId, imported: true })])
  })

  test('REG-912 one copy sent to two students at once reaches each of them, identical', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const pair = await students(2)
    await bootLive(app)
    const name = `Biology ${nameTag}`
    await projectWithDocs(app, name, [FIND_PDF.payload()])
    const [teacherDoc] = await documentDigests(page)

    await sendCopy(app, teacher.name, pair)
    for (const student of pair) {
      const copy = await arrived(student, name)
      const docs = (await documentDigests(student.page)).filter((d) => d.projectId === copy.id)
      expect(docs.map((d) => d.sha256), `${student.email} holds the same PDF`).toEqual([teacherDoc.sha256])
    }
  })

  test('REG-913 a project holding every kind of content arrives as an identical copy: notes, text box, links, ink, line, highlights, extracted image, audio, video and every document', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    // Twelve kinds of content, a real upload of the whole project and a real import.
    test.setTimeout(600_000)
    const [student] = await students(1)
    await bootLive(app)
    const name = `Everything ${nameTag}`
    await workspaceWithPdf(app, name)
    await addEveryKindOfContent(app, page, name)
    const sent = await snapshotDb(page, RESTORED_STORES)
    for (const store of RICH_STORES) expect(sent[store]!.length, `${store} has content`).toBeGreaterThan(0)

    await sendCopy(app, teacher.name, [student])
    await arrived(student, name)
    const copy = await receivedCopy(student.page, name)
    // Every row of every store, every binary by SHA-256: equal once the copy's new ids are mapped.
    await expect(async () => expectSameAsSent(await snapshotDb(student.page, RESTORED_STORES), sent, copy.idMap, 'the student copy')).toPass({ timeout: 60_000 })
  })

  test('REG-914 an image extracted from a PDF and shared as a copy names the copy of its document as its source on the student\'s device', { tag: '@P3' }, async ({ app, page, teacher, students, nameTag }) => {
    knownDefect('DEF-507')
    const [student] = await students(1)
    await bootLive(app)
    const name = `Excerpt ${nameTag}`
    await workspaceWithPdf(app, name)
    await app.viewer.tool('extract-image').click()
    await app.viewer.dragOnPage(1, [0.1, 0.5], [0.5, 0.62])
    // The image card saves a moment after its file; leaving before it would lose it (DEF-509, REG-891).
    await settle(page, { mediaBlobs: 1, workspaceItems: 1 })
    await app.header.home.click()

    await sendCopy(app, teacher.name, [student])
    const copy = await arrived(student, name)
    await expect.poll(async () => (await readStore(student.page, 'workspaceItems')).length, { timeout: 30_000 }).toBe(1)
    const [doc] = (await readStore<{ id: string; projectId: string }>(student.page, 'documents')).filter((d) => d.projectId === copy.id)
    const [image] = await readStore<{ type: string; data: { sourceDocumentId?: string } }>(student.page, 'workspaceItems')
    expect(image.type).toBe('image')
    expect(image.data.sourceDocumentId, 'the image names the student\'s own copy of the PDF').toBe(doc.id)
  })

  test('REG-915 a copy carries only the documents left ticked in the Share dialog', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Chemistry ${nameTag}`
    await projectWithDocs(app, name, [FIND_PDF.payload(), SECOND_PDF.payload()])
    const kept = (await documentDigests(page)).find((d) => d.name === FIND_PDF.displayName)!

    await sendCopy(app, teacher.name, [student], [SECOND_PDF.displayName])
    const copy = await arrived(student, name)
    await expect.poll(async () => (await documentDigests(student.page)).filter((d) => d.projectId === copy.id).map((d) => ({ name: d.name, sha256: d.sha256 })), { timeout: 30_000 })
      .toEqual([{ name: kept.name, sha256: kept.sha256 }])
  })

  test('REG-916 the student\'s bell counts the new share until they open it, even after the copy is imported; opening it lists it from the teacher and marks it seen on the server', { tag: '@P1' }, async ({ app, teacher, students, nameTag }, testInfo) => {
    knownDefect('DEF-508')
    const [student] = await students(1)
    await bootLive(app)
    const name = `History ${nameTag}`
    await projectWithDocs(app, name, [FIND_PDF.payload()])

    await sendCopy(app, teacher.name, [student])
    const bell = new NotificationBellControl(student.page)
    await arrived(student, name)
    // Imported, but the student has opened nothing: it is still unseen. Sampled across two of the app's
    // 20-second inbox checks, since a count that clears on its own would do so on one of them.
    const timeline: string[] = []
    const state = async () => {
      const o = await pageGet<SharingOverview>(student.page, '/api/sharing/overview')
      const note = o.inbox.find((n) => n.title === name)
      const s = { bell: ((await bell.button.textContent()) ?? '').trim(), unseenCount: o.unseenCount, seen: note?.seen, imported: note?.imported }
      timeline.push(`${new Date().toISOString().slice(11, 19)} ${JSON.stringify(s)}`)
      return s
    }
    for (const until = Date.now() + 45_000; Date.now() < until;) {
      await state()
      await student.page.waitForTimeout(5_000)
    }
    const now = await state()
    testInfo.annotations.push({ type: 'timeline', description: timeline.join('\n') })
    expect(now, 'still unseen after the import').toEqual({ bell: '1', unseenCount: 1, seen: false, imported: true })
    await bell.button.click()
    await expect(bell.panel.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    await expect(bell.note(name)).toContainText(`Shared by ${teacher.name}`)
    await expect.poll(async () => (await pageGet<SharingOverview>(student.page, '/api/sharing/overview')).unseenCount, { timeout: 30_000, message: 'seen on the server' }).toBe(0)
    await expect(bell.button).toHaveText('')
  })

  test('REG-917 a received copy the student deletes from Home stays deleted: the next inbox checks and a reload do not bring it back', { tag: '@P2' }, async ({ app, teacher, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Geography ${nameTag}`
    await projectWithDocs(app, name, [FIND_PDF.payload()])
    await sendCopy(app, teacher.name, [student])
    await arrived(student, name)

    let checks = 0
    student.page.on('request', (r) => { if (r.url().endsWith('/api/sharing/overview')) checks++ })
    await student.app.home.deleteProject(name)
    await expect(student.app.home.emptyState).toBeVisible()
    await expect.poll(() => checks, { timeout: 90_000, message: 'two inbox checks after the delete' }).toBeGreaterThanOrEqual(2)
    expect((await projectRows(student.page)).filter((p) => p.name === name)).toEqual([])
    await student.app.reload()
    await student.app.home.reach()
    const after = checks
    await expect.poll(() => checks, { timeout: 90_000, message: 'an inbox check after the reload' }).toBeGreaterThan(after)
    expect((await projectRows(student.page)).filter((p) => p.name === name)).toEqual([])
  })

  test('REG-918 a second copy of the same project, now with another document, joins the student\'s existing copy and leaves the first document untouched', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const [student] = await students(1)
    await bootLive(app)
    const name = `Physics ${nameTag}`
    await projectWithDocs(app, name, [FIND_PDF.payload()])
    await sendCopy(app, teacher.name, [student])
    const copy = await arrived(student, name)
    const [first] = (await documentDigests(student.page)).filter((d) => d.projectId === copy.id)

    // The teacher adds a document and shares the project again.
    await app.home.reach()
    await app.home.openProject(name)
    await app.documents.uploadFiles(SECOND_PDF.payload())
    await app.viewer.expectDocumentOpen(SECOND_PDF.displayName, SECOND_PDF.pageCount)
    const second = (await documentDigests(page)).find((d) => d.name === SECOND_PDF.displayName)!
    await app.header.home.click()
    await sendCopy(app, teacher.name, [student])

    await expect.poll(async () => (await documentDigests(student.page)).length, { timeout: ARRIVAL, message: 'the second document arrived' }).toBe(2)
    expect((await projectRows(student.page)).filter((p) => p.name === name), 'still one copy').toHaveLength(1)
    const docs = await documentDigests(student.page)
    expect(docs.find((d) => d.name === FIND_PDF.displayName)).toEqual(first)
    expect(docs.find((d) => d.name === SECOND_PDF.displayName)).toMatchObject({ projectId: copy.id, sha256: second.sha256 })
  })

  test('REG-919 a class made on the real server with two students receives a copy shared to the class: each member gets it from the teacher', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }) => {
    const pair = await students(2)
    await bootLive(app)
    const name = `Algebra ${nameTag}`
    const className = `C${nameTag}`.slice(0, 20)
    await projectWithDocs(app, name, [FIND_PDF.payload()])
    const [teacherDoc] = await documentDigests(page)

    await createClass(app, teacher.name, className, pair)
    const lists = (await pageGet<SharingOverview>(page, '/api/sharing/overview')).broadcastLists.filter((l) => l.name === className)
    expect(lists).toHaveLength(1)
    expect([...(lists[0].memberIds ?? [])].sort()).toEqual(pair.map((s) => s.userId).sort())

    expect(await shareToClass(app, className, 'Copy'), 'what the teacher is told').toEqual({ button: 'Send a copy to 2', toast: 'Sent a copy to 2 people' })
    for (const student of pair) {
      const copy = await arrived(student, name)
      expect((await documentDigests(student.page)).filter((d) => d.projectId === copy.id).map((d) => d.sha256)).toEqual([teacherDoc.sha256])
      const note = (await pageGet<SharingOverview>(student.page, '/api/sharing/overview')).inbox.find((n) => n.title === name)
      expect(note, `${student.email}'s inbox`).toMatchObject({ fromUserId: teacher.userId })
    }
  })

  test('REG-920 a scanned PDF read by OCR on the teacher\'s device and shared as a copy can be searched by its scanned words on the student\'s device', { tag: '@P1' }, async ({ app, page, teacher, students, nameTag }, testInfo) => {
    // OCR reads each page in 10-15 s on an idle machine, on both devices.
    test.setTimeout(900_000)
    const [student] = await students(1)
    await bootLive(app)
    const name = `Scans ${nameTag}`
    const scan = await scannedPdf(page)
    await app.home.createProject(name)
    await app.documents.expectOpen(name)
    await app.documents.uploadFiles(scan.payload)
    await app.viewer.expectDocumentOpen(scan.displayName, scan.pageCount)
    const teacherDoc = await documentByName(page, scan.displayName)
    await waitForPages(page, teacherDoc.id, [1, 2, 3], 3 * OCR_PAGE_TIMEOUT)
    expect(wordsOf((await searchRows(page, teacherDoc.id))[1].text)).toContain('OCRCHARLIE')
    await app.header.home.click()

    await sendCopy(app, teacher.name, [student])
    await arrived(student, name)
    const studentDoc = await documentByName(student.page, scan.displayName)
    const textOnArrival = (await searchRows(student.page, studentDoc.id)).length
    testInfo.annotations.push({ type: 'observation', description: `${textOnArrival} OCR text rows were on the student's device on arrival (the text index is not part of a share and is rebuilt there)` })

    await student.app.home.openProject(name)
    await student.app.documents.openDocument(scan.displayName)
    await student.app.viewer.expectDocumentOpen(scan.displayName, scan.pageCount)
    await student.app.viewer.tool('find').click()
    await student.app.find.search('OCRCHARLIE')
    await expect(student.app.find.counter).toHaveText('1 of 1', { timeout: 3 * OCR_PAGE_TIMEOUT })
  })

  test('REG-921 a Free student is offered no Share anywhere on the real server: not in the workspace header, not on a project card, not in Select mode', { tag: '@P1' }, async ({ students, nameTag }) => {
    const [student] = await students(1)
    const { app, page } = student
    const name = `Own ${nameTag}`
    await projectWithDocs(app, name, [FIND_PDF.payload()])
    await app.home.openProject(name)
    await app.documents.openDocument(FIND_PDF.displayName)
    await app.viewer.expectDocumentOpen(FIND_PDF.displayName, FIND_PDF.pageCount)
    // The plan has been read from the real server by now.
    expect((await pageGet<SharingOverview>(page, '/api/sharing/overview')).canShare).toBe(false)
    await expect(page.getByRole('button', { name: 'Share this PDF — a copy, a live copy, or to a group' })).toHaveCount(0)

    await app.home.reach()
    await app.home.card(name).getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)
    await app.home.newProjectName.click() // closes the menu
    await app.home.selectMode.click()
    await app.home.card(name).click()
    await expect(page.getByText('1 selected').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)
  })
})
