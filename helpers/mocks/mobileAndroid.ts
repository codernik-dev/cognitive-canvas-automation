/**
 * A stub of the Muul-Android host: the React Native WebView the Android app
 * wraps Cognitive Canvas in. What the page can see of it:
 *
 *   window.ReactNativeWebView        the RN WebView bridge object. Its presence,
 *                                    together with window.externalMessage, is
 *                                    what makes bridgeService.detectEnvironment()
 *                                    answer 'muul-android' (and muulBridge.ts
 *                                    isMuulAndroid() true).
 *   window.MuulBridge / isMuulBrowser the flags the Android external-bridge hook
 *                                    sets (utils/environment.ts checkMuulAndroid)
 *   --muul-chrome-top / -bottom      CSS variables the host writes on <html>
 *                                    for its auto-hiding top and bottom bars;
 *                                    toasts, the view notice, the storage chip
 *                                    and the backup indicator sit inside them.
 *
 * The messages themselves go through window.externalMessage.send (the same
 * contract as desktop MoBrowser), which helpers/mocks/moBrowserBridge.ts
 * answers; install that too (fixtures/backup.ts `moBrowser` option). Every
 * window.ReactNativeWebView.postMessage the page makes is recorded here, in
 * Node, so a spec can assert what (if anything) went that way.
 *
 * A pass proves the app's side of the host contract only, never the real
 * Android build (SAN-006 stays a manual check).
 */
import type { BrowserContext } from '@playwright/test'

export interface MuulAndroidOptions {
  /** Height of the host's top bar, written to --muul-chrome-top (px). */
  chromeTop: number
  /** Height of the host's bottom bar, written to --muul-chrome-bottom (px). */
  chromeBottom: number
}

export class MuulAndroidHost {
  /** Every ReactNativeWebView.postMessage payload, in order. */
  readonly posted: string[] = []

  private constructor(readonly options: MuulAndroidOptions) {}

  static async install(context: BrowserContext, origin: string, options: MuulAndroidOptions): Promise<MuulAndroidHost> {
    const host = new MuulAndroidHost(options)
    await context.exposeBinding('__ccE2eRnPost', (_src, message: string) => { host.posted.push(message) })
    await context.addInitScript(({ origin, top, bottom }) => {
      if (location.origin !== origin) return
      const w = window as unknown as Record<string, unknown> & { __ccE2eRnPost: (m: string) => Promise<void> }
      w.ReactNativeWebView = { postMessage: (m: unknown) => { void w.__ccE2eRnPost(String(m)) } }
      w.MuulBridge = true
      w.isMuulBrowser = true
      const apply = () => {
        document.documentElement.style.setProperty('--muul-chrome-top', `${top}px`)
        document.documentElement.style.setProperty('--muul-chrome-bottom', `${bottom}px`)
      }
      if (document.documentElement) apply()
      else document.addEventListener('readystatechange', apply, { once: true })
    }, { origin, top: options.chromeTop, bottom: options.chromeBottom })
    return host
  }

  /** A host that is not wired into the page (an ordinary browser). */
  static detached(): MuulAndroidHost {
    return new MuulAndroidHost({ chromeTop: 0, chromeBottom: 0 })
  }
}
