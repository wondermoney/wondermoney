import {
  createNetWorthHistoryEndpoint,
  netWorthHistorySummarySchema,
} from './net-worth-contract'

const summary = {
  currencyCode: 'EUR',
  granularity: 'monthly' as const,
  points: [
    { date: '2026-01-01', totalNetWorth: 1000, accountsTotal: 1200, portfoliosTotal: 300, loansTotal: 500, isComplete: true },
    { date: '2026-02-01', totalNetWorth: null, accountsTotal: null, portfoliosTotal: null, loansTotal: null, isComplete: false },
  ],
  readiness: 'ready' as const,
}

describe('net worth history contract', () => {
  it('accepts the summary shape with nullable per-point totals', () => {
    expect(netWorthHistorySummarySchema.parse(summary)).toEqual(summary)
  })

  it('rejects a non-monthly granularity and malformed dates', () => {
    expect(netWorthHistorySummarySchema.safeParse({ ...summary, granularity: 'weekly' }).success).toBe(false)
    expect(netWorthHistorySummarySchema.safeParse({ ...summary, points: [{ ...summary.points[0], date: '2026/01/01' }] }).success).toBe(false)
  })

  it('builds a monthly endpoint and clamps months into the server range [2,12]', () => {
    expect(createNetWorthHistoryEndpoint(6).path).toBe('/v1/net-worth/history?granularity=monthly&months=6')
    expect(createNetWorthHistoryEndpoint(1).path).toBe('/v1/net-worth/history?granularity=monthly&months=2')
    expect(createNetWorthHistoryEndpoint(99).path).toBe('/v1/net-worth/history?granularity=monthly&months=12')
    expect(createNetWorthHistoryEndpoint().method).toBe('GET')
  })
})
