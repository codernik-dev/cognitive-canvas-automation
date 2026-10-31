/**
 * Camera and microphone permission refused, then allowed, on a phone
 * (SAN-008's emulated counterpart). Each case runs in a browser context of
 * its own, made with the permission state it needs
 * (browser.newContext({ permissions }), helpers/mobileContext.ts), and the
 * permission is then granted mid-session the way a user flips it in the
 * browser's site settings.
 *
 * Browser flags (checked on this machine, Playwright 1.64 Chromium):
 *   - the suite's desktop flag --use-fake-ui-for-media-stream accepts every
 *     camera request whatever the permission says, so a refusal cannot be
 *     produced with it: it is NOT used here;
 *   - the default headless shell answers getUserMedia "NotSupportedError"
 *     without that flag, so this file runs the full Chromium build
 *     (channel 'chromium'), where an ungranted permission is refused with
 *     NotAllowedError exactly like a user's "Block";
 *   - --use-fake-device-for-media-stream gives a test-pattern camera and a
 *     beep microphone. It is REQUIRED: without it the full build would open
 *     the machine's real camera and microphone.
 * The OS permission prompt itself is not reproduced (SAN-008 stays manual).
 */
import { test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { guardedPhoneContext, type GuardedPhone } from '../../helpers/mobileContext.js'
import { bootToHome } from '../../workflows/backup.js'
import { openPdfOnPhone } from '../../helpers/mobileFlows.js'
import { CanvasDialogs } from '../../components/CanvasWorkbench.js'

test.use({ channel: 'chromium', launchOptions: { args: ['--use-fake-device-for-media-stream'] } })

const DENIED_CAMERA = 'Camera access denied. Please allow camera permissions.'

/** Answer the next native alert, reporting its text. */
function nextAlert(phone: GuardedPhone): Promise<string> {
  return new Promise((resolve) => {
    phone.page.once('dialog', async (d) => { const m = d.message(); await d.accept(); resolve(m) })
  })
}

test.describe('Phone permissions (own contexts)', { tag: ['@regression', '@mobile'] }, () => {
  let phone: GuardedPhone | undefined
  test.afterEach(async () => {
    const errors = phone?.pageErrors ?? []
    await phone?.context.close()
    phone = undefined
    expect(errors, 'uncaught exceptions in the page').toEqual([])
  })

  test('REG-852 a camera the browser refuses is explained in words and nothing can be captured; once allowed, reopening the scanner captures and saves the page', { tag: ['@P1'] }, async ({ browser }) => {
    phone = await guardedPhoneContext(browser, { permissions: [] })
    const { app, page } = phone
    await bootToHome(app)
    expect(await page.evaluate(() => navigator.permissions.query({ name: 'camera' as PermissionName }).then((p) => p.state))).toBe('denied')
    await app.home.createProject('Scan Project')
    await app.documents.expectOpen('Scan Project')

    await app.documents.scan.click()
    await expect(page.getByText(DENIED_CAMERA)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Capture page' })).toBeDisabled()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByText(DENIED_CAMERA)).toBeHidden()
    expect(await readStore(page, 'documents')).toEqual([])

    await phone.context.grantPermissions(['camera'])
    await app.documents.scan.click()
    await expect(page.getByRole('button', { name: 'Capture page' })).toBeEnabled({ timeout: 20_000 })
    await expect(page.getByText(DENIED_CAMERA)).toHaveCount(0)
    await page.getByRole('button', { name: 'Capture page' }).click()
    await page.getByRole('button', { name: 'Next — review 1 page' }).click()
    await expect(page.getByText('Review pages')).toBeVisible()
    await page.getByRole('button', { name: /^Save \(1\)$/ }).click()
    await expectStoreCount(page, 'documents', 1, () => true, 30_000)
    const [doc] = await readStore<{ name: string; pageCount: number }>(page, 'documents')
    expect(doc.name).toMatch(/^Scan /)
    expect(doc.pageCount).toBe(1)
  })

  test('REG-853 a refused microphone stops an audio recording with "Microphone access denied" (and a video one with "Camera/microphone access denied"); once allowed, the recording becomes an audio note', { tag: '@P2' }, async ({ browser }) => {
    phone = await guardedPhoneContext(browser, { permissions: [] })
    const { app, page, ws } = phone
    const dialogs = new CanvasDialogs(page)
    await bootToHome(app)
    await app.home.createProject('Voice Project')
    await app.documents.expectOpen('Voice Project')
    await openPdfOnPhone(app, ws)
    await ws.mode('Canvas').click()
    const tapCanvas = async () => {
      const [x, y] = await app.canvas.pointAt(0.5, 0.5)
      await page.touchscreen.tap(x, y)
    }

    await ws.canvasDial.pick('video')
    await tapCanvas()
    await dialogs.video.getByRole('tab', { name: 'Record' }).click()
    const videoAlert = nextAlert(phone)
    await dialogs.video.getByRole('button', { name: 'Start recording' }).click()
    expect(await videoAlert).toBe('Camera/microphone access denied')
    await dialogs.media(dialogs.video, 'Video').cancel.click()
    await expect(dialogs.video).toBeHidden()

    await ws.canvasDial.pick('audio')
    await tapCanvas()
    await dialogs.audio.getByRole('tab', { name: 'Record' }).click()
    const audioAlert = nextAlert(phone)
    await dialogs.audio.getByRole('button', { name: 'Start recording' }).click()
    expect(await audioAlert).toBe('Microphone access denied')
    await expect(dialogs.audio.getByRole('button', { name: 'Stop recording' })).toHaveCount(0)

    await phone.context.grantPermissions(['microphone'])
    await dialogs.audio.getByRole('button', { name: 'Start recording' }).click()
    await expect(dialogs.audio.getByText(/^0:0[2-9]$/)).toBeVisible({ timeout: 15_000 })
    await dialogs.audio.getByRole('button', { name: 'Stop recording' }).click()
    await expect(dialogs.audio.getByText(/^Recorded \(0:0[2-9]\)$/)).toBeVisible()
    await dialogs.media(dialogs.audio, 'Audio').name.fill('Phone voice')
    await dialogs.media(dialogs.audio, 'Audio').create.click()
    await expect(dialogs.audio).toBeHidden({ timeout: 20_000 })
    await expectStoreCount(page, 'workspaceItems', 1, (i) => i.type === 'audio')
    const [blob] = await readStore<{ id: string; mimeType: string; size: number }>(page, 'mediaBlobs')
    expect(blob.mimeType).toMatch(/^audio\//)
    expect(blob.size).toBeGreaterThan(1000)
    const audio = (await readStore<{ type: string; data: { name: string; source: string; blobId: string } }>(page, 'workspaceItems')).find((i) => i.type === 'audio')!
    expect(audio.data).toMatchObject({ name: 'Phone voice', source: 'record', blobId: blob.id })
  })

  test('REG-854 a context made with the camera already allowed starts the scanner camera at once', { tag: '@P3' }, async ({ browser }) => {
    phone = await guardedPhoneContext(browser, { permissions: ['camera'] })
    const { app, page } = phone
    await bootToHome(app)
    await app.home.createProject('Allowed Project')
    await app.documents.expectOpen('Allowed Project')
    await app.documents.scan.click()
    await expect(page.getByRole('button', { name: 'Capture page' })).toBeEnabled({ timeout: 20_000 })
    await expect(page.getByText(DENIED_CAMERA)).toHaveCount(0)
    await expect(page.getByText('Starting camera…')).toHaveCount(0)
  })
})
