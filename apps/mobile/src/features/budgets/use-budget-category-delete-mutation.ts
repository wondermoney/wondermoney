import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createDeleteBudgetCategoryForMonthEndpoint, createRemoveBudgetCategoryEndpoint, isValidBudgetId, isValidBudgetPeriod } from './budgets-contract'
import { isBudgetQueryForEpoch } from './query-keys'

export type BudgetCategoryRemovalScope = 'month' | 'forward'
export type BudgetCategoryDeleteDraft = Readonly<{
  budgetId: number
  categoryId: number
  scope: BudgetCategoryRemovalScope
  year: number
  month: number
}>

export type BudgetCategoryDeleteFailure = 'demo' | 'access' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid' | 'general'

export function classifyBudgetCategoryDeleteFailure(error: unknown): BudgetCategoryDeleteFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid'
  return 'general'
}

export function useBudgetCategoryDeleteMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetCategoryDeleteMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (draft: BudgetCategoryDeleteDraft) => {
      if (!isValidBudgetId(draft.budgetId) || !isValidBudgetId(draft.categoryId) || !isValidBudgetPeriod(draft.year, draft.month)) {
        throw new Error('A positive safe budget/category id and a valid budget period are required.')
      }
      const endpoint = draft.scope === 'month'
        ? createDeleteBudgetCategoryForMonthEndpoint(draft.budgetId, draft.year, draft.month, draft.categoryId)
        : createRemoveBudgetCategoryEndpoint(draft.budgetId, draft.categoryId)
      return runtime.apiClient.write(endpoint, {
        commit: () => {
          void queryClient.invalidateQueries({
            predicate: (query) => isBudgetQueryForEpoch(query.queryKey, runtime.epochId),
          })
        },
      })
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
