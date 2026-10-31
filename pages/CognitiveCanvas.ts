/**
 * Root page object: one instance per test, holding every screen and shared
 * component so a spec reads `app.home.createProject(...)`,
 * `app.viewer.jumpTo(3)`, `app.canvas.place('note', ...)`.
 */
import { expect, type Page } from '@playwright/test'
import { PinSetupPage, LoginPage, ForgotPinDialog, ChangePinDialog } from './AuthPages.js'
import { HomePage } from './HomePage.js'
import { DocumentsPage } from './DocumentsPage.js'
import { SettingsPage } from './SettingsPage.js'
import { DataCenter } from './DataCenter.js'
import { GlobalHeader, ProfileMenu, Dialogs, Toasts } from '../components/Shell.js'
import { PdfViewer, FindBar } from '../components/PdfViewer.js'
import { CanvasPane } from '../components/CanvasPane.js'

export class CognitiveCanvas {
  readonly header: GlobalHeader
  readonly profileMenu: ProfileMenu
  readonly dialogs: Dialogs
  readonly toasts: Toasts
  readonly pinSetup: PinSetupPage
  readonly login: LoginPage
  readonly forgotPin: ForgotPinDialog
  readonly changePin: ChangePinDialog
  readonly home: HomePage
  readonly documents: DocumentsPage
  readonly viewer: PdfViewer
  readonly find: FindBar
  readonly canvas: CanvasPane
  readonly settings: SettingsPage
  readonly dataCenter: DataCenter

  constructor(readonly page: Page) {
    this.header = new GlobalHeader(page)
    this.profileMenu = new ProfileMenu(page, this.header)
    this.dialogs = new Dialogs(page)
    this.toasts = new Toasts(page)
    this.pinSetup = new PinSetupPage(page)
    this.login = new LoginPage(page)
    this.forgotPin = new ForgotPinDialog(page)
    this.changePin = new ChangePinDialog(page)
    this.home = new HomePage(page, this.header)
    this.documents = new DocumentsPage(page)
    this.viewer = new PdfViewer(page)
    this.find = new FindBar(page)
    this.canvas = new CanvasPane(page)
    this.settings = new SettingsPage(page)
    this.dataCenter = new DataCenter(page)
  }

  /** Load the app. A fresh context shows PIN setup; a profile with a PIN shows the unlock screen. */
  async open(path = '/') {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' })
  }

  /**
   * A profile with no projects opens the Catalog once per session, but only
   * after an asynchronous project count, so a Home click that lands first is
   * covered a moment later (OBS-009). On a fresh profile the Catalog always
   * comes, so wait for it before navigating. With the network blocked (the
   * default) it settles on its offline error.
   */
  async firstRunCatalogShown() {
    await expect(this.page.getByText('Failed to load content')).toBeVisible({ timeout: 30_000 })
  }

  /** Reload and unlock if the app asks (the unlock lives in sessionStorage, so a reload normally keeps it). */
  async reload() {
    await this.page.reload({ waitUntil: 'domcontentloaded' })
  }
}
