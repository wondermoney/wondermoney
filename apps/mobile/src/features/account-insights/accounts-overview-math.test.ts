import { inTimeZone } from '@/test/time-zone'

import { getAccountsTimeframeScope } from './accounts-timeframe'
import { createAggregateMetricsEndpoint } from './insights-contract'
import { buildBalanceSeries } from './balance-growth'
import { summarizeMetrics } from './metrics-summary'
import { metricFixture } from './test-fixtures'

describe('accounts timeframes, for a viewer in New York', () => {
  inTimeZone('America/New_York')
  // 22:00 on 31 December 2026 in New York, already 1 January 2027 in UTC.
  const now = new Date('2027-01-01T03:00:00.000Z')

  it('starts YTD on 1 January of the viewer\'s year and ends at the end of their today', () => {
    expect(getAccountsTimeframeScope('YTD', now)).toEqual({ fromDate: '2026-01-01T05:00:00.000Z', toDate: '2027-01-01T04:59:59.999Z' })
  })

  it('starts 1M on the same day of the previous local month, or its last day when that is shorter', () => {
    expect(getAccountsTimeframeScope('1M', now).fromDate).toBe('2026-11-30T05:00:00.000Z')
    // 31 March 2026, 20:00 in New York.
    expect(getAccountsTimeframeScope('1M', new Date('2026-04-01T00:00:00.000Z')).fromDate).toBe('2026-02-28T05:00:00.000Z')
  })

  it('counts 3M, 6M and 1Y back in local calendar months, and leaves All Time open', () => {
    expect(getAccountsTimeframeScope('3M', now).fromDate).toBe('2026-09-30T04:00:00.000Z')
    expect(getAccountsTimeframeScope('6M', now).fromDate).toBe('2026-06-30T04:00:00.000Z')
    expect(getAccountsTimeframeScope('1Y', now).fromDate).toBe('2025-12-31T05:00:00.000Z')
    expect(getAccountsTimeframeScope('ALL', now)).toEqual({ toDate: '2027-01-01T04:59:59.999Z' })
  })

  it('sends the range with the device\'s time zone', () => {
    const query = new URLSearchParams(createAggregateMetricsEndpoint(getAccountsTimeframeScope('YTD', now)).path.split('?')[1])
    expect(query.get('fromDate')).toBe(String(Date.parse('2026-01-01T05:00:00.000Z')))
    expect(query.get('timezone')).toBe('America/New_York')
  })
})

describe('accounts timeframes, for a viewer in Tokyo', () => {
  inTimeZone('Asia/Tokyo')
  // 05:00 on 1 January 2027 in Tokyo, still 31 December 2026 in UTC.
  const now = new Date('2026-12-31T20:00:00.000Z')

  it('starts YTD on 1 January of the viewer\'s year and ends at the end of their today', () => {
    expect(getAccountsTimeframeScope('YTD', now)).toEqual({ fromDate: '2026-12-31T15:00:00.000Z', toDate: '2027-01-01T14:59:59.999Z' })
  })

  it('starts 1M on the same day of the previous local month', () => {
    expect(getAccountsTimeframeScope('1M', now).fromDate).toBe('2026-11-30T15:00:00.000Z')
  })
})

describe('accounts overview math', () => {

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
