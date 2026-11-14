import { mapMonthComparisonReport } from './month-comparison-report-view-model'
import type { MonthComparisonData } from './reports-contract'

const data: MonthComparisonData = {
  base: { expenses: 1150, income: 2020, month: '2026-08', net: 870, savingsRate: 0.4307 },
  categories: [
    { base: 1000, categoryKey: '11', color: '#222222', compare: 900, delta: 100, deltaPct: 11.11, name: 'Rent' },
    { base: 150, categoryKey: '10', color: '#f3f3f3', compare: 100, delta: 50, deltaPct: 50, name: 'Groceries' },
  ],
  compare: { expenses: 1000, income: 2000, month: '2026-07', net: 1000, savingsRate: 0.5 },
}

describe('mapMonthComparisonReport', () => {
  it('keeps both months and every category in the API order', () => {
    const report = mapMonthComparisonReport({ data })

    expect(report.base).toEqual(data.base)
    expect(report.compare).toEqual(data.compare)
    expect(report.rows.map((row) => [row.key, row.name, row.delta])).toEqual([
      ['11', 'Rent', 100],
      ['10', 'Groceries', 50],
    ])
  })

  it('keeps a missing percentage as null rather than inventing one', () => {
    const report = mapMonthComparisonReport({
      data: {
        ...data,
        categories: [{ base: 40, categoryKey: '12', color: '#333333', compare: 0, delta: 40, deltaPct: null, name: 'Travel' }],
      },
    })

    expect(report.rows[0]?.deltaPct).toBeNull()
  })
})
