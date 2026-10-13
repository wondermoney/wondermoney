export const budgetsKey = (epochId: number) => ['budgets', 'list', epochId] as const
export const budgetInventoryKey = (epochId: number) => ['budgets', 'inventory', epochId] as const

export const budgetDetailKey = (epochId: number, budgetId: number) => (
  ['budgets', 'detail', epochId, budgetId] as const
)

export const budgetMonthKey = (
  epochId: number,
  budgetId: number,
  year: number,
  month: number,
) => ['budgets', 'month', epochId, budgetId, year, month] as const

export const budgetAccountsKey = (epochId: number, budgetId: number) => (
  ['budgets', 'accounts', epochId, budgetId] as const
)

export const budgetYearKey = (epochId: number, budgetId: number, year: number) => (
  ['budgets', 'year', epochId, budgetId, year] as const
)

export const budgetYearToDateKey = (epochId: number, budgetId: number, year: number, month: number) => (
  ['budgets', 'year-to-date', epochId, budgetId, year, month] as const
)

export const isBudgetQueryForEpoch = (queryKey: readonly unknown[], epochId: number): boolean => (
  queryKey[0] === 'budgets'
  && (queryKey[1] === 'list' || queryKey[1] === 'inventory' || queryKey[1] === 'detail' || queryKey[1] === 'month' || queryKey[1] === 'accounts' || queryKey[1] === 'year' || queryKey[1] === 'year-to-date')
  && queryKey[2] === epochId
)

export const isBudgetContentQueryForEpoch = (queryKey: readonly unknown[], epochId: number): boolean => (
  queryKey[0] === 'budgets'
  && (queryKey[1] === 'list' || queryKey[1] === 'detail' || queryKey[1] === 'month')
  && queryKey[2] === epochId
)
