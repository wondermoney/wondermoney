import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { budgetAccountsWriteSchema, createUpdateBudgetAccountsEndpoint, isValidBudgetId, type BudgetAccountsWrite } from './budgets-contract'
import { isBudgetQueryForEpoch } from './query-keys'

export type BudgetAccountsWriteFailure = 'demo' | 'access' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid' | 'general'

export function classifyBudgetAccountsWriteFailure(error: unknown): BudgetAccountsWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response' || (error.code === 'http' && error.status === 400)) return 'invalid'
  return 'general'
}

export function useBudgetAccountsMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetAccountsMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ budgetId, value }: { budgetId: number; value: BudgetAccountsWrite }) => {
      if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
      const body = budgetAccountsWriteSchema.parse(value)
      return runtime.apiClient.write(createUpdateBudgetAccountsEndpoint(budgetId), {
        body,
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
