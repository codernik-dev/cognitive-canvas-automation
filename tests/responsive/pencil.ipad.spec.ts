/**
 * iPad (Playwright WebKit with devices['iPad Pro 11']: iPad user agent,
 * 834x1194, touch; project "ipad"). The closest a browser run gets to Safari
 * on an iPad, and the emulated counterparts of SAN-004 (Apple Pencil
 * highlights, finger scrolls) and SAN-005 (stylus Select Area OCR, #363).
 *
 * WebKit has no DevTools input protocol here, so the Pencil and fingers are
 * pointer / touch events dispatched in the page (helpers/mobileInput.ts:
 * pointerType 'pen' or 'touch', pointerId 1 so pointer capture works). They
 * exercise the app's pointerType logic; a real Pencil's touchType 'stylus',
 * pressure, palm contact and Safari's own gestures are NOT reproduced.
 *
 * Playwright WebKit on Windows also has no camera / microphone
 * (navigator.mediaDevices is undefined) and no Fullscreen API.
 */
import { test, expect } from '../../fixtures/mobile.js'
import { readStore, expectStoreCount } from '../../helpers/idb.js'
import { fingerDrag, penDrag, pinch, penDownInPage, penUpInPage, touchStartRefused } from '../../helpers/mobileInput.js'
import { pagePoint, pageRegion, openPdfOnTablet } from '../../helpers/mobileFlows.js'
import { ShellBanners } from '../../pages/ShellPages.js'
import { scannedPdf, SCAN_REGIONS } from '../../data/documents-files.js'
import { wordsOf } from '../../helpers/documents.js'
import { OCR_PAGE_TIMEOUT } from '../../components/DocumentsOcr.js'
import { knownDefect } from '../../helpers/defects.js'

interface HighlightRow { id: string; pageNumber: number; color: string; tip?: string }
interface ItemRow { id: string; type: string; documentId: string; data: { content?: string; sourceExcerpt?: string } }
interface AreaLinkRow { id: string; pageNumber: number; workspaceItemId: string }

test.describe('iPad', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-880 an iPad gets the tablet layout (not the phone one), is marked as iOS, and Install app gives the Safari "Add to Home Screen" steps', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    expect(await page.evaluate(() => document.documentElement.classList.contains('is-ios'))).toBe(true)
    await expect(app.header.settings).toBeVisible()
    await expect(mobile.header.menu).toHaveCount(0)
    await expect(mobile.nav.bar).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Toggle fullscreen' })).toHaveCount(0) // no Fullscreen API to offer
    const banners = new ShellBanners(page)
    await page.getByRole('button', { name: 'Install app' }).click()
    await expect(banners.install).toContainText('To install Cognitive Canvas as an app on your home screen:')
    await expect(banners.install).toContainText("Tap the Share button — the square with an upward arrow. It's in the bottom toolbar on iPhone, top-right on iPad.")
    await expect(banners.install).toContainText('Scroll down in the menu and tap "Add to Home Screen".')
    await expect(banners.install).not.toContainText('Chrome / Edge:')
    await banners.install.getByRole('button', { name: 'Close' }).click()
    await expect(banners.install).toBeHidden()
  })

  test.describe('in Chrome for iOS', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1' })
    test('REG-881 Install app in Chrome on an iPad explains that only Safari can install, shows the address and copies it', { tag: '@P3' }, async ({ signedIn: _app, page }) => {
      const banners = new ShellBanners(page)
      await page.getByRole('button', { name: 'Install app' }).click()
      await expect(banners.install).toContainText('On iOS, only Safari can install apps to the home screen.')
      await expect(banners.install).toContainText('Chrome for iOS doesn\'t have an "Add to Home Screen" option — that\'s an Apple restriction, not a Chrome limitation.')
      await expect(banners.install).toContainText(page.url())
      await banners.install.getByRole('button', { name: 'Copy URL' }).click()
      await expect(banners.install.getByRole('button', { name: 'Copied!' })).toBeVisible()
    })
  })

  test('REG-882 the (emulated) Apple Pencil highlights the PDF and the highlight is saved; on the canvas the Pencil draws and a finger then pans', { tag: ['@P1', '@sanity'] }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app)
    await expect(app.viewer.tool('pan')).toBeVisible() // a touch device: Pan is offered
    await app.viewer.tool('highlight').click()
    const [a, b] = await pageRegion(app, 2, [0.12, 0.17], [0.7, 0.17])
    await penDrag(page, a, b, 14)
    await expectStoreCount(page, 'highlights', 1)
    const [h] = await readStore<HighlightRow>(page, 'highlights')
    expect(h).toMatchObject({ pageNumber: 2, tip: 'highlighter' })
    await expect(app.viewer.highlights).toHaveCount(1)

    await app.canvas.tool('ink').click()
    await penDrag(page, await app.canvas.pointAt(0.2, 0.3), await app.canvas.pointAt(0.7, 0.3), 12)
    await expectStoreCount(page, 'canvasStrokes', 1)
    const before = await app.canvas.transform()
    await fingerDrag(page, await app.canvas.pointAt(0.3, 0.6), await app.canvas.pointAt(0.6, 0.5), 10)
    await app.canvas.settled()
    const after = await app.canvas.transform()
    expect(after.x - before.x).toBeGreaterThan(60)
    await expectStoreCount(page, 'canvasStrokes', 1) // the finger did not draw
  })

  test('REG-883 a stylus Select Area over a scanned region is read by OCR into a linked note (#363)', { tag: ['@P1'] }, async ({ signedIn: app, page }) => {
    // OCR is CPU-bound (tesseract.js WASM) and slower in WebKit: one page of recognition is allowed for.
    test.setTimeout(240_000)
    const scan = await scannedPdf(page)
    // From Home, so no background OCR runs first: Select Area has to read the scan itself.
    await app.home.upload(scan.payload)
    await app.documents.openDocument(scan.displayName)
    await app.viewer.expectDocumentOpen(scan.displayName, scan.pageCount)
    await app.viewer.tool('select-area').click()
    const [from, to] = await pageRegion(app, 1, ...SCAN_REGIONS.alpha)
    await penDrag(page, from, to, 10)
    await expect(page.getByText('Running OCR...')).toBeVisible({ timeout: 30_000 })
    await expectStoreCount(page, 'areaLinks', 1, () => true, OCR_PAGE_TIMEOUT)
    const [link] = await readStore<AreaLinkRow>(page, 'areaLinks')
    const note = (await readStore<ItemRow>(page, 'workspaceItems')).find((i) => i.id === link.workspaceItemId)!
    expect(note.type).toBe('note')
    expect(wordsOf(note.data.content ?? '')).toContain('OCRALPHA')
    expect(link.pageNumber).toBe(1)
  })

  test('REG-884 while the stylus is down on Select Area its touches are kept from scrolling the page; a finger alone is left to scroll', { tag: '@P2' }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app)
    await app.viewer.tool('select-area').click()
    const at = await pagePoint(app, 2, 0.5, 0.6)
    expect(await touchStartRefused(page, at)).toBe(false)
    await penDownInPage(page, at)
    expect(await touchStartRefused(page, at)).toBe(true)
    await penUpInPage(page, at)
    expect(await touchStartRefused(page, at)).toBe(false)
    await expectStoreCount(page, 'workspaceItems', 0)
  })

  test('REG-885 two fingers zoom the PDF on an iPad (the app takes the pinch, not Safari)', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    knownDefect('DEF-804')
    await openPdfOnTablet(app, null)
    await expect(app.viewer.zoomReset).toHaveText('100%')
    const box = (await app.viewer.scroller.boundingBox())!
    await pinch(page, [box.x + box.width / 2, box.y + box.height / 2], 50, 75)
    await expect(app.viewer.zoomReset).toHaveText('150%')
  })

  test('REG-886 Safari\'s own page-zoom gesture events are cancelled everywhere in the app', { tag: '@P3' }, async () => {
    // services/layout/pinchGuard.ts cancels WebKit's gesturestart / gesturechange /
    // gestureend. Playwright WebKit on Windows cannot create one: `new GestureEvent()`
    // throws "Argument 1 ('event') to EventTarget.dispatchEvent must be an instance of
    // Event" and document.createEvent('GestureEvent') throws "The operation is not
    // supported." (checked 2026-10-30, Playwright 1.64 / WebKit 2370). Needs a real iPad.
    test.fixme(true, 'GestureEvent cannot be constructed in Playwright WebKit on Windows')
  })
})
