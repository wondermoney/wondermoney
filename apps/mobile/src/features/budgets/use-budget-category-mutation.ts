import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { budgetCategoryWriteSchema, createBudgetCategoryEndpoint, type BudgetCategoryWrite } from './budgets-contract'
import { isBudgetQueryForEpoch } from './query-keys'

export type BudgetCategoryWriteFailure = 'demo' | 'access' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid-response' | 'invalid' | 'general'

export function classifyBudgetCategoryWriteFailure(error: unknown): BudgetCategoryWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid-response'
  return 'general'
}

export function useBudgetCategoryMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetCategoryMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ budgetId, year, month, categoryId, value }: { budgetId: number; year: number; month: number; categoryId: number; value: BudgetCategoryWrite }) => {
      const body = budgetCategoryWriteSchema.parse(value)
      return runtime.apiClient.write(createBudgetCategoryEndpoint(budgetId, year, month, categoryId), {
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
