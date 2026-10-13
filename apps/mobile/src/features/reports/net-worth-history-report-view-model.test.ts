import { mapNetWorthHistoryReport } from './net-worth-history-report-view-model'

const point = (date: string, netWorth: number, assets = netWorth, liabilities = 0) => ({
  date, netWorth, breakdown: { assets, liabilities },
})

describe('net-worth history report view model', () => {
  it('maps points to indexed chart coordinates and collects their dates', () => {
    const result = mapNetWorthHistoryReport({ data: [point('2026-06-01', 1000), point('2026-07-01', 1200)] })
    expect(result.points).toEqual([{ x: 0, value: 1000 }, { x: 1, value: 1200 }])
    expect(result.dates).toEqual(['2026-06-01', '2026-07-01'])
  })

  it('computes the delta and percent between the two most recent points', () => {
    const result = mapNetWorthHistoryReport({ data: [point('2026-06-01', 1000), point('2026-07-01', 1200)] })
    expect(result.trend).toEqual({ delta: 200, percent: 20 })
  })

  it('treats fewer than two points as no trend', () => {
    expect(mapNetWorthHistoryReport({ data: [] }).trend).toEqual({ delta: 0, percent: null })
    expect(mapNetWorthHistoryReport({ data: [point('2026-06-01', 1000)] }).trend).toEqual({ delta: 0, percent: null })
  })

  it('withholds the percentage when the previous value was zero rather than calling it 0%', () => {
    const result = mapNetWorthHistoryReport({ data: [point('2026-06-01', 0), point('2026-07-01', 500)] })
    expect(result.trend).toEqual({ delta: 500, percent: null })
  })

  it('exposes the latest breakdown, or null with no points', () => {
    const result = mapNetWorthHistoryReport({ data: [point('2026-06-01', 1000, 1200, 200), point('2026-07-01', 1200, 1500, 300)] })
    expect(result.latestBreakdown).toEqual({ assets: 1500, liabilities: 300 })
    expect(mapNetWorthHistoryReport({ data: [] }).latestBreakdown).toBeNull()
  })
})
