import { budgetAccountsKey, budgetDetailKey, budgetInventoryKey, budgetMonthKey, budgetsKey, budgetYearKey, budgetYearToDateKey, isBudgetContentQueryForEpoch, isBudgetQueryForEpoch } from './query-keys'

it('isolates budget resources by epoch and authoritative route period', () => {
  expect(budgetsKey(8)).toEqual(['budgets', 'list', 8])
  expect(budgetInventoryKey(8)).toEqual(['budgets', 'inventory', 8])
  expect(budgetDetailKey(8, 7)).toEqual(['budgets', 'detail', 8, 7])
  expect(budgetMonthKey(8, 7, 2026, 12)).toEqual(['budgets', 'month', 8, 7, 2026, 12])
  expect(budgetAccountsKey(8, 7)).toEqual(['budgets', 'accounts', 8, 7])
  expect(budgetYearKey(8, 7, 2026)).toEqual(['budgets', 'year', 8, 7, 2026])
  expect(budgetYearToDateKey(8, 7, 2026, 4)).toEqual(['budgets', 'year-to-date', 8, 7, 2026, 4])
  expect(isBudgetContentQueryForEpoch(budgetInventoryKey(8), 8)).toBe(false)
  expect(isBudgetQueryForEpoch(budgetAccountsKey(8, 7), 8)).toBe(true)
  expect(isBudgetQueryForEpoch(budgetAccountsKey(9, 7), 8)).toBe(false)
  expect(isBudgetQueryForEpoch(budgetYearKey(8, 7, 2026), 8)).toBe(true)
  expect(isBudgetQueryForEpoch(budgetYearToDateKey(8, 7, 2026, 4), 8)).toBe(true)
})
