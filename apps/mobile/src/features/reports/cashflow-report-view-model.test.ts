import { mapCashflowReport } from './cashflow-report-view-model'

const point = (month: string, income: number, expenses: number) => ({ month, income, expenses, net: income - expenses })

describe('cashflow report view model', () => {
  it('maps points to indexed series coordinates and collects their months', () => {
    const result = mapCashflowReport({ data: [point('2026-06-01', 1000, 600), point('2026-07-01', 1200, 700)] })
    expect(result.points).toEqual([{ x: 0, income: 1000, expenses: 600, net: 400 }, { x: 1, income: 1200, expenses: 700, net: 500 }])
    expect(result.months).toEqual(['2026-06-01', '2026-07-01'])
  })

  it('averages net across the trailing 3 months when there are more than 3', () => {
    const result = mapCashflowReport({
      data: [point('2026-04-01', 1000, 1000), point('2026-05-01', 1000, 700), point('2026-06-01', 1000, 800), point('2026-07-01', 1000, 900)],
    })
    // trailing 3: May(300) + Jun(200) + Jul(100) = 600 / 3 = 200. April is excluded.
    expect(result.trailingNetAverage).toBe(200)
  })

  it('averages across fewer than 3 months when that is all there is', () => {
    const result = mapCashflowReport({ data: [point('2026-07-01', 1000, 800)] })
    expect(result.trailingNetAverage).toBe(200)
  })

  it('returns a zero average for no data', () => {
    expect(mapCashflowReport({ data: [] }).trailingNetAverage).toBe(0)
  })
})
