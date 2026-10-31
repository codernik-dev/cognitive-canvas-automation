/**
 * Performance smoke: generous budgets that catch an order-of-magnitude
 * regression (a blocking import, a render loop), not micro-benchmarks.
 * Timings are attached to the report so trends can be compared run to run.
 * Budgets assume the CI runner (2 vCPU); see 03-TEST-STRATEGY.md.
 */
import { test, expect } from '../../fixtures/test.js'
import { LONG_PDF } from '../../data/files.js'

const BUDGET_MS = { boot: 5_000, open40Pages: 10_000, find40Pages: 10_000 }

test.describe('Performance budgets', { tag: ['@performance'] }, () => {
  test('PRF-001 a cold start shows the PIN screen within 5 s', { tag: '@P3' }, async ({ app }, testInfo) => {
    const t0 = Date.now()
    await app.open()
    await app.pinSetup.expectVisible()
    const ms = Date.now() - t0
    testInfo.annotations.push({ type: 'timing', description: `boot ${ms} ms (budget ${BUDGET_MS.boot})` })
    expect(ms).toBeLessThan(BUDGET_MS.boot)
  })

  test('PRF-002 a 40-page PDF opens with page 1 drawn within 10 s', { tag: '@P3' }, async ({ project: _p, app }, testInfo) => {
    const t0 = Date.now()
    await app.documents.uploadFiles(LONG_PDF.payload())
    await app.viewer.expectDocumentOpen(LONG_PDF.displayName, LONG_PDF.pageCount)
    const ms = Date.now() - t0
    testInfo.annotations.push({ type: 'timing', description: `open 40 pages ${ms} ms (budget ${BUDGET_MS.open40Pages})` })
    expect(ms).toBeLessThan(BUDGET_MS.open40Pages)
  })

  test('PRF-003 find across 40 pages returns its count within 10 s', { tag: '@P3' }, async ({ project: _p, app }, testInfo) => {
    await app.documents.uploadFiles(LONG_PDF.payload())
    await app.viewer.expectDocumentOpen(LONG_PDF.displayName, LONG_PDF.pageCount)
    await app.viewer.tool('find').click()
    const t0 = Date.now()
    await app.find.search('LONGPAGE40')
    await app.find.expectCount(1, 1)
    const ms = Date.now() - t0
    testInfo.annotations.push({ type: 'timing', description: `find 40 pages ${ms} ms (budget ${BUDGET_MS.find40Pages})` })
    expect(ms).toBeLessThan(BUDGET_MS.find40Pages)
  })
})
