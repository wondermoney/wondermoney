import { getAccountsTimeframeScope } from './accounts-timeframe'
import { buildBalanceSeries } from './balance-growth'
import { summarizeMetrics } from './metrics-summary'
import { metricFixture } from './test-fixtures'

describe('accounts overview math', () => {
  it('computes web timeframe ranges in UTC, with no lower bound for All Time', () => {
    const now = new Date('2026-11-05T10:00:00.000Z')
    expect(getAccountsTimeframeScope('YTD', now)).toEqual({ fromDate: '2026-01-01T00:00:00.000Z', toDate: now.toISOString() })
    expect(getAccountsTimeframeScope('3M', now).fromDate).toBe('2026-08-05T10:00:00.000Z')
    expect(getAccountsTimeframeScope('ALL', now)).toEqual({ toDate: now.toISOString() })
  })

  it('sums metrics across accounts like web aggregateMetrics', () => {
    const summary = summarizeMetrics([
      { ...metricFixture, inflowCurrentPeriod: 300, inflowPastPeriod: 100, outflowCurrentPeriod: 120, outflowPastPeriod: 0 },
      { ...metricFixture, accountKey: 9, inflowCurrentPeriod: null, inflowPastPeriod: 50, outflowCurrentPeriod: 30, outflowPastPeriod: null },
    ])!
    expect(summary).toMatchObject({ inflowCurrent: 300, inflowPast: 150, outflowCurrent: 150, outflowPast: 0, netSavings: 150, savingsRate: 0.5, inflowPct: 1 })
    expect(summary.outflowPct).toBe(Infinity)
    expect(summarizeMetrics([])).toBeNull()
  })

  it('builds a balance line from each account’s latest balance per day', () => {
    const points = buildBalanceSeries([
      { id: 1, date: '2026-10-01T09:00:00.000Z', accountId: 1, amount: -10, convertedBalance: 90 },
      { id: 2, date: '2026-10-01T12:00:00.000Z', accountId: 2, amount: 50, convertedBalance: 50 },
      { id: 3, date: '2026-10-03T12:00:00.000Z', accountId: 1, amount: -40, convertedBalance: 50 },
    ], '2026-09-01T00:00:00.000Z', Date.parse('2026-10-05T12:00:00.000Z'))
    expect(points.map((point) => point.balance)).toEqual([100, 140, 100, 100])
  })
})
