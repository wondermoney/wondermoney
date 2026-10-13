import type { BudgetViewModel } from '@/features/budgets/budgets-view-model'

import { selectCurrentBudgetHealth } from './net-worth-budget-health-view-model'

const budget = (over: Partial<BudgetViewModel> = {}): BudgetViewModel => ({
  id: 1,
  name: 'August',
  description: null,
  currencyCode: 'EUR',
  year: 2026,
  month: 8,
  totals: { planned: 1000, spent: 400, remaining: 600, progressPercentage: 40, meterPercentage: 40, overspent: false },
  categories: [],
  accounts: [],
  ...over,
})

describe('selectCurrentBudgetHealth', () => {
  it('picks the budget matching the given date\'s year and 1-indexed month', () => {
    const now = new Date('2026-08-15T00:00:00.000Z')
    const budgets = [budget({ id: 1, year: 2026, month: 7 }), budget({ id: 2, year: 2026, month: 8 }), budget({ id: 3, year: 2027, month: 8 })]
    expect(selectCurrentBudgetHealth(budgets, now)?.id)?.toBe(2)
  })

  it('returns null when no budget matches the current period (nothing to show, not an error)', () => {
    const now = new Date('2026-08-15T00:00:00.000Z')
    expect(selectCurrentBudgetHealth([budget({ year: 2026, month: 7 })], now)).toBeNull()
    expect(selectCurrentBudgetHealth([], now)).toBeNull()
  })

  it('projects the exact totals fields needed for the dashboard card, nothing more', () => {
    const now = new Date('2026-08-15T00:00:00.000Z')
    const result = selectCurrentBudgetHealth([budget({ year: 2026, month: 8, currencyCode: 'USD', totals: { planned: 500, spent: 550, remaining: -50, progressPercentage: 110, meterPercentage: 100, overspent: true } })], now)
    expect(result).toEqual({
      id: 1,
      planned: 500,
      spent: 550,
      remaining: -50,
      currencyCode: 'USD',
      meterPercentage: 100,
      overspent: true,
    })
  })
})
