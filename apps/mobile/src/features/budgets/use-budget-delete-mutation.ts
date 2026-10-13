import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createDeleteBudgetEndpoint, isValidBudgetId } from './budgets-contract'
import { isBudgetQueryForEpoch } from './query-keys'

export type BudgetDeleteFailure = 'demo' | 'access' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid' | 'general'

export function classifyBudgetDeleteFailure(error: unknown): BudgetDeleteFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid'
  return 'general'
}

export function useBudgetDeleteMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetDeleteMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (budgetId: number) => {
      if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
      return runtime.apiClient.write(createDeleteBudgetEndpoint(budgetId), {
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
