/**
 * Offline: every feature that needs the network must fail in plain words
 * when the connection is gone, and the work kept on this device must carry
 * on. Each test switches the device offline the way a lost connection looks
 * to the app (fixtures/platform.ts `network`: navigator.onLine false AND
 * api.muulorigin.com unanswered), tries the feature, then proves local work
 * still saves.
 *
 * Screens the app loads on first use (Data Center, Sharing, Settings, the
 * scanner's save) are opened once while still online, the way a user who
 * loses the connection mid-session has usually already visited them; what
 * happens to a screen NOT yet visited is OFF-010's subject.
 *
 * Already covered elsewhere and not repeated here: the Catalog list offline
 * (OFF-003), GitHub backup and restore offline (REG backup-github, "offline"),
 * sending a copy offline (REG-581), tutorials without a connection (REG-675)
 * and a catalog download whose ZIP cannot be fetched (catalog-download).
 */
import { test, expect } from '../../fixtures/platform.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { knownDefect } from '../../helpers/defects.js'
import { createProjects, exportAllLocal } from '../../workflows/backup.js'
import { BackupZip } from '../../helpers/backupZip.js'
import { SharingScreen } from '../../pages/SharingScreen.js'
import { SupportPanel } from '../../pages/ContentSupport.js'
import { ScannerModal } from '../../pages/DocumentsScanner.js'
import { galleryJpeg } from '../../data/documents-files.js'
import { documentByName } from '../../helpers/documents.js'
import { baseURL } from '../../config/env.js'
import type { CognitiveCanvas } from '../../pages/CognitiveCanvas.js'
import type { Page } from '@playwright/test'

/** Local work still saves: a new project is created and stored. */
async function localWorkCarriesOn(app: CognitiveCanvas, page: Page, name: string) {
  await app.header.home.click()
  const before = (await readStore(page, 'projects')).length
  await app.home.createProject(name)
  await app.documents.expectOpen(name)
  await expectStoreCount(page, 'projects', before + 1)
}

test.describe('Network features offline', { tag: ['@regression', '@offline'] }, () => {
  test('OFF-004 offline, a cloud backup says the connection is missing, nothing reaches the cloud, and a Local backup still works', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, cloud, network }, testInfo) => {
    const dc = app.dataCenter
    await createProjects(app, ['Offline Cloud'])
    // Used once online: a cloud backup, the cloud restore list and a Local export (loads the code each one needs).
    await dc.openFromHeader()
    await dc.choose('Backup', 'Cloud')
    await expect(dc.dialog.getByRole('heading', { name: 'Backup to Cloud' })).toBeVisible()
    await dc.description.fill('Made while online')
    await dc.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    await expect.poll(() => cloud.state.backups.length).toBe(1)
    await expect(dc.dialog).toBeHidden()
    await dc.openFromHeader()
    await dc.choose('Restore', 'Cloud')
    await expect(dc.cloudRows).toHaveCount(1)
    await dc.close.click()
    await exportAllLocal(app, testInfo)
    await network.offline()

    await dc.openFromHeader()
    await dc.choose('Backup', 'Cloud')
    await expect(dc.dialog.getByRole('heading', { name: 'Backup to Cloud' })).toBeVisible()
    await dc.description.fill('Made while offline')
    await dc.createBackup.click()
    const reason = 'The upload could not reach the server. Check your connection and try again.'
    await app.toasts.expectShown(`Backup failed: ${reason}`, 30_000)
    await expect(dc.errorBox).toHaveText(reason)
    await expect(dc.createBackup).toBeEnabled()
    expect(cloud.state.backups).toHaveLength(1)

    await dc.close.click()

    // The Local backup needs no network: it still saves a complete ZIP.
    const { file } = await exportAllLocal(app, testInfo)
    const zip = BackupZip.fromFile(file)
    expect(zip.manifest.projectIds).toHaveLength(1)
    expect(cloud.state.uploads).toHaveLength(1)
    await localWorkCarriesOn(app, page, 'Made While Offline')
  })

  test('OFF-011 offline, the cloud restore list says it cannot reach Muul Cloud, not that there are no backups', { tag: '@P2' }, async ({ signedIn: app, page, cloud, network }) => {
    knownDefect('DEF-918')
    const dc = app.dataCenter
    await createProjects(app, ['Listed Project'])
    // One backup in the cloud, and the restore list seen once online.
    await dc.openFromHeader()
    await dc.choose('Backup', 'Cloud')
    await dc.description.fill('Listed backup')
    await dc.createBackup.click()
    await app.toasts.expectShown('Backed up to Cloud', 30_000)
    await expect(dc.dialog).toBeHidden()
    await dc.openFromHeader()
    await dc.choose('Restore', 'Cloud')
    await expect(dc.cloudRows).toHaveCount(1)
    await dc.close.click()
    await network.offline()

    await dc.openFromHeader()
    await dc.choose('Restore', 'Cloud')
    await expect(dc.dialog.getByRole('heading', { name: 'Restore from Cloud' })).toBeVisible()
    await expect(dc.dialog.getByText("Couldn't reach Muul Cloud. Check your connection and try again.")).toBeVisible({ timeout: 30_000 })
    await expect(dc.dialog.getByText('No backups found in Muul Cloud.')).toHaveCount(0)
    await expect(dc.dialog.getByText(/upload/i)).toHaveCount(0)
    expect(cloud.state.backups).toHaveLength(1)
    await dc.close.click()
    await localWorkCarriesOn(app, page, 'Restored Later')
  })

  test('OFF-005 offline, the Sharing screen says it cannot reach the sharing service and offers Try again instead of empty boards', { tag: '@P2' }, async ({ signedIn: app, page, network }) => {
    knownDefect('DEF-502')
    const screen = new SharingScreen(page)
    // Visited once online.
    await screen.open()
    await screen.back.click()
    await network.offline()
    await localWorkCarriesOn(app, page, 'Shared Later')
    await screen.open()
    await expect(screen.loadError).toContainText("Couldn't reach the sharing service. Check your connection and try again.")
    await expect(page.getByRole('heading', { name: 'Nothing shared yet' })).toHaveCount(0)
  })

  test('OFF-006 offline, Support says the connection is missing, in words, both for the ticket list and for sending a ticket', { tag: '@P2' }, async ({ signedIn: app, page, network, support }) => {
    knownDefect('DEF-903')
    const panel = new SupportPanel(page)
    // Visited once online.
    await panel.open()
    await panel.myTicketsTab.click()
    await panel.expectList()
    await app.header.home.click()
    await network.offline()
    await localWorkCarriesOn(app, page, 'Support Later')
    await panel.open()
    await panel.myTicketsTab.click()
    await expect(panel.tryAgain).toBeVisible({ timeout: 30_000 })
    const listError = panel.tryAgain.locator('xpath=..')
    await expect(listError).toContainText(/connection|offline|internet/i)
    await expect(listError).not.toContainText('Failed to fetch')

    await panel.newTicketTab.click()
    await panel.fillTicket('Printer offline', 'The printer does not answer at all today.')
    await panel.submit.click()
    await expect(page.getByText(/connection|offline|internet/i).first()).toBeVisible()
    await expect(page.getByText('Failed to fetch')).toHaveCount(0)
    expect(support.tickets).toHaveLength(0)
  })

  test('OFF-007 the scanner works offline: gallery pages are saved as a document on this device', { tag: '@P2' }, async ({ project: _p, app, page, network }) => {
    knownDefect('DEF-917')
    const first = await galleryJpeg(page, 'ONLINEPAGE', 'automation-online.jpg')
    const photo = await galleryJpeg(page, 'OFFLINEPAGE', 'automation-offline.jpg')
    const scanner = new ScannerModal(page)
    // One scan saved while online (loads the scanner and its PDF writer).
    await scanner.open(app.documents.scan)
    await scanner.pickImages([first])
    await scanner.next.click()
    await scanner.name.fill('Online Scan')
    await scanner.save.click()
    await app.viewer.expectDocumentOpen('Online Scan', 1)
    await app.viewer.backToDocuments.click()
    await network.offline()
    await scanner.open(app.documents.scan)
    await scanner.pickImages([photo])
    await expect(scanner.thumbnails).toHaveCount(1)
    await scanner.next.click()
    await scanner.name.fill('Offline Scan')
    await scanner.save.click()
    await expect(scanner.dialog).toBeHidden({ timeout: 30_000 })
    await app.viewer.expectDocumentOpen('Offline Scan', 1)
    const doc = await documentByName(page, 'Offline Scan')
    expect(doc.pageCount).toBe(1)
    await expectStoreCount(page, 'documents', 2)
  })
})

test.describe('Screens not visited yet', { tag: ['@regression', '@offline'] }, () => {
  test.use({ muulPlan: null })

  test('OFF-010 after the connection drops, a screen not yet opened in this session still opens instead of reloading the app into a blank page', { tag: ['@P1', '@sanity'] }, async ({ signedIn: app, page, network }) => {
    knownDefect('DEF-916')
    await app.home.createProject('Before The Drop')
    await app.documents.backToProjects.click()
    await network.offline()
    await app.header.backupRestore.click()
    await expect(app.dataCenter.modeToggle('Backup')).toBeVisible()
    await expect(app.header.home).toBeVisible()
    expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin)
    await app.dataCenter.close.click()
    await app.header.settings.click()
    await app.settings.expectOpen()
    await localWorkCarriesOn(app, page, 'After The Drop')
  })
})

test.describe('Signing in offline', { tag: ['@regression', '@offline'] }, () => {
  test.use({ muulPlan: null })

  test('OFF-008 offline, Sign in says it needs a connection and keeps the app open, instead of leaving for a page that cannot load', { tag: '@P2' }, async ({ signedIn: app, page, network }) => {
    knownDefect('DEF-904')
    await network.offline()
    await app.header.profile.click()
    await app.profileMenu.item('Sign in').click()
    // Still in the app (not on the browser's own "no connection" page), and told why.
    await expect(app.header.home).toBeVisible()
    expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin)
    await expect(page.getByText(/connection|offline|internet/i).first()).toBeVisible()
    await localWorkCarriesOn(app, page, 'Signed Out Offline')
  })
})
