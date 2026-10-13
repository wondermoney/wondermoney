import { mapSpendingByCategoryReport } from './spending-by-category-report-view-model'

const row = (categoryKey: string, totalAmount: number, name = categoryKey) => ({
  categoryKey, parentKey: null, name, color: '#111111', totalAmount, transactionCount: 1, percentOfTotal: 0,
})

describe('spending-by-category report view model', () => {
  it('sorts bars by amount descending and computes proportional widths relative to the largest', () => {
    const result = mapSpendingByCategoryReport({ data: [row('a', 50), row('b', 100)] }, undefined, 'Other')
    expect(result.bars.map((b) => b.key)).toEqual(['b', 'a'])
    expect(result.bars.find((b) => b.key === 'b')?.widthPercent).toBe(100)
    expect(result.bars.find((b) => b.key === 'a')?.widthPercent).toBe(50)
  })

  it('folds categories beyond the top 12 into a single Other bucket', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(`cat-${i}`, 14 - i))
    const result = mapSpendingByCategoryReport({ data: rows }, undefined, 'Other')
    expect(result.bars).toHaveLength(13)
    const other = result.bars.find((b) => b.key === '__other__')
    expect(other?.name).toBe('Other')
    expect(other?.amount).toBe(1 + 2) // the 13th and 14th smallest, folded
  })

  it('omits the Other bucket entirely when there is nothing beyond the top 12', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`cat-${i}`, 5 - i))
    const result = mapSpendingByCategoryReport({ data: rows }, undefined, 'Other')
    expect(result.bars.find((b) => b.key === '__other__')).toBeUndefined()
  })

  it('treats an absent prior period as a zero baseline for the delta, but withholds the percentage', () => {
    const result = mapSpendingByCategoryReport({ data: [row('a', 100), row('b', 50)] }, undefined, 'Other')
    expect(result.total).toBe(150)
    // The delta is real: 150 more than nothing. The *percentage* change from a
    // zero baseline is undefined, and reporting it as 0% told the reader
    // spending was flat while the figure beside it said +150.
    expect(result.trend).toEqual({ delta: 150, percent: null })
  })

  it('computes the delta and percent against a supplied prior period', () => {
    const result = mapSpendingByCategoryReport({ data: [row('a', 150)] }, { data: [row('a', 100)] }, 'Other')
    expect(result.trend).toEqual({ delta: 50, percent: 50 })
  })

  it('returns an empty bar list and zero total for no data', () => {
    const result = mapSpendingByCategoryReport({ data: [] }, undefined, 'Other')
    expect(result.bars).toEqual([])
    expect(result.total).toBe(0)
  })
})
