import { mapRecurringItems, mapRecurringSummary } from './recurring-view-model'
import { recurringItemFixture, recurringSummaryFixture } from './test-fixtures'

describe('recurring view model', () => {
  it('derives review/inclusion only and orders upcoming dated items first', () => {
    const rows = mapRecurringItems({ items: [
      { ...recurringItemFixture, recurringSeriesKey: 1, nextExpectedAt: null, confidenceScore: 89, status: 'candidate' },
      { ...recurringItemFixture, recurringSeriesKey: 2, nextExpectedAt: '2026-07-25T00:00:00.000Z', confidenceScore: 90, status: 'candidate' },
      { ...recurringItemFixture, recurringSeriesKey: 3, nextExpectedAt: '2026-07-24T00:00:00.000Z', confidenceScore: 99, status: 'dismissed' },
    ] }, new Map([[2, 'Daily account']]))
    expect(rows.map((row) => row.id)).toEqual([3, 2, 1])
    expect(rows.find((row) => row.id === 1)).toMatchObject({ needsReview: true, includedInSummary: false })
    expect(rows.find((row) => row.id === 2)).toMatchObject({ needsReview: false, includedInSummary: true, accountName: 'Daily account' })
    expect(rows.find((row) => row.id === 3)).toMatchObject({ needsReview: false, includedInSummary: false })
  })
  it('preserves server summary totals without recreating monthly calculations', () => {
    const result = mapRecurringSummary(recurringSummaryFixture)
    expect(result).toMatchObject({ monthlyMinTotal: 1250.99, monthlyMaxTotal: 1270.99, needsReviewCount: 1, detectedIncludedCount: 3 })
    expect(result.currencyTotals).toEqual([{ currency: 'EUR', count: 3, monthlyTotal: 1270.99, monthlyMinTotal: 1250.99, monthlyMaxTotal: 1270.99 }])
  })
})
