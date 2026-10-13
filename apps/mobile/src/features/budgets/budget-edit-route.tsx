import { type Href, useLocalSearchParams, useRouter } from 'expo-router'

import { ApiError } from '@/lib/api/errors'

import { BudgetEditScreen, type BudgetEditViewState } from './budget-edit-screen'
import { parseBudgetId } from './budgets-contract'
import { useBudgetDeleteMutation } from './use-budget-delete-mutation'
import { useBudgetDetail } from './use-budget-detail'
import { useBudgetMetadataMutation } from './use-budget-metadata-mutation'

export function BudgetEditRoute() {
  const params = useLocalSearchParams<{ budgetId?: string | string[] }>()
  const budgetId = parseBudgetId(params.budgetId)
  const detail = useBudgetDetail(budgetId)
  const mutation = useBudgetMetadataMutation()
  const deleteMutation = useBudgetDeleteMutation()
  const router = useRouter()
  let state: BudgetEditViewState

  if (detail.isInvalidRoute) state = { status: 'invalid-route' }
  else if (detail.isAccessTransition) state = { status: 'access-transition' }
  else if (detail.isLoading) state = { status: 'loading' }
  else if (detail.data) {
    state = {
      status: detail.isRefreshFailure ? 'refresh-error' : 'loaded',
      model: {
        id: detail.data.budget.budgetKey,
        name: detail.data.budget.name,
        description: detail.data.budget.description ?? null,
      },
      refreshing: detail.isRefreshing,
    }
  } else if (detail.isNotFound) state = { status: 'not-found' }
  else if (detail.error instanceof ApiError && detail.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  return <BudgetEditScreen
    state={state}
    onBack={() => router.replace('/budgets' as Href)}
    onRetry={async () => { await detail.refetch() }}
    pending={mutation.isPending}
    onSaveMetadata={async (value) => { if (budgetId === null) return; await mutation.mutateAsync({ budgetId, value }) }}
    deletePending={deleteMutation.isPending}
    onDeleteBudget={async () => { if (budgetId === null) return; await deleteMutation.mutateAsync(budgetId); router.replace('/budgets' as Href) }}
  />
}
