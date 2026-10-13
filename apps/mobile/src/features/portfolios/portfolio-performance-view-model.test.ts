import { mapPortfolioPerformance } from './portfolio-performance-view-model'
import type { PortfolioPerformanceResponseDto } from './portfolios-contract'

const base: PortfolioPerformanceResponseDto = {
  dataPoints: [{ date: '2026-07-01', value: 1000 }, { date: '2026-07-15', value: 1050 }, { date: '2026-08-01', value: 1100 }],
  normalizedDataPoints: [{ date: '2026-07-01', value: 0 }, { date: '2026-07-15', value: 5 }, { date: '2026-08-01', value: 10 }],
  minDataPointsForComparison: 2,
  period: 'YTD',
  portfolioHistoryStatus: 'ready',
}

describe('mapPortfolioPerformance', () => {
  it('converts raw data points to index-positioned chart points', () => {
    expect(mapPortfolioPerformance(base).points).toEqual([{ x: 0, value: 1000 }, { x: 1, value: 1050 }, { x: 2, value: 1100 }])
  })

  it('reads total return from the last normalized data point', () => {
    expect(mapPortfolioPerformance(base).totalReturnPercent).toBe(10)
  })

  it('reports null total return when normalized points are absent or empty', () => {
    expect(mapPortfolioPerformance({ ...base, normalizedDataPoints: undefined }).totalReturnPercent).toBeNull()
    expect(mapPortfolioPerformance({ ...base, normalizedDataPoints: [] }).totalReturnPercent).toBeNull()
  })

  it('derives the start and end date from the raw data points', () => {
    expect(mapPortfolioPerformance(base)).toMatchObject({ startDate: '2026-07-01', endDate: '2026-08-01' })
  })

  it('reports null dates and empty points when there is no history', () => {
    const empty = mapPortfolioPerformance({ ...base, dataPoints: [], normalizedDataPoints: [], portfolioHistoryStatus: 'empty' })
    expect(empty).toMatchObject({ points: [], startDate: null, endDate: null, historyStatus: 'empty' })
  })

  it('falls back to a ready/empty history status when the server omits it', () => {
    const { portfolioHistoryStatus: _omitted, ...withoutStatus } = base
    expect(mapPortfolioPerformance(withoutStatus).historyStatus).toBe('ready')
    expect(mapPortfolioPerformance({ ...withoutStatus, dataPoints: [] }).historyStatus).toBe('empty')
  })
})
