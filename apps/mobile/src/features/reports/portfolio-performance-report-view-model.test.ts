import { mapPortfolioPerformanceReport } from './portfolio-performance-report-view-model'
import type { PortfolioPerformanceReportRow } from './reports-contract'

const row = (overrides: Partial<PortfolioPerformanceReportRow> = {}): PortfolioPerformanceReportRow => ({
  portfolioKey: '7',
  name: 'Long-term',
  currency: 'EUR',
  startValue: 1000,
  netContributions: 0,
  change: 100,
  changePercent: 10,
  dividends: 0,
  endValue: 1100,
  ...overrides,
})

describe('portfolio-performance report view model', () => {
  it('sorts rows by absolute change descending, regardless of sign, with unknown changes last', () => {
    const result = mapPortfolioPerformanceReport({
      data: [
        row({ portfolioKey: 'small', change: 5 }),
        row({ portfolioKey: 'unknown', change: null }),
        row({ portfolioKey: 'bigLoss', change: -200 }),
        row({ portfolioKey: 'medium', change: 50 }),
      ],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.rows.map((r) => r.portfolioKey)).toEqual(['bigLoss', 'medium', 'small', 'unknown'])
  })

  it('sums the change across portfolios exactly, since amounts are already in one shared currency server-side', () => {
    const result = mapPortfolioPerformanceReport({
      data: [row({ portfolioKey: 'a', change: 100.1 }), row({ portfolioKey: 'b', change: -30.2 })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.aggregateChange).toBe(69.9)
  })

  it('leaves the combined change unknown when any portfolio has no start value', () => {
    const result = mapPortfolioPerformanceReport({
      data: [row({ portfolioKey: 'a' }), row({ portfolioKey: 'b', startValue: null, change: null, changePercent: null })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.aggregateChange).toBeNull()
  })

  it('leaves contributions and dividends unknown when a portfolio\'s trades had no exchange rate', () => {
    const result = mapPortfolioPerformanceReport({
      data: [row({ portfolioKey: 'a', netContributions: 100, dividends: 5 }), row({ portfolioKey: 'b', netContributions: null, change: null, changePercent: null, dividends: null })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.totals).toMatchObject({ netContributions: null, dividends: null, change: null, changePercent: null, startValue: 2000 })
  })

  it('passes generatedAt through and returns an empty list with a zero aggregate for no rows', () => {
    const result = mapPortfolioPerformanceReport({ data: [], generatedAt: '2026-08-11T00:00:00.000Z' })
    expect(result).toEqual({
      rows: [],
      generatedAt: '2026-08-11T00:00:00.000Z',
      aggregateChange: 0,
      totals: { startValue: 0, netContributions: 0, change: 0, changePercent: null, dividends: 0, endValue: 0 },
      hasPeriodReturns: false,
    })
  })

  it('shows the weighted returns only when the API sends them, keeping each row\'s own figures', () => {
    const withReturns = mapPortfolioPerformanceReport({
      data: [row({ portfolioKey: 'a', timeWeightedReturn: 4.5, moneyWeightedReturn: null, moneyWeightedReturnAnnualized: false, missingSnapshotDates: [] })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(withReturns.hasPeriodReturns).toBe(true)
    expect(withReturns.rows[0]).toMatchObject({ timeWeightedReturn: 4.5, moneyWeightedReturn: null })
    expect(mapPortfolioPerformanceReport({ data: [row()], generatedAt: '2026-08-11T00:00:00.000Z' }).hasPeriodReturns).toBe(false)
  })
})
