/**
 * Regression: what reaches a recipient (components/sharing/board/ReceivedBoard.tsx,
 * LiveAutoSync.tsx auto-import, sharingService.importNote / autoImportReceivedNotes
 * / deleteInboxNote, restoreService 'shared' origin).
 *
 * Two browser contexts, two MuulOrigin identities, one stateful fake backend
 * (helpers/mocks/sharingBackend.ts): what the teacher's app uploads is what the
 * student's app downloads. Everything is mocked: this proves the app's side of
 * the contract only.
 */
import { test, expect, STUDENT, COLLEAGUE } from '../../fixtures/sharing.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { buildShareSnapshot, type SnapshotDoc } from '../../data/builders/shareSnapshot.js'
import { sha256, type SharingBackend } from '../../helpers/mocks/sharingBackend.js'
import { SharingScreen, ShareComposerDialog, NewGroupDialog } from '../../pages/SharingScreen.js'
import { documentDigests, localJson, projectRows, projectWithDocs, readSnapshot } from '../../helpers/sharingFlows.js'

test.describe('Received shares', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test('REG-100 a project shared to a class as a copy reaches the student\'s second account and lands in their projects intact', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, sharing, secondUser }) => {
    const student = await secondUser(STUDENT, 'free')
    await student.signIn()

    // Teacher: a project with one PDF, a class holding the student, a copy sent to the class.
    await projectWithDocs(app, 'Physics Notes', [FIND_PDF.payload()])
    const teacherDocs = await documentDigests(page)
    const teacherProject = (await projectRows(page))[0]
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Classes & people').click()
    await screen.newClass.click()
    const group = new NewGroupDialog(page)
    await group.name.fill('Physics 11')
    await group.search.fill(STUDENT.email)
    await group.resultRow(STUDENT.email).getByRole('button', { name: 'Add', exact: true }).click()
    await group.create.click()
    await expect(screen.managePanel('Physics 11')).toBeVisible()
    await screen.managePanel('Physics 11').getByRole('button', { name: 'Share to class' }).click()
    const composer = new ShareComposerDialog(page)
    await composer.expectOpen()
    // The only project is preselected (re-selecting it would be a no-op for a real user).
    await expect(composer.project).toHaveValue(teacherProject.id)
    await expect(composer.doc(FIND_PDF.displayName)).toBeChecked()
    await composer.how('Copy').click()
    await composer.sized()
    await composer.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')

    // What left the teacher's device: one class share carrying the whole project.
    const [sent] = sharing.callsTo('POST', /^\/api\/sharing\/lists\/[^/]+\/shares$/)
    expect(sent.path).toBe(`/api/sharing/lists/${sharing.listsOf('e2e-user-0001')[0].id}/shares`)
    expect(sent.form!.get('projectId')!.text).toBe(teacherProject.id)
    expect(sent.form!.get('title')!.text).toBe('Physics Notes')
    expect(JSON.parse(sent.form!.get('documentIds')!.text)).toEqual([teacherDocs[0].id])
    expect(JSON.parse(sent.form!.get('documents')!.text)).toEqual([{ id: teacherDocs[0].id, name: FIND_PDF.displayName }])
    const snap = readSnapshot(sent.form!.get('blob')!.data)
    expect(snap.manifest).toMatchObject({ appName: 'cognitive-canvas', type: 'single', projectIds: [teacherProject.id] })
    expect(snap.project).toMatchObject({ id: teacherProject.id, name: 'Physics Notes' })
    expect(snap.fileSha(`documents/${teacherDocs[0].id}/file.pdf`)).toBe(teacherDocs[0].sha256)

    // Student: it arrives on its own, as a new "shared" project with the same bytes.
    await student.app.toasts.expectShown('A note shared with you was added to your projects', 20_000)
    await expect(student.app.home.card('Physics Notes')).toBeVisible()
    const studentProjects = await projectRows(student.page)
    expect(studentProjects).toHaveLength(1)
    expect(studentProjects[0]).toMatchObject({ name: 'Physics Notes', sourceProjectId: teacherProject.id })
    expect(studentProjects[0].id).not.toBe(teacherProject.id) // a copy under its own id, never the sender's
    const studentDocs = await documentDigests(student.page)
    expect(studentDocs.map((d) => ({ name: d.name, sha256: d.sha256, projectId: d.projectId })))
      .toEqual([{ name: FIND_PDF.displayName, sha256: teacherDocs[0].sha256, projectId: studentProjects[0].id }])
    expect(studentProjects[0].sourceIdMap?.[teacherDocs[0].id]).toBe(studentDocs[0].id)
    expect(sharing.callsTo('GET', /\/inbox\/[^/]+\/download$/, STUDENT.sub)).toHaveLength(1)

    // And the student's Received tab shows it as imported, from the teacher.
    const studentScreen = new SharingScreen(student.page)
    await studentScreen.open('Sam Student')
    await expect(studentScreen.tab('Received')).toHaveAttribute('aria-current', 'page')
    const card = studentScreen.receivedCard('Physics Notes')
    await expect(card).toContainText('from Automation User')
    await expect(card).toContainText('Copy · in your projects')
    await expect(card.getByRole('button', { name: 'Open' })).toBeVisible()
    await expect.poll(() => sharing.inboxOf(STUDENT.sub)[0].seen).toBe(true)
  })

  test('REG-553 a copy shared with you is added to your projects on its own, once', { tag: ['@P1'] }, async ({ signedIn: app, page, sharing }) => {
    const pdf = FIND_PDF.payload().buffer
    const note = seedPack(sharing, 'Reading Pack', [{ id: 'tara-doc-a', name: 'chapter-a', pdf, pageCount: 4 }])
    await app.toasts.expectShown('A note shared with you was added to your projects', 20_000)
    await expect(app.home.card('Reading Pack')).toBeVisible()
    const [p] = await projectRows(page)
    expect(p).toMatchObject({ name: 'Reading Pack', sourceProjectId: 'p-tara-1' })
    const docs = await documentDigests(page)
    expect(docs.map((d) => [d.name, d.sha256, d.projectId])).toEqual([['chapter-a', sha256(pdf), p.id]])
    expect(await localJson(page, 'cc2_received_autoimported_v1')).toEqual([note.id])
    // Later polls do not import it again.
    const polled = sharing.callsTo('GET', '/api/sharing/overview').length
    await expect.poll(() => sharing.callsTo('GET', '/api/sharing/overview').length, { timeout: 15_000 }).toBeGreaterThan(polled + 1)
    expect(sharing.callsTo('GET', `/api/sharing/inbox/${note.id}/download`)).toHaveLength(1)
    expect(await projectRows(page)).toHaveLength(1)
  })

  test('REG-554 a received copy deleted from Home stays deleted', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    const note = seedPack(sharing, 'Reading Pack', [{ id: 'tara-doc-a', name: 'chapter-a', pdf: FIND_PDF.payload().buffer, pageCount: 4 }])
    await expect(app.home.card('Reading Pack')).toBeVisible({ timeout: 20_000 })
    await app.home.deleteProject('Reading Pack')
    await expect(app.home.emptyState).toBeVisible()
    const polled = sharing.callsTo('GET', '/api/sharing/overview').length
    await expect.poll(() => sharing.callsTo('GET', '/api/sharing/overview').length, { timeout: 15_000 }).toBeGreaterThan(polled + 1)
    expect(await projectRows(page)).toEqual([])
    expect(sharing.callsTo('GET', `/api/sharing/inbox/${note.id}/download`)).toHaveLength(1)
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Received').click()
    await expect(screen.receivedCard('Reading Pack')).toBeVisible()
    await expect(screen.receivedCard('Reading Pack').getByRole('button', { name: 'Open' })).toHaveCount(0)
  })

  test('REG-555 Import downloads a copy on request, and a copy that is already here is never duplicated', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    // The automatic import's download is held, so the person's own Import goes first.
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    let downloads = 0
    const note = seedPack(sharing, 'Reading Pack', [{ id: 'tara-doc-a', name: 'chapter-a', pdf: FIND_PDF.payload().buffer, pageCount: 4 }])
    sharing.override('GET', /^\/api\/sharing\/inbox\/[^/]+\/download$/, async () => {
      downloads += 1
      if (downloads === 1) await held
      return { body: note.zip, contentType: 'application/zip' }
    })
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Received').click()
    const card = screen.receivedCard('Reading Pack')
    await expect(card).toContainText('Copy · not imported yet')
    await expect.poll(() => downloads).toBe(1)
    await card.getByRole('button', { name: 'Import' }).click()
    await app.toasts.expectShown('“Reading Pack” is in your projects')
    expect(await projectRows(page)).toHaveLength(1)
    release()
    await expect.poll(() => localJson(page, 'cc2_received_autoimported_v1')).toEqual([note.id]) // the held import finished
    expect(downloads).toBe(2)
    expect(await projectRows(page)).toHaveLength(1) // ...and merged into the same project
    expect(await documentDigests(page)).toHaveLength(1)
  })

  test('REG-556 an import whose download fails says so and leaves the copy waiting', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    seedPack(sharing, 'Reading Pack', [{ id: 'tara-doc-a', name: 'chapter-a', pdf: FIND_PDF.payload().buffer, pageCount: 4 }])
    sharing.override('GET', /^\/api\/sharing\/inbox\/[^/]+\/download$/, { status: 500, json: { message: 'Download failed' } })
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Received').click()
    const card = screen.receivedCard('Reading Pack')
    await card.getByRole('button', { name: 'Import' }).click()
    await app.toasts.expectShown('Import failed — please try again')
    await expect(card).toContainText('Copy · not imported yet')
    expect(await projectRows(page)).toEqual([])
  })

  test('REG-557 a second share of the same project adds its new document to the copy already here, leaving the first untouched', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    const a = { id: 'tara-doc-a', name: 'chapter-a', pdf: FIND_PDF.payload().buffer, pageCount: 4 }
    const b = { id: 'tara-doc-b', name: 'chapter-b', pdf: SECOND_PDF.payload().buffer, pageCount: 1 }
    seedPack(sharing, 'Reading Pack', [a])
    await expect(app.home.card('Reading Pack')).toBeVisible({ timeout: 20_000 })
    const [before] = await documentDigests(page)
    seedPack(sharing, 'Reading Pack', [a, b])
    await expect.poll(async () => (await documentDigests(page)).length, { timeout: 20_000 }).toBe(2)
    const projects = await projectRows(page)
    expect(projects).toHaveLength(1)
    const after = await documentDigests(page)
    expect(after.find((d) => d.name === 'chapter-a')).toEqual(before)
    expect(after.find((d) => d.name === 'chapter-b')).toMatchObject({ projectId: projects[0].id, sha256: sha256(b.pdf) })
  })

  test('REG-558 deleting from Received asks first and keeps the imported project', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    const note = seedPack(sharing, 'Reading Pack', [{ id: 'tara-doc-a', name: 'chapter-a', pdf: FIND_PDF.payload().buffer, pageCount: 4 }])
    await expect(app.home.card('Reading Pack')).toBeVisible({ timeout: 20_000 })
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Received').click()
    const card = screen.receivedCard('Reading Pack')
    await expect(card).toContainText('Copy · in your projects')
    let message = ''
    page.once('dialog', (d) => { message = d.message(); void d.dismiss() })
    await screen.menu(card, 'Delete from Received…')
    await expect.poll(() => message).toBe('Delete “Reading Pack” from Received?\n\nIf you imported it, your project stays.')
    expect(sharing.callsTo('DELETE', `/api/sharing/inbox/${note.id}`)).toEqual([])
    page.once('dialog', (d) => void d.accept())
    await screen.menu(card, 'Delete from Received…')
    await app.toasts.expectShown('Removed')
    expect(sharing.callsTo('DELETE', `/api/sharing/inbox/${note.id}`)).toHaveLength(1)
    await expect(card).toHaveCount(0)
    expect(await projectRows(page)).toHaveLength(1)
  })

  test('REG-559 received shares are grouped by when they arrived, filtered by kind and found by title or sender', { tag: '@P3' }, async ({ signedIn: _app, page, sharing }) => {
    sharing.addPerson(COLLEAGUE, true)
    sharing.addPerson(STUDENT, false)
    const empty = { itemSummary: 'Project copy', icon: '📄', zip: Buffer.alloc(0) }
    sharing.seedCopy(COLLEAGUE.sub, ME, { title: 'Fresh Pack', projectId: 'p1', documentIds: ['x', 'y'], documents: [{ id: 'x', name: 'one' }, { id: 'y', name: 'two' }], ...empty, createdAt: Date.now() - 60_000 }, { imported: true, seen: true })
    sharing.seedCopy(STUDENT.sub, ME, { title: 'Week Pack', projectId: 'p2', documentIds: [], documents: [], ...empty, createdAt: Date.now() - 3 * 86_400_000 }, { imported: true, seen: true })
    sharing.seedCopy(COLLEAGUE.sub, ME, { title: 'Old Pack', projectId: 'p3', documentIds: [], documents: [], ...empty, createdAt: Date.now() - 20 * 86_400_000 }, { imported: true, seen: true })
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Received').click()
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Today', 'This week', 'Earlier'])
    await expect(screen.receivedCard('Fresh Pack')).toContainText('from Tara Teacher · 2 documents')
    for (const [f, n] of [['All', 3], ['Live', 0], ['Copies', 3]] as const) await expect(screen.filter(screen.receivedFilter, f)).toHaveAccessibleName(`${f} ${n}`)
    await screen.search.fill('tara')
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Today', 'Earlier'])
    await expect(screen.receivedCard('Week Pack')).toHaveCount(0)
    await screen.search.fill('week')
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['This week'])
    await screen.search.fill('')
    await screen.filter(screen.receivedFilter, 'Live').click()
    await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
  })
})

const ME = 'e2e-user-0001'
let packSeq = 0
/** A copy from Tara (a colleague) of her project p-tara-1, built as the app exports it. */
function seedPack(sharing: SharingBackend, title: string, docs: SnapshotDoc[]) {
  if (!sharing.people.has(COLLEAGUE.sub)) sharing.addPerson(COLLEAGUE, true)
  packSeq += 1
  return sharing.seedCopy(COLLEAGUE.sub, ME, {
    title, projectId: 'p-tara-1', documentIds: docs.map((d) => d.id), documents: docs.map((d) => ({ id: d.id, name: d.name })),
    itemSummary: 'Project copy', icon: '📄', zip: buildShareSnapshot({ id: 'p-tara-1', name: title }, docs), createdAt: Date.now() - 1000 * packSeq,
  })
}
