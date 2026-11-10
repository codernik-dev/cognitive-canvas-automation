/**
 * Regression: the one Share dialog (components/sharing/board/ShareComposer.tsx)
 * and its entry points: the Sharing screen's Share button, a class's "Share to
 * class", the home screen (card ⋯ Share, Select mode Share) and the workspace
 * header (LiveShareControl, not live yet).
 *
 * What the app SENDS is asserted from the stateful fake (multipart fields and
 * the snapshot ZIP, unpacked and compared byte for byte with the documents in
 * IndexedDB). Mocked backend: proves the app's side of the contract only.
 */
import { test, expect, STUDENT, STUDENT_2 } from '../../fixtures/sharing.js'
import { knownDefect } from '../../helpers/defects.js'
import { MUUL_API } from '../../helpers/mocks/muulAccount.js'
import { FIND_PDF, SECOND_PDF } from '../../data/files.js'
import { SharingScreen, ShareComposerDialog, NewGroupDialog, LiveHeader } from '../../pages/SharingScreen.js'
import { documentDigests, localJson, projectRows, projectWithDocs, readSnapshot } from '../../helpers/sharingFlows.js'

const TEACHER = 'e2e-user-0001'
const sendPaths = /^\/api\/sharing\/(threads\/[^/]+\/shares|lists\/[^/]+\/shares|live)$/

test.describe('Share dialog', { tag: ['@regression', '@sharing', '@api'] }, () => {
  test.beforeEach(({ sharing }) => {
    sharing.addPerson(STUDENT, false)
    sharing.addPerson(STUDENT_2, false)
  })

  test('REG-515 the Share dialog opens on the project with every document ticked, sized, Live by default, and Cancel sends nothing', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'Two Docs', [FIND_PDF.payload(), SECOND_PDF.payload()])
    const [project] = await projectRows(page)
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.expectOpen()
    await expect(c.project).toHaveValue(project.id)
    await expect(c.doc(FIND_PDF.displayName)).toBeChecked()
    await expect(c.doc(SECOND_PDF.displayName)).toBeChecked()
    await expect(c.dialog.getByText('4 pages')).toBeVisible()
    await expect(c.selectAll).toBeChecked()
    await expect(c.dialog.getByText('2 of 2 ticked')).toBeVisible()
    await c.sized()
    await expect(c.dialog.getByText(/^· 2 documents · \d+(\.\d)? KB$/)).toBeVisible()
    await expect(c.how('Live')).toHaveAttribute('aria-checked', 'true')
    await expect(c.dialog.getByText('Your later changes reach them automatically until you stop. Their own notes on it are kept.')).toBeVisible()
    await expect(c.send).toHaveText('Share live')
    await expect(c.dialog.getByText('Type a name or email to find someone.')).toBeVisible()
    await expect(c.dialog.getByText('Each sees it as a share from you. Nobody sees a class or each other.')).toBeVisible()

    // Unticking one document makes the row partial; unticking all empties the count.
    await c.doc(SECOND_PDF.displayName).uncheck()
    await expect(c.dialog.getByText('1 of 2 ticked')).toBeVisible()
    expect(await c.selectAll.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true)
    await c.selectAll.click()
    await expect(c.dialog.getByText('2 of 2 ticked')).toBeVisible()
    await c.selectAll.click()
    await expect(c.dialog.getByText('0 of 2 ticked')).toBeVisible()

    await c.how('Copy').click()
    await expect(c.dialog.getByText('They get today’s version. Later changes stay with you.')).toBeVisible()
    await expect(c.send).toHaveText('Send a copy')
    await c.cancel.click()
    await expect(c.dialog).toBeHidden()
    expect(sharing.callsTo('POST', sendPaths)).toEqual([])

    // The How choice is remembered on this device.
    expect(await page.evaluate(() => localStorage.getItem('cc2_share_how'))).toBe('copy')
    await screen.share.click()
    await expect(c.how('Copy')).toHaveAttribute('aria-checked', 'true')
  })

  test('REG-516 a copy sent to one person found by email uploads the whole project snapshot, lists it under Shares and is offered as "Same as last time"', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'Two Docs', [FIND_PDF.payload(), SECOND_PDF.payload()])
    const [project] = await projectRows(page)
    const docs = await documentDigests(page)
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.how('Copy').click()
    const chip = await c.findPerson(STUDENT.email, 'Sam Student')
    expect(sharing.callsTo('GET', '/api/iam/users/search').at(-1)!.query.get('q')).toBe(STUDENT.email)
    await chip.click()
    await expect(c.removeChip('Sam Student')).toBeVisible()
    await expect(c.dialog.getByText('To Sam Student')).toBeVisible()
    await c.sized()
    await expect(c.send).toHaveText('Send a copy to 1')
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')
    await expect(c.dialog).toBeHidden()

    const sent = sharing.callsTo('POST', sendPaths)
    expect(sent.map((x) => x.path)).toEqual([`/api/sharing/threads/${STUDENT.sub}/shares`])
    const f = sent[0].form!
    expect([...f.keys()]).toEqual(['projectId', 'title', 'itemSummary', 'icon', 'documentIds', 'documents', 'blob'])
    expect(f.get('projectId')!.text).toBe(project.id)
    expect(f.get('title')!.text).toBe('Two Docs')
    expect(f.get('itemSummary')!.text).toBe('Project copy')
    expect(f.get('icon')!.text).toBe('📄')
    const byName = (n: string) => docs.find((d) => d.name === n)!
    const ids = [byName(FIND_PDF.displayName).id, byName(SECOND_PDF.displayName).id]
    expect(new Set(JSON.parse(f.get('documentIds')!.text) as string[])).toEqual(new Set(ids))
    expect(f.get('blob')!).toMatchObject({ filename: 'snapshot.zip', contentType: 'application/zip' })
    const snap = readSnapshot(f.get('blob')!.data)
    expect(snap.project).toMatchObject({ id: project.id, name: 'Two Docs' })
    expect(new Set(snap.docIds)).toEqual(new Set(ids))
    for (const d of docs) expect(snap.fileSha(`documents/${d.id}/file.pdf`), d.name).toBe(d.sha256)
    for (const store of ['workspaceItems', 'highlights', 'itemLinks', 'areaLinks', 'canvasStrokes']) expect(snap.names).toContain(`data/${store}.json`)

    // The server delivered it to Sam, from the teacher, and the sender's thread records it.
    expect(sharing.inboxOf(STUDENT.sub).map((n) => ({ from: n.fromUserId, title: n.title }))).toEqual([{ from: TEACHER, title: 'Two Docs' }])
    expect(sharing.inboxOf(STUDENT_2.sub)).toEqual([])
    await expect(screen.tab('Shares')).toHaveAccessibleName('Shares 1')
    const card = screen.shareCard('Two Docs')
    await expect(card).toHaveAccessibleName('Two Docs — Copy · sent once')
    await expect(card).toContainText('Sam Student · 2 documents')
    expect(await localJson<string[]>(page, `cc2_recent_people_v1__${TEACHER}`)).toEqual([STUDENT.sub])

    // Next time, the same audience is one press away.
    await screen.share.click()
    const again = c.dialog.getByRole('button', { name: 'Same as last time: Sam Student' })
    await again.click()
    await expect(c.removeChip('Sam Student')).toBeVisible()
    await expect(again).toBeHidden()
  })

  test('REG-517 only the ticked documents are packed into the share', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'Two Docs', [FIND_PDF.payload(), SECOND_PDF.payload()])
    const docs = await documentDigests(page)
    const keep = docs.find((d) => d.name === FIND_PDF.displayName)!
    const drop = docs.find((d) => d.name === SECOND_PDF.displayName)!
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.how('Copy').click()
    await c.doc(SECOND_PDF.displayName).uncheck()
    await expect(c.dialog.getByText('1 of 2 ticked')).toBeVisible()
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    await expect(c.dialog.getByText(/^· 1 document · /)).toBeVisible()
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')

    const [sent] = sharing.callsTo('POST', sendPaths)
    expect(JSON.parse(sent.form!.get('documentIds')!.text)).toEqual([keep.id])
    expect(JSON.parse(sent.form!.get('documents')!.text)).toEqual([{ id: keep.id, name: FIND_PDF.displayName }])
    const snap = readSnapshot(sent.form!.get('blob')!.data)
    expect(snap.docIds).toEqual([keep.id])
    expect(snap.names.some((n) => n.includes(drop.id))).toBe(false)
    expect(snap.fileSha(`documents/${keep.id}/file.pdf`)).toBe(keep.sha256)
    await expect(screen.shareCard('Two Docs')).toContainText(`Sam Student · ${FIND_PDF.displayName}`)
  })

  test('REG-518 pressing Share with a step unanswered points at that step and sends nothing', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'Two Docs', [FIND_PDF.payload(), SECOND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.how('Copy').click()
    await c.sized()
    await c.send.click()
    await expect(c.alert('Choose at least one class or person to share with.')).toBeVisible()
    await expect(c.to).toBeFocused()

    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await expect(c.alert('Choose at least one class or person to share with.')).toBeHidden()
    await c.selectAll.click() // untick every document
    await expect(c.dialog.getByText('0 of 2 ticked')).toBeVisible()
    await c.send.click()
    await expect(c.alert('Tick at least one document to share.')).toBeVisible()
    await expect(c.dialog).toBeVisible()
    expect(sharing.callsTo('POST', sendPaths)).toEqual([])
  })

  test('REG-519 the people search says when it is searching and when nobody matches; Enter adds the top class or person, and chips can be removed', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    sharing.seedList(TEACHER, 'Chemistry', [STUDENT_2.sub])
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await expect(c.dialog.getByText('Classes · 1', { exact: true })).toBeVisible()
    await expect(c.suggestion('Chemistry')).toContainText('Chemistry· 1')

    await c.to.fill('n')
    await expect(c.dialog.getByText('Type a name or email to find someone.')).toBeVisible()
    await c.to.fill('nobody.here@example.invalid')
    await expect(c.dialog.getByText('No one found for “nobody.here@example.invalid”.')).toBeVisible()

    // Enter: a matching class first...
    await c.to.fill('chem')
    await c.to.press('Enter')
    await expect(c.removeChip('Chemistry')).toBeVisible()
    await expect(c.to).toHaveValue('')
    // ...then the top person match, once the search has answered.
    await c.findPerson('sam.', 'Sam Student')
    await c.to.press('Enter')
    await expect(c.removeChip('Sam Student')).toBeVisible()
    await expect(c.dialog.getByText(/^· 2 people$/)).toBeVisible()
    await expect(c.dialog.getByText('To Chemistry, Sam Student')).toBeVisible()

    await c.removeChip('Chemistry').click()
    await expect(c.removeChip('Chemistry')).toBeHidden()
    await expect(c.dialog.getByText(/^· 1 person$/)).toBeVisible()

    // A person already reached through a chosen class is taken off the people list, with a word why.
    await c.findPerson(STUDENT_2.email, 'Riya Reader')
    await c.to.press('Enter')
    await expect(c.removeChip('Riya Reader')).toBeVisible()
    await c.to.fill('')
    await c.suggestion('Chemistry').click()
    await app.toasts.expectShown('Already in Chemistry, so taken off the people list: Riya Reader')
    await expect(c.removeChip('Riya Reader')).toBeHidden()
    await expect(c.dialog.getByText(/^· 2 people$/)).toBeVisible()
  })

  test('REG-520 a rate-limited people search says to wait instead of claiming nobody was found', { tag: '@P3' }, async ({ signedIn: app, page, sharing }) => {
    knownDefect('DEF-501')
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    sharing.searchRateLimitSeconds = 12
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.to.fill(STUDENT.email)
    await expect.poll(() => sharing.callsTo('GET', '/api/iam/users/search').map((x) => x.status)).toContain(429)
    await expect(c.dialog.getByText('Searching too fast — try again in 12 seconds.')).toBeVisible()
    await expect(c.dialog.getByText(`No one found for “${STUDENT.email}”.`)).toBeHidden()
  })

  test('REG-521 a copy sent to a class reaches every member as a share from the teacher', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    const list = sharing.seedList(TEACHER, 'Physics 11', [STUDENT.sub, STUDENT_2.sub])
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    const [doc] = await documentDigests(page)
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Classes & people').click()
    await screen.classCard('Physics 11').getByRole('button', { name: 'Share to class' }).click()
    const c = new ShareComposerDialog(page)
    await expect(c.removeChip('Physics 11')).toBeVisible()
    await expect(c.dialog.getByText(/^· 2 people$/)).toBeVisible()
    await c.how('Copy').click()
    await c.sized()
    await expect(c.send).toHaveText('Send a copy to 2')
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 2 people')

    const sent = sharing.callsTo('POST', sendPaths)
    expect(sent.map((x) => x.path)).toEqual([`/api/sharing/lists/${list.id}/shares`])
    expect(readSnapshot(sent[0].form!.get('blob')!.data).fileSha(`documents/${doc.id}/file.pdf`)).toBe(doc.sha256)
    for (const s of [STUDENT, STUDENT_2]) {
      expect(sharing.inboxOf(s.sub).map((n) => [n.fromUserId, n.title]), s.email).toEqual([[TEACHER, 'One Doc']])
    }
    await expect(screen.classCard('Physics 11')).toContainText('1 copy sent')
    await screen.tab('Shares').click()
    await expect(screen.shareCard('One Doc')).toHaveAccessibleName('One Doc — Copy · sent to 2 people')
  })

  test('REG-522 sharing live to a class creates one live share linked to the class, listed as Live under Shares', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, sharing }) => {
    const list = sharing.seedList(TEACHER, 'Physics 11', [STUDENT.sub, STUDENT_2.sub])
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    const [project] = await projectRows(page)
    const [doc] = await documentDigests(page)
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Classes & people').click()
    await screen.classCard('Physics 11').getByRole('button', { name: 'Share to class' }).click()
    const c = new ShareComposerDialog(page)
    await expect(c.how('Live')).toHaveAttribute('aria-checked', 'true')
    await c.sized()
    await expect(c.send).toHaveText('Share live with 2')
    await c.send.click()
    await app.toasts.expectShown('Shared live with 2 people — your changes will reach them automatically')

    const [go] = sharing.callsTo('POST', sendPaths)
    expect(go.path).toBe('/api/sharing/live')
    const f = go.form!
    expect([...f.keys()]).toEqual(['projectId', 'title', 'recipientIds', 'documentIds', 'listId', 'blob'])
    expect(f.get('projectId')!.text).toBe(project.id)
    expect(JSON.parse(f.get('recipientIds')!.text)).toEqual([STUDENT.sub, STUDENT_2.sub])
    expect(JSON.parse(f.get('documentIds')!.text)).toEqual([doc.id])
    expect(f.get('listId')!.text).toBe(list.id)
    expect(f.get('blob')!.filename).toBe('live.zip')
    expect(readSnapshot(f.get('blob')!.data).fileSha(`documents/${doc.id}/file.pdf`)).toBe(doc.sha256)

    const share = sharing.liveOf(TEACHER)[0]
    expect(share).toMatchObject({ listIds: [list.id], recipientIds: [STUDENT.sub, STUDENT_2.sub], stopped: false })
    const reg = await localJson<Record<string, { shareId: string; projectId: string; listId?: string; recipientIds: string[] }>>(page, 'cc2_live_owner_v1')
    expect(Object.values(reg!)).toEqual([expect.objectContaining({ shareId: share.shareId, projectId: project.id, recipientIds: [STUDENT.sub, STUDENT_2.sub] })])
    expect(await localJson(page, 'cc2_list_live_v1')).toEqual({ [list.id]: [share.shareId] })
    await expect(screen.classCard('Physics 11')).toContainText('1 live share')
    await screen.tab('Shares').click()
    await expect(screen.shareCard('One Doc')).toHaveAccessibleName('One Doc — Live · 2 people')
    await expect(screen.shareCard('One Doc')).toContainText('Physics 11')
    // Home shows the project as live, with its recipients.
    await screen.back.click()
    await expect(app.home.card('One Doc').getByRole('button', { name: 'This PDF is Live — manage recipients' })).toHaveText('Live · 2')
  })

  test('REG-945 a class shared live straight after it is made reaches every member, even when one of the app\'s regular checks was already on its way', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    knownDefect('DEF-515')
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.tab('Classes & people').click()
    await screen.newClass.click()
    const g = new NewGroupDialog(page)
    await g.name.fill('Physics 11')
    for (const s of [STUDENT, STUDENT_2]) {
      await g.search.fill(s.email)
      await g.resultRow(s.email).getByRole('button', { name: 'Add', exact: true }).click()
    }
    // The order of events on the real server (2026-11-09, every run): the class was still being saved when
    // the app's regular 3-second check of the sharing overview went out, and the app's refresh after saving
    // took that check's answer instead of asking again. Here the save is held until that check is on its way.
    const save = sharing.hold('POST', /^\/api\/sharing\/lists$/)
    await g.create.click()
    await save.reached
    const check = sharing.hold('GET', /^\/api\/sharing\/overview$/)
    await check.reached
    save.release()
    await expect.poll(() => sharing.callsTo('POST', '/api/sharing/lists').map((c) => (c.json as { memberIds: string[] }).memberIds)).toEqual([[STUDENT.sub, STUDENT_2.sub]])
    // That check left before the save finished: the real server answered it with the class holding its first
    // member only. Only that check gets this answer; any read the app sends after the save gets the full class.
    const o = sharing.overview(TEACHER)
    check.release({ json: { ...o, broadcastLists: o.broadcastLists.map((l) => (l.name === 'Physics 11' ? { ...l, memberIds: l.memberIds.slice(0, 1) } : l)) } })
    await app.toasts.expectShown('Class “Physics 11” created')
    expect(sharing.listsOf(TEACHER).map((l) => l.memberIds), 'the class on the server').toEqual([[STUDENT.sub, STUDENT_2.sub]])

    // Straight away, as a teacher does: Share to class, live. What is shown is read once, not waited for:
    // waiting would give the app's 20-second refresh time to correct it, which a teacher does not wait for.
    const manage = screen.managePanel('Physics 11')
    await expect(manage).toBeVisible()
    expect.soft(await manage.innerText(), 'what the teacher is shown of the new class').toContain('2 people · 0 live shares')
    await manage.getByRole('button', { name: 'Share to class' }).click()
    const c = new ShareComposerDialog(page)
    await c.expectOpen()
    await c.how('Live').click()
    await c.sized()
    expect.soft((await c.send.textContent())?.trim(), 'the Share button').toBe('Share live with 2')
    await c.send.click()
    await app.toasts.expectShown(/^Shared live with \d+ (person|people) — your changes will reach them automatically$/)
    expect(sharing.liveOf(TEACHER).map((s) => s.recipientIds), 'who the live share reaches').toEqual([[STUDENT.sub, STUDENT_2.sub]])
  })

  test('REG-523 "+ New class" in the Share dialog creates the class on the server and ticks it, taking its members off the people list', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await expect(c.removeChip('Sam Student')).toBeVisible()
    await c.newClass.click()
    const g = new NewGroupDialog(page)
    await g.name.fill('Biology')
    await g.colour('Indigo').click()
    await g.search.fill(STUDENT.email)
    await g.resultRow(STUDENT.email).getByRole('button', { name: 'Add', exact: true }).click()
    await expect(g.resultRow(STUDENT.email).getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
    await g.create.click()
    await app.toasts.expectShown('Class “Biology” created')
    await expect(g.dialog).toBeHidden()

    expect(sharing.callsTo('POST', '/api/sharing/lists')[0].json).toEqual({ name: 'Biology', colorKey: 'indigo', memberIds: [STUDENT.sub] })
    expect(sharing.listsOf(TEACHER).map((l) => [l.name, l.memberIds])).toEqual([['Biology', [STUDENT.sub]]])
    await expect(c.removeChip('Biology')).toBeVisible()
    await expect(c.removeChip('Sam Student')).toBeHidden()
    await expect(c.dialog.getByText(/^· 1 person$/)).toBeVisible()
  })

  test('REG-524 several projects ticked on Home go out whole, each as its own share; an empty project is left out', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'Alpha Project', [FIND_PDF.payload()])
    await projectWithDocs(app, 'Beta Project', [SECOND_PDF.payload()])
    await projectWithDocs(app, 'Empty Project', [])
    const projects = await projectRows(page)
    const idOf = (n: string) => projects.find((p) => p.name === n)!.id
    await app.home.selectMode.click()
    await app.home.card('Alpha Project').click()
    await app.home.card('Beta Project').click()
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    const c = new ShareComposerDialog(page)
    await c.expectOpen()
    await expect(c.dialog.getByText('Each project is shared whole, as its own share.')).toBeVisible()
    await expect(c.dialog.getByRole('checkbox', { name: 'Alpha Project' })).toBeChecked()
    await expect(c.dialog.getByRole('checkbox', { name: 'Beta Project' })).toBeChecked()
    await expect(c.dialog.getByRole('checkbox', { name: 'Empty Project' })).not.toBeChecked()
    await expect(c.dialog.getByText('No documents — left out')).toBeVisible()
    await expect(c.dialog.getByText('2 of 3 ticked')).toBeVisible()
    await expect(c.to).toBeFocused()
    await c.how('Copy').click()
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    await expect(c.dialog.getByText(/^· 2 projects · 2 documents · /)).toBeVisible()
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')

    const sent = sharing.callsTo('POST', sendPaths)
    expect(sent.map((x) => x.path)).toEqual([`/api/sharing/threads/${STUDENT.sub}/shares`, `/api/sharing/threads/${STUDENT.sub}/shares`])
    // One share per project. The app sends them in its project-list order, which is
    // not a promised order (it follows storage order after a refresh), so compare as a set.
    expect(sent.map((x) => [x.form!.get('projectId')!.text, readSnapshot(x.form!.get('blob')!.data).project.name]).sort((a, b) => a[1].localeCompare(b[1])))
      .toEqual([[idOf('Alpha Project'), 'Alpha Project'], [idOf('Beta Project'), 'Beta Project']])
    expect(sharing.inboxOf(STUDENT.sub).map((n) => n.title).sort()).toEqual(['Alpha Project', 'Beta Project'])
    await expect(app.home.selectMode).toBeVisible() // select mode ended
  })

  test('REG-525 a project card\'s Share opens the dialog on that project with the cursor in To', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await projectWithDocs(app, 'Alpha Project', [FIND_PDF.payload()])
    await projectWithDocs(app, 'Beta Project', [SECOND_PDF.payload()])
    const beta = (await projectRows(page)).find((p) => p.name === 'Beta Project')!
    await app.home.cardAction('Beta Project', 'Share')
    const c = new ShareComposerDialog(page)
    await c.expectOpen()
    await expect(c.project).toHaveValue(beta.id)
    await expect(c.doc(SECOND_PDF.displayName)).toBeChecked()
    await expect(c.doc(FIND_PDF.displayName)).toHaveCount(0)
    await expect(c.to).toBeFocused()
    await expect(c.severalProjects).toBeVisible()
  })

  test('REG-526 a send the server refuses says why, keeps the dialog open, and records nothing', { tag: '@P1' }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    sharing.override('POST', /^\/api\/sharing\/threads\/[^/]+\/shares$/, { status: 500, json: { message: 'Share storage is unavailable' } }, 1)
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.how('Copy').click()
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown('Couldn’t share — Sam Student: Share storage is unavailable')
    await expect(c.dialog).toBeVisible()
    await expect(c.send).toBeEnabled()
    expect(sharing.inboxOf(STUDENT.sub)).toEqual([])
    await c.cancel.click()
    await expect(screen.tab('Shares')).toHaveAccessibleName('Shares 0')

    // The retry goes through.
    await screen.share.click()
    await expect(c.dialog.getByRole('button', { name: /^Same as last time/ })).toHaveCount(0) // nothing succeeded yet
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')
    expect(sharing.inboxOf(STUDENT.sub)).toHaveLength(1)
  })

  test('REG-527 a share larger than the server accepts is refused before anything is uploaded', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    sharing.capabilities = { maxUploadBytes: 4096, chunkedUpload: false, maxChunkBytes: 0, applicationMaxBytes: 0, liveFiles: false }
    await projectWithDocs(app, 'Two Docs', [FIND_PDF.payload(), SECOND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.how('Copy').click()
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await expect(c.alert(/^This share is [\d.]+ KB; shares over 0\.00390625 MB can’t be sent yet\. Remove a document or share them separately\.$/)).toBeVisible()
    await expect(c.send).toBeDisabled()
    expect(sharing.callsTo('POST', sendPaths)).toEqual([])
  })

  test('REG-528 the workspace header Share opens the same dialog with the open project and all its documents', { tag: '@P2' }, async ({ pdfOpen: _app, page }) => {
    const [project] = await projectRows(page)
    const header = new LiveHeader(page)
    await header.shareButton.click()
    const c = new ShareComposerDialog(page)
    await c.expectOpen()
    await expect(c.project).toHaveValue(project.id)
    await expect(c.doc(FIND_PDF.displayName)).toBeChecked()
    await expect(c.to).toBeFocused()
  })

  test('REG-529 documents already live to the chosen people are left out, and a send with nothing new says so', { tag: '@P2' }, async ({ signedIn: app, page, sharing }) => {
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown('Shared live with 1 person — your changes will reach them automatically')
    expect(sharing.callsTo('POST', '/api/sharing/live')).toHaveLength(1)

    await screen.share.click()
    await c.dialog.getByRole('button', { name: 'Same as last time: Sam Student' }).click()
    await expect(c.dialog.getByText('4 pages · already live to Sam Student — left out for them')).toBeVisible()
    await c.sized()
    await c.send.click()
    await app.toasts.expectShown('Everything you picked is already live to those people')
    expect(sharing.callsTo('POST', '/api/sharing/live')).toHaveLength(1)
  })

  test('REG-581 a copy sent while offline says to check the connection, and goes through once back online', { tag: '@P2' }, async ({ signedIn: app, page, context, sharing }) => {
    await projectWithDocs(app, 'One Doc', [FIND_PDF.payload()])
    const screen = new SharingScreen(page)
    await screen.open()
    await screen.share.click()
    const c = new ShareComposerDialog(page)
    await c.how('Copy').click()
    await (await c.findPerson(STUDENT.email, 'Sam Student')).click()
    await c.sized()
    // Offline: navigator.onLine goes false, and the upload dies without an answer
    // (routed requests are not cut by offline emulation, so the route aborts it).
    await context.setOffline(true)
    const upload = (url: URL) => url.origin === MUUL_API && /^\/api\/sharing\/threads\/[^/]+\/shares$/.test(url.pathname)
    await page.route(upload, (route) => route.abort('internetdisconnected'))
    await c.send.click()
    await app.toasts.expectShown('Couldn’t share — Sam Student: The upload could not reach the server. Check your connection and try again.')
    await expect(c.dialog).toBeVisible()
    expect(sharing.inboxOf(STUDENT.sub)).toEqual([])
    await page.unroute(upload)
    await context.setOffline(false)
    await c.send.click()
    await app.toasts.expectShown('Sent a copy to 1 person')
    expect(sharing.inboxOf(STUDENT.sub)).toHaveLength(1)
  })
})
