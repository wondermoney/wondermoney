import { mapBudgetVsActualReport } from './budget-vs-actual-view-model'

const row = (overrides: Partial<{ categoryKey: string; name: string; color: string; budgeted: number; actual: number; variance: number; percentUsed: number }> = {}) => ({
  categoryKey: 'groceries',
  name: 'Groceries',
  color: '#22c55e',
  budgeted: 400,
  actual: 320,
  variance: 80,
  percentUsed: 80,
  ...overrides,
})

describe('budget-vs-actual view model', () => {
  it('flags rows over 100% as over-budget and leaves the rest untouched', () => {
    const result = mapBudgetVsActualReport({
      data: [row({ categoryKey: 'a', percentUsed: 80 }), row({ categoryKey: 'b', percentUsed: 120 })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.rows.find((r) => r.categoryKey === 'a')?.overBudget).toBe(false)
    expect(result.rows.find((r) => r.categoryKey === 'b')?.overBudget).toBe(true)
  })

  it('treats exactly 100% as not over budget', () => {
    const result = mapBudgetVsActualReport({ data: [row({ percentUsed: 100 })], generatedAt: '2026-08-11T00:00:00.000Z' })
    expect(result.rows[0]?.overBudget).toBe(false)
  })

  it('sorts rows by percentUsed descending, most overspent first', () => {
    const result = mapBudgetVsActualReport({
      data: [
        row({ categoryKey: 'low', percentUsed: 20 }),
        row({ categoryKey: 'high', percentUsed: 150 }),
        row({ categoryKey: 'mid', percentUsed: 60 }),
      ],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.rows.map((r) => r.categoryKey)).toEqual(['high', 'mid', 'low'])
  })

  it('passes generatedAt through and returns an empty list for no rows', () => {
    const result = mapBudgetVsActualReport({ data: [], generatedAt: '2026-08-11T00:00:00.000Z' })
    expect(result).toEqual({ rows: [], generatedAt: '2026-08-11T00:00:00.000Z' })
  })
})
