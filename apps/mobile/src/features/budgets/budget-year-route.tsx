import { useLocalSearchParams, useRouter } from 'expo-router'

import { BudgetYearScreen, type BudgetYearViewState } from './budget-year-screen'
import { parseBudgetId, parseBudgetPeriodPart } from './budgets-contract'
import { mapBudgetYear } from './budgets-view-model'
import { useBudgetYear, useBudgetYearToDate } from './use-budget-year'

export function BudgetYearRoute() {
  const params = useLocalSearchParams<{ budgetId?: string | string[]; year?: string | string[] }>()
  const budgetId = parseBudgetId(params.budgetId)
  const year = parseBudgetPeriodPart(params.year)
  const currentMonth = new Date().getMonth() + 1
  const full = useBudgetYear(budgetId, year)
  const toDate = useBudgetYearToDate(budgetId, year, currentMonth)
  const router = useRouter()

  let state: BudgetYearViewState
  if (full.isInvalidRoute || toDate.isInvalidRoute) state = { status: 'invalid-route' }
  else if (full.isAccessTransition || toDate.isAccessTransition) state = { status: 'access-transition' }
  else if (full.isLoading || toDate.isLoading) state = { status: 'loading' }
  else if (full.data && toDate.data && year !== null) {
    state = {
      status: full.isRefreshFailure || toDate.isRefreshFailure ? 'refresh-error' : 'loaded',
      year: mapBudgetYear(full.data.budget, year),
      toDate: mapBudgetYear(toDate.data.budget, year),
      refreshing: full.isRefreshing || toDate.isRefreshing,
    }
  } else if (full.isNotFound || toDate.isNotFound) state = { status: 'not-found' }
  else state = { status: 'error' }

  return <BudgetYearScreen
    state={state}
    onBack={() => router.replace('/budgets')}
    onRetry={async () => { await Promise.all([full.refetch(), toDate.refetch()]) }}
  />
}
