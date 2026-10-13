import type { BudgetViewModel } from '@/features/budgets/budgets-view-model'

export type BudgetHealthData = Readonly<{
  id: number
  planned: number
  spent: number
  remaining: number
  currencyCode: string
  meterPercentage: number
  overspent: boolean
}>

/**
 * RAD-198 — dashboard budget-health card. Picks the budget matching the
 * given date's calendar month (server month is 1-indexed; JS Date isn't).
 * Returns null when there's no budget for the current period — that's a
 * legitimate "nothing to show" state, not an error.
 */
export function selectCurrentBudgetHealth(budgets: readonly BudgetViewModel[], now: Date): BudgetHealthData | null {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const current = budgets.find((budget) => budget.year === year && budget.month === month)
  if (!current) return null
  return {
    id: current.id,
    planned: current.totals.planned,
    spent: current.totals.spent,
    remaining: current.totals.remaining,
    currencyCode: current.currencyCode,
    meterPercentage: current.totals.meterPercentage,
    overspent: current.totals.overspent,
  }
}
