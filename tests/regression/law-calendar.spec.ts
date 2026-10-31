/**
 * Regression: the Legal layout's court diary (LawCalendar, LawEventModal)
 * and due-date reminders (LawEventReminder). Entries are account-level rows
 * in IndexedDB `lawEvents` {id, userId, date (local midnight), title, note?,
 * time?, color, status 'pending'|'done', createdAt}.
 *
 * The page clock is installed at Tue 10 March 2026, 09:00 UTC (the suite runs
 * in UTC) and then flows normally, so "today" and every date label are fixed.
 * Reminders cover pending entries due within 3 days and are loaded once per
 * visit (page load); page.clock moves the date for the due-date checks.
 */
import { test, expect } from '../../fixtures/content.js'
import { LawCalendarDialog, LawDayDialog, LawReminder, EVENT_COLOURS } from '../../pages/ContentLaw.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import type { Page } from '@playwright/test'

interface LawEventRow { id: string; userId: string; date: number; title: string; note?: string; time?: string; color: string; status: 'pending' | 'done'; createdAt: number }
const events = (page: Page) => readStore<LawEventRow>(page, 'lawEvents')
const midnight = (day: number) => Date.UTC(2026, 2, day)
const LABEL: Record<number, string> = {
  10: 'Tuesday, March 10, 2026', 11: 'Wednesday, March 11, 2026', 12: 'Thursday, March 12, 2026',
  15: 'Sunday, March 15, 2026', 20: 'Friday, March 20, 2026',
}

/** Open the calendar, open `day`, add the entry, close both dialogs. */
async function addEntry(page: Page, day: number, entry: Parameters<LawDayDialog['addEntry']>[0]) {
  const calendar = new LawCalendarDialog(page)
  await calendar.openIt()
  await calendar.day(day).click()
  const editor = new LawDayDialog(page, LABEL[day])
  await editor.addEntry(entry)
  await editor.close.click()
  await expect(editor.dialog).toBeHidden()
  await calendar.close.click()
  await expect(calendar.dialog).toBeHidden()
}

test.use({ lawMode: true, clockAt: new Date('2026-03-10T09:00:00Z') })

test.describe('Law calendar', { tag: ['@regression', '@law'] }, () => {
  test('REG-779 the calendar opens on the current month with today marked, steps through months, and Today comes back', { tag: '@P2' }, async ({ signedIn: _app, page }) => {
    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    await expect(calendar.month).toHaveText('March 2026')
    await expect(calendar.dialog.getByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    await expect(calendar.day(31)).toBeVisible()
    await expect(calendar.day(10)).toHaveClass(/border-primary-500/)
    await expect(calendar.day(11)).not.toHaveClass(/border-primary-500/)
    await expect(calendar.hint).toBeVisible()

    await calendar.next.click()
    await expect(calendar.month).toHaveText('April 2026')
    await expect(calendar.day(31)).toHaveCount(0)
    await calendar.previous.click()
    await calendar.previous.click()
    await expect(calendar.month).toHaveText('February 2026')
    await expect(calendar.day(29)).toHaveCount(0)
    await calendar.today.click()
    await expect(calendar.month).toHaveText('March 2026')

    // Reopening always starts on the current month.
    await calendar.next.click()
    await calendar.close.click()
    await calendar.openIt()
    await expect(calendar.month).toHaveText('March 2026')
  })

  test('REG-780 the calendar reaches ten years either way and no further', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    // 120 months each way, pressed from the keyboard (Enter on the focused button) to keep it quick.
    await calendar.next.focus()
    for (let i = 0; i < 119; i++) await page.keyboard.press('Enter')
    await expect(calendar.month).toHaveText('February 2036')
    await expect(calendar.next).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(calendar.month).toHaveText('March 2036')
    await expect(calendar.next).toBeDisabled()
    await calendar.today.click()
    await calendar.previous.focus()
    for (let i = 0; i < 120; i++) await page.keyboard.press('Enter')
    await expect(calendar.month).toHaveText('March 2016')
    await expect(calendar.previous).toBeDisabled()
  })

  test('REG-781 adding an entry stores it in lawEvents and puts a dot of its colour on that day', { tag: ['@P2', '@sanity'] }, async ({ signedIn: _app, page }) => {
    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    await calendar.day(15).click()
    const editor = new LawDayDialog(page, LABEL[15])
    await expect(editor.formHeading).toHaveText('Add entry')
    await expect(editor.title).toBeFocused()
    await expect(editor.add).toBeDisabled()
    await editor.title.fill('   ')
    await expect(editor.add).toBeDisabled()

    await editor.addEntry({ title: 'Hearing — Sharma v. State', time: '10:30', colour: 'Violet', note: 'Court 4, bring exhibits' })
    await expect(editor.entry('Hearing — Sharma v. State')).toContainText('10:30 · Court 4, bring exhibits')
    await expect(editor.title).toHaveValue('')

    // Enter in the title adds too; with no time it is "All day", in the default red.
    await editor.title.fill('File rejoinder')
    await editor.title.press('Enter')
    await expect(editor.entry('File rejoinder')).toContainText('All day')

    const [user] = await readStore<{ id: string }>(page, 'users')
    await expectStoreCount(page, 'lawEvents', 2)
    const rows = (await events(page)).sort((a, b) => a.title.localeCompare(b.title))
    expect(rows[0]).toMatchObject({ userId: user.id, date: midnight(15), title: 'File rejoinder', color: EVENT_COLOURS.Red, status: 'pending' })
    expect(rows[0].time).toBeUndefined()
    expect(rows[0].note).toBeUndefined()
    expect(rows[1]).toMatchObject({ userId: user.id, date: midnight(15), title: 'Hearing — Sharma v. State', time: '10:30', note: 'Court 4, bring exhibits', color: EVENT_COLOURS.Violet, status: 'pending' })

    await editor.close.click()
    await expect(calendar.dots(15)).toHaveCount(2)
    const colours = await calendar.dots(15).evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
    expect(colours.sort()).toEqual(['rgb(139, 92, 246)', 'rgb(239, 68, 68)'])
    await expect(calendar.dots(14)).toHaveCount(0)
  })

  test('REG-782 editing an entry updates it in place, and Cancel edit leaves it as it was', { tag: '@P2' }, async ({ signedIn: _app, page }) => {
    await addEntry(page, 15, { title: 'Hearing — Sharma v. State', time: '10:30', colour: 'Blue', note: 'Court 4' })
    const [original] = await events(page)
    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    await calendar.day(15).click()
    const editor = new LawDayDialog(page, LABEL[15])

    await editor.entry('Hearing — Sharma v. State').getByRole('button', { name: 'Edit' }).click()
    await expect(editor.formHeading).toHaveText('Edit entry')
    await expect(editor.title).toHaveValue('Hearing — Sharma v. State')
    await expect(editor.time).toHaveValue('10:30')
    await expect(editor.note).toHaveValue('Court 4')
    await editor.title.fill('Something else')
    await editor.cancelEdit.click()
    await expect(editor.formHeading).toHaveText('Add entry')
    await expect(editor.title).toHaveValue('')
    expect((await events(page))[0].title).toBe('Hearing — Sharma v. State')

    await editor.entry('Hearing — Sharma v. State').getByRole('button', { name: 'Edit' }).click()
    await editor.title.fill('Hearing adjourned — Sharma v. State')
    await editor.time.fill('14:00')
    await editor.colour('Amber').click()
    await editor.note.fill('')
    await editor.update.click()
    await expect(editor.entry('Hearing adjourned — Sharma v. State')).toContainText('14:00')
    await expect(editor.entries).toHaveCount(1)

    await expect.poll(async () => (await events(page))[0]?.title).toBe('Hearing adjourned — Sharma v. State')
    const rows = await events(page)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, date: midnight(15), time: '14:00', color: EVENT_COLOURS.Amber, status: 'pending' })
    expect(rows[0].note).toBeUndefined()
  })

  test('REG-783 marking an entry done strikes it through and stores it; marking it pending again reverts', { tag: '@P2' }, async ({ signedIn: _app, page }) => {
    await addEntry(page, 15, { title: 'Pay court fee' })
    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    await calendar.day(15).click()
    const editor = new LawDayDialog(page, LABEL[15])
    const row = editor.entry('Pay court fee')
    await row.getByRole('button', { name: 'Mark as done' }).click()
    await expect(row.getByRole('button', { name: 'Mark as pending' })).toBeVisible()
    await expect(row.getByText('Pay court fee', { exact: true })).toHaveClass(/line-through/)
    await expect.poll(async () => (await events(page))[0].status).toBe('done')

    await row.getByRole('button', { name: 'Mark as pending' }).click()
    await expect(row.getByRole('button', { name: 'Mark as done' })).toBeVisible()
    await expect(row.getByText('Pay court fee', { exact: true })).not.toHaveClass(/line-through/)
    await expect.poll(async () => (await events(page))[0].status).toBe('pending')
  })

  test('REG-784 deleting an entry removes it from the day and from storage, leaving the others', { tag: '@P2' }, async ({ signedIn: _app, page }) => {
    await addEntry(page, 15, { title: 'Keep me' })
    await addEntry(page, 15, { title: 'Delete me' })
    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    await calendar.day(15).click()
    const editor = new LawDayDialog(page, LABEL[15])
    await expect(editor.entries).toHaveCount(2)
    await editor.entry('Delete me').getByRole('button', { name: 'Delete' }).click()
    await expect(editor.entry('Delete me')).toHaveCount(0)
    await expect(editor.entries).toHaveCount(1)
    await expectStoreCount(page, 'lawEvents', 1)
    expect((await events(page)).map((e) => e.title)).toEqual(['Keep me'])
    await editor.close.click()
    await expect(calendar.dots(15)).toHaveCount(1)
  })

  test('REG-785 entries survive a reload, belong to the account (not a project), and the day editor closes only by its button', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    await addEntry(page, 20, { title: 'Filing deadline', colour: 'Green' })
    await app.home.createProject('Matter One')
    await app.documents.expectOpen('Matter One')
    await app.reload()
    await app.documents.expectOpen('Matter One')

    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    await expect(calendar.dots(20)).toHaveCount(1)
    await calendar.day(20).click()
    const editor = new LawDayDialog(page, LABEL[20])
    await expect(editor.entry('Filing deadline')).toBeVisible()
    // Persistent: Escape is refused.
    await page.keyboard.press('Escape')
    await expect(editor.dialog).toBeVisible()
    await editor.close.click()
    await expect(editor.dialog).toBeHidden()
    expect((await events(page)).map((e) => [e.title, e.date])).toEqual([['Filing deadline', midnight(20)]])
  })
})

test.describe('Law reminders', { tag: ['@regression', '@law'] }, () => {
  test('REG-786 an entry due within three days pops a reminder on the next visit; Done stores it and it never returns', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page }) => {
    const reminder = new LawReminder(page)
    await addEntry(page, 12, { title: 'Hearing — Sharma v. State', time: '11:00', note: 'Court 4' })
    // Reminders are gathered once per visit.
    await expect(reminder.popup).toHaveCount(0)
    await app.reload()
    await expect(reminder.popup).toBeVisible({ timeout: 30_000 })
    await expect(reminder.popup).toContainText('In 2 days · 11:00')
    await expect(reminder.popup).toContainText('Hearing — Sharma v. State')
    await expect(reminder.popup).toContainText('Court 4')
    await reminder.done.click()
    await expect(reminder.popup).toHaveCount(0)
    await expect.poll(async () => (await events(page))[0].status).toBe('done')

    await app.reload()
    const calendar = new LawCalendarDialog(page)
    await calendar.openIt()
    await calendar.day(12).click()
    await expect(new LawDayDialog(page, LABEL[12]).entry('Hearing — Sharma v. State').getByRole('button', { name: 'Mark as pending' })).toBeVisible()
    await expect(reminder.popup).toHaveCount(0)
  })

  test('REG-787 Not done and the close button keep the entry pending so it returns next visit, and the reminder dismisses itself after 8 seconds', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const reminder = new LawReminder(page)
    await addEntry(page, 10, { title: 'Client meeting' })
    await app.reload()
    await expect(reminder.popup).toContainText('Today', { timeout: 30_000 })
    await expect(reminder.popup).toContainText('Client meeting')
    await reminder.notDone.click()
    await expect(reminder.popup).toHaveCount(0)
    expect((await events(page))[0].status).toBe('pending')

    await app.reload()
    await expect(reminder.popup).toBeVisible({ timeout: 30_000 })
    await reminder.dismiss.click()
    await expect(reminder.popup).toHaveCount(0)
    expect((await events(page))[0].status).toBe('pending')

    await app.reload()
    await expect(reminder.popup).toBeVisible({ timeout: 30_000 })
    await page.clock.runFor(8_100)
    await expect(reminder.popup).toHaveCount(0)
    expect((await events(page))[0].status).toBe('pending')
  })

  test('REG-788 a reminder starts three days before the due date, still shows on the day, and stops once the date has passed', { tag: '@P2' }, async ({ signedIn: app, page }) => {
    const reminder = new LawReminder(page)
    const calendar = new LawCalendarDialog(page)
    await addEntry(page, 20, { title: 'Filing deadline', time: '17:00' })
    await app.reload()
    // Ten days ahead: the calendar has it, the reminder does not.
    await calendar.openIt()
    await expect(calendar.dots(20)).toHaveCount(1)
    await expect(reminder.popup).toHaveCount(0)

    await page.clock.setSystemTime(new Date('2026-03-17T08:00:00Z'))
    await app.reload()
    await expect(reminder.popup).toContainText('In 3 days · 17:00', { timeout: 30_000 })
    await reminder.notDone.click()

    await page.clock.setSystemTime(new Date('2026-03-20T08:00:00Z'))
    await app.reload()
    await expect(reminder.popup).toContainText('Today · 17:00', { timeout: 30_000 })
    await reminder.notDone.click()

    await page.clock.setSystemTime(new Date('2026-03-21T08:00:00Z'))
    await app.reload()
    await calendar.openIt()
    await expect(calendar.month).toHaveText('March 2026')
    await expect(calendar.dots(20)).toHaveCount(1)
    await expect(reminder.popup).toHaveCount(0)
    expect((await events(page))[0].status).toBe('pending')
  })

  test('REG-789 with two entries coming up, the sooner one is shown first and Done moves on to the next', { tag: '@P3' }, async ({ signedIn: app, page }) => {
    const reminder = new LawReminder(page)
    await addEntry(page, 12, { title: 'Later hearing' })
    await addEntry(page, 11, { title: 'Sooner hearing' })
    await app.reload()
    await expect(reminder.popup).toContainText('Sooner hearing', { timeout: 30_000 })
    await expect(reminder.popup).toContainText('Tomorrow')
    await reminder.done.click()
    await expect(reminder.popup).toContainText('Later hearing')
    await expect(reminder.popup).toContainText('In 2 days')
    await reminder.done.click()
    await expect(reminder.popup).toHaveCount(0)
    await expect.poll(async () => (await events(page)).map((e) => e.status)).toEqual(['done', 'done'])
  })
})
