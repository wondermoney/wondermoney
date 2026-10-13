import type { NetWorthHistorySummaryDto } from './net-worth-contract'
import { mapNetWorthHistory } from './net-worth-history-view-model'

const point = (date: string, total: number | null, isComplete = true) => ({
  date, totalNetWorth: total, accountsTotal: total, portfoliosTotal: 0, loansTotal: 0, isComplete,
})

describe('mapNetWorthHistory', () => {
  it('computes change only between consecutive resolved points and never treats null as zero', () => {
    const summary: NetWorthHistorySummaryDto = {
      currencyCode: 'EUR',
      granularity: 'monthly',
      readiness: 'ready',
      points: [point('2026-01-01', 1000), point('2026-02-01', null, false), point('2026-03-01', 1500)],
    }
    const vm = mapNetWorthHistory(summary)
    expect(vm.points.map((p) => p.change)).toEqual([null, null, 500])
    expect(vm.points[1].value).toBeNull()
    expect(vm.points[1].isComplete).toBe(false)
  })

  it('derives stats only from resolved points', () => {
    const summary: NetWorthHistorySummaryDto = {
      currencyCode: 'USD',
      granularity: 'monthly',
      readiness: 'ready',
      points: [point('2026-01-01', 800), point('2026-02-01', 1200), point('2026-03-01', 600), point('2026-04-01', null, false)],
    }
    const vm = mapNetWorthHistory(summary)
    expect(vm.stats).toEqual({ earliest: 800, latest: 600, high: 1200, low: 600, netChange: -200 })
  })

  it('yields null stats when nothing is resolved', () => {
    const summary: NetWorthHistorySummaryDto = {
      currencyCode: 'GBP', granularity: 'monthly', readiness: 'empty',
      points: [point('2026-01-01', null, false), point('2026-02-01', null, false)],
    }
    const vm = mapNetWorthHistory(summary)
    expect(vm.stats).toEqual({ earliest: null, latest: null, high: null, low: null, netChange: null })
    expect(vm.readiness).toBe('empty')
  })
})
