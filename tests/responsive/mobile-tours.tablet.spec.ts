/**
 * Guided tours on a tablet (1024x1366 Chromium with a touchscreen, project
 * "tablet"): the desktop layout and targets, but touch wording where a step
 * has it (tours/resolveStep.ts `touchContent`: tap, not click; no scroll
 * wheel, no right-click). A tablet is a finger-first device by
 * utils/environment.ts (coarse pointer, no hover, a screen edge over 640 px).
 * The expected words are read from src/components/tours/tourSteps.ts.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/mobile.js'
import { openPdfOnTablet } from '../../helpers/mobileFlows.js'
import { TourCard } from '../../pages/ShellPages.js'
import { tourSteps, tabletText, type SourceTourName } from '../../helpers/mobileTours.js'

async function walkTabletTour(page: Page, name: SourceTourName) {
  const tour = new TourCard(page)
  const steps = tourSteps(name)
  for (const [i, step] of steps.entries()) {
    await tour.expectStep(i + 1, steps.length, step.title)
    await expect(tour.body).toHaveText(tabletText(step))
    if (i < steps.length - 1) await tour.next.click()
    else await tour.finish.click()
  }
  await expect(tour.card).toBeHidden()
}

test.describe('Tours on a tablet', { tag: ['@regression', '@mobile'] }, () => {
  test('REG-859 on a tablet the workspace, document-tools and workspace-tools tours use the touch wording (tap, pinch) wherever a step has it', { tag: '@P3' }, async ({ project: _p, app, page }) => {
    await openPdfOnTablet(app, null)
    // At least one step of each tour really differs on a tablet, so the walk proves the touch words are chosen.
    for (const name of ['document', 'doc-tools', 'workspace-tools'] as const) expect(tourSteps(name).some((s) => s.touchContent && s.touchContent !== s.content)).toBe(true)
    await app.header.guidedTour.click()
    await walkTabletTour(page, 'document')
    const tour = new TourCard(page)
    await tour.docToolsEntry.click()
    await walkTabletTour(page, 'doc-tools')
    await tour.wsToolsEntry.click()
    await walkTabletTour(page, 'workspace-tools')
  })
})
