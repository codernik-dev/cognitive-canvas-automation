/**
 * Guided tours on a phone (GuidedTour.tsx + tours/resolveStep.ts): a step can
 * carry phone wording (phoneContent), a phone target (phoneTarget; null = a
 * centred card with nothing boxed) and the pane it is about (phoneMode),
 * which the tour switches to; when the tour ends the pane you started on comes
 * back. Entry points on a phone: Menu › Guided tour, and the Tour tile of each
 * tool dial. The expected words are read from src/components/tours/tourSteps.ts
 * (helpers/mobileTours.ts), never copied. Desktop tours: tests/regression/tours.spec.ts.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/mobile.js'
import { TourCard } from '../../pages/ShellPages.js'
import { tourSteps, phoneText, phoneTargetOf, type SourceTourName } from '../../helpers/mobileTours.js'
import { openPdfOnPhone } from '../../helpers/mobileFlows.js'
import type { MobileWorkspace } from '../../components/MobileWorkspace.js'

/**
 * Walk a running tour to the end: every step's counter, title and phone
 * words; centred steps box nothing, targeted ones box their target; and
 * `onStep` for extra checks. Ends with Finish.
 */
async function walkPhoneTour(page: Page, name: SourceTourName, onStep?: (index: number) => Promise<void>) {
  const tour = new TourCard(page)
  const steps = tourSteps(name)
  for (const [i, step] of steps.entries()) {
    await tour.expectStep(i + 1, steps.length, step.title)
    await expect(tour.body).toHaveText(phoneText(step))
    const target = phoneTargetOf(step)
    if (target === null) await expect.poll(async () => (await tour.highlights()).length, { message: `${step.title}: centred` }).toBe(0)
    else await expect.poll(async () => (await tour.highlights()).length, { message: `${step.title}: boxed` }).toBeGreaterThan(0)
    if (onStep) await onStep(i)
    if (i < steps.length - 1) await tour.next.click()
    else await tour.finish.click()
  }
  await expect(tour.card).toBeHidden()
}

const paneShown = async (ws: MobileWorkspace) => ({ doc: await ws.docPane.isVisible(), canvas: await ws.wsPane.isVisible() })

test.describe('Tours on a phone', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-855 Menu › Guided tour on the phone home walks the six Home steps in phone words, boxing the phone\'s own controls', { tag: '@P2' }, async ({ signedIn: app, mobile, page }) => {
    await app.home.createProject('Tour Project')
    await app.documents.expectOpen('Tour Project')
    await app.documents.backToProjects.click()
    await mobile.menu.choose('Guided tour')
    await walkPhoneTour(page, 'project')
  })

  test('REG-856 the workspace tour on a phone shows the pane each step is about, centres the steps about toolbar buttons the phone lacks, and puts back the pane you started on', { tag: ['@P2'] }, async ({ project: _p, app, mobile, ws, page }) => {
    await openPdfOnPhone(app, ws)
    await ws.mode('Split').click()
    await mobile.menu.choose('Guided tour')
    const steps = tourSteps('document')
    await walkPhoneTour(page, 'document', async (i) => {
      const mode = steps[i].phoneMode
      if (mode === 'doc') expect(await paneShown(ws)).toEqual({ doc: true, canvas: false })
      if (mode === 'canvas') expect(await paneShown(ws)).toEqual({ doc: false, canvas: true })
    })
    // Back on Split, where the tour began.
    await expect(ws.divider).toBeVisible()
    expect(await paneShown(ws)).toEqual({ doc: true, canvas: true })
  })

  test('REG-857 the document dial\'s Tour tile walks every document tool with the sheet held open, in phone words; the doc-list tour uses phone words too', { tag: '@P3' }, async ({ project: _p, app, mobile, ws, page }) => {
    await mobile.menu.choose('Guided tour')
    await walkPhoneTour(page, 'doclist')

    await openPdfOnPhone(app, ws)
    await ws.docDial.open()
    await ws.docDial.tileNamed('Tour').click()
    await walkPhoneTour(page, 'doc-tools', async () => {
      await expect(ws.docDial.sheet).toHaveAttribute('aria-hidden', 'false')
    })
    await ws.docDial.expectClosed()
  })

  test('REG-858 the canvas dial\'s Tour tile walks every canvas tool in phone words with the sheet held open', { tag: '@P3' }, async ({ project: _p, app, ws, page }) => {
    await openPdfOnPhone(app, ws)
    await ws.mode('Canvas').click()
    await ws.canvasDial.open()
    await ws.canvasDial.tileNamed('Tour').click()
    await walkPhoneTour(page, 'workspace-tools', async () => {
      await expect(ws.canvasDial.sheet).toHaveAttribute('aria-hidden', 'false')
    })
    await ws.canvasDial.expectClosed()
  })
})
