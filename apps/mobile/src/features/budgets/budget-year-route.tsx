import { useLocalSearchParams, useRouter } from 'expo-router'

import { BudgetYearScreen, type BudgetYearViewState } from './budget-year-screen'
import { parseBudgetId, parseBudgetPeriodPart } from './budgets-contract'
import { budgetYearToDateMonth, mapBudgetYear } from './budgets-view-model'
import { useBudgetYear, useBudgetYearToDate } from './use-budget-year'

export function BudgetYearRoute() {
  const params = useLocalSearchParams<{ budgetId?: string | string[]; year?: string | string[] }>()
  const budgetId = parseBudgetId(params.budgetId)
  const year = parseBudgetPeriodPart(params.year)
  // Past years compare through December; a year that has not started has no year to date, and
  // its query stays idle (a null month never makes a request).
  const toDateMonth = year === null ? null : budgetYearToDateMonth(year)
  const full = useBudgetYear(budgetId, year)
  const toDate = useBudgetYearToDate(budgetId, year, toDateMonth)
  const hasToDate = toDateMonth !== null
  const router = useRouter()

  let state: BudgetYearViewState
  if (full.isInvalidRoute || (hasToDate && toDate.isInvalidRoute)) state = { status: 'invalid-route' }
  else if (full.isAccessTransition || (hasToDate && toDate.isAccessTransition)) state = { status: 'access-transition' }
  else if (full.isLoading || (hasToDate && toDate.isLoading)) state = { status: 'loading' }
  else if (full.data && (!hasToDate || toDate.data) && year !== null) {
    state = {
      status: full.isRefreshFailure || (hasToDate && toDate.isRefreshFailure) ? 'refresh-error' : 'loaded',
      year: mapBudgetYear(full.data.budget, year),
      toDate: hasToDate && toDate.data ? mapBudgetYear(toDate.data.budget, year) : null,
      refreshing: full.isRefreshing || (hasToDate && toDate.isRefreshing),
    }
  } else if (full.isNotFound || (hasToDate && toDate.isNotFound)) state = { status: 'not-found' }
  else state = { status: 'error' }

  return <BudgetYearScreen
    state={state}
    onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/budgets') }}
    onRetry={async () => { await Promise.all([full.refetch(), hasToDate ? toDate.refetch() : undefined]) }}
    onManageAccounts={() => { if (budgetId !== null) router.push({ pathname: '/budgets/[budgetId]/accounts', params: { budgetId: String(budgetId) } }) }}
    // Web's layout keeps the selected month (the current one) when switching back to Month.
    onViewMonth={() => { if (budgetId !== null && year !== null) router.replace({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: String(budgetId), year: String(year), month: String(new Date().getMonth() + 1) } }) }}
  />
}
