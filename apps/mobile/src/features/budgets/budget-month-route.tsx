import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { ApiError } from '@/lib/api/errors'

import { BudgetMonthScreen, type BudgetMonthViewState } from './budget-month-screen'
import { parseBudgetId, parseBudgetPeriodPart } from './budgets-contract'
import { adjacentBudgetPeriod, mapBudget } from './budgets-view-model'
import { useBudgetCategoryDeleteMutation } from './use-budget-category-delete-mutation'
import { useBudgetCategoryMutation } from './use-budget-category-mutation'
import { useBudgetMonth } from './use-budget-month'

export function BudgetMonthRoute() {
  const params = useLocalSearchParams<{ budgetId?: string | string[]; year?: string | string[]; month?: string | string[] }>()
  const budgetId = parseBudgetId(params.budgetId)
  const year = parseBudgetPeriodPart(params.year)
  const month = parseBudgetPeriodPart(params.month)
  const query = useBudgetMonth(budgetId, year, month)
  const categoryMutation = useBudgetCategoryMutation()
  const categoryDeleteMutation = useBudgetCategoryDeleteMutation()
  const router = useRouter()
  const navigation = useNavigation()
  const anyCategoryMutationPending = categoryMutation.isPending || categoryDeleteMutation.isPending
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (anyCategoryMutationPending) event.preventDefault()
  }), [anyCategoryMutationPending, navigation])
  let state: BudgetMonthViewState
  if (query.isInvalidRoute) state = { status: 'invalid-route' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data && year !== null && month !== null) {
    state = {
      status: query.isRefreshFailure ? 'refresh-error' : 'loaded',
      budget: mapBudget(query.data.budget, { year, month }),
      hasPrevious: query.data.hasPreviousMonth,
      hasNext: query.data.hasNextMonth,
      refreshing: query.isRefreshing,
    }
  } else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const navigate = (direction: -1 | 1) => {
    if (budgetId === null || year === null || month === null) return
    const next = adjacentBudgetPeriod(year, month, direction)
    router.replace({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: String(budgetId), year: String(next.year), month: String(next.month) } })
  }
  return <BudgetMonthScreen
    state={state}
    categoryPending={anyCategoryMutationPending}
    onSaveCategory={async (categoryId, value) => { if (budgetId === null || year === null || month === null) return; await categoryMutation.mutateAsync({ budgetId, year, month, categoryId, value }) }}
    onRemoveCategory={async (categoryId, scope) => { if (budgetId === null || year === null || month === null) return; await categoryDeleteMutation.mutateAsync({ budgetId, categoryId, scope, year, month }) }}
     onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/budgets') }}
    onRetry={async () => { await query.refetch() }}
    onPrevious={() => navigate(-1)}
    onNext={() => navigate(1)}
    onAddCategory={() => { if (budgetId !== null) router.push({ pathname: '/budgets/[budgetId]/categories/add', params: { budgetId: String(budgetId) } }) }}
    onEdit={() => { if (budgetId !== null) router.push({ pathname: '/budgets/[budgetId]/edit', params: { budgetId: String(budgetId) } }) }}
    onManageAccounts={() => { if (budgetId !== null) router.push({ pathname: '/budgets/[budgetId]/accounts', params: { budgetId: String(budgetId) } }) }}
    onViewYear={() => { if (budgetId !== null && year !== null) router.push({ pathname: '/budgets/[budgetId]/[year]', params: { budgetId: String(budgetId), year: String(year) } }) }}
  />
}
