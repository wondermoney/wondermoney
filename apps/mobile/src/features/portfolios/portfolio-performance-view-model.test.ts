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
    expect(mapPortfolioPerformance(base).points).toEqual([{ x: 0, value: 1000, flow: null }, { x: 1, value: 1050, flow: null }, { x: 2, value: 1100, flow: null }])
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

  it('flags a history that left out a portfolio it could not convert into the viewer\'s currency', () => {
    expect(mapPortfolioPerformance({ ...base, completeness: { currencyCode: 'EUR', incompleteDates: ['2026-07-15'], isComplete: false } }).currencyIncomplete).toBe(true)
    expect(mapPortfolioPerformance({ ...base, completeness: { currencyCode: 'EUR', incompleteDates: [], isComplete: true } }).currencyIncomplete).toBe(false)
    expect(mapPortfolioPerformance(base).currencyIncomplete).toBe(false)
  })

  it('marks each day money went in or out on the value line and lists it, the amount unsigned', () => {
    const result = mapPortfolioPerformance({
      ...base,
      dataPoints: [
        { date: '2026-07-01', value: 1000 },
        { date: '2026-07-10', value: 1500, netContribution: 500 },
        { date: '2026-07-15', value: 1500, netContribution: 0 },
        { date: '2026-07-20', value: 1300, netContribution: -200 },
        { date: '2026-08-01', value: 1300, netContribution: null },
      ],
    })
    expect(result.points.map((point) => point.flow)).toEqual([null, 1500, null, 1300, 1300])
    expect(result.flows).toEqual([
      { date: '2026-07-10', kind: 'deposit', amount: 500 },
      { date: '2026-07-20', kind: 'withdrawal', amount: 200 },
      { date: '2026-08-01', kind: 'unknown', amount: null },
    ])
    expect(mapPortfolioPerformance(base).flows).toEqual([])
  })

  it('reads the return by date, so a day the time-weighted series skipped neither shifts the line nor reads as zero', () => {
    const dataPoints = [{ date: '2026-07-01', value: 1000 }, { date: '2026-07-02', value: 1500, netContribution: 500 }, { date: '2026-07-03', value: 1500 }]
    // A missing middle day: the chart keeps every value day in place and the return is the last measured one.
    const gap = mapPortfolioPerformance({ ...base, dataPoints, normalizedDataPoints: [{ date: '2026-07-01', value: 0 }, { date: '2026-07-03', value: 0 }] })
    expect(gap.points.map((point) => point.value)).toEqual([1000, 1500, 1500])
    expect(gap).toMatchObject({ totalReturnPercent: 0, returnEndDate: '2026-07-03', endDate: '2026-07-03' })
    // A missing last day: the return is as of the day before, never a made-up figure for the end.
    const lagging = mapPortfolioPerformance({ ...base, dataPoints, normalizedDataPoints: [{ date: '2026-07-01', value: 0 }, { date: '2026-07-02', value: 1.5 }] })
    expect(lagging).toMatchObject({ totalReturnPercent: 1.5, returnEndDate: '2026-07-02', endDate: '2026-07-03' })
    expect(mapPortfolioPerformance({ ...base, normalizedDataPoints: [] })).toMatchObject({ totalReturnPercent: null, returnEndDate: null })
  })

  it('carries the currency the history is valued in when the API names it', () => {
    expect(mapPortfolioPerformance({ ...base, completeness: { currencyCode: 'EUR', incompleteDates: [], isComplete: true } }).currencyCode).toBe('EUR')
    expect(mapPortfolioPerformance(base).currencyCode).toBeNull()
  })
})
