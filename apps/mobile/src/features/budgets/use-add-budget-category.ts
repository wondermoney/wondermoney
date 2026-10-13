import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { budgetAddCategoryWriteSchema, createBudgetAddCategoryEndpoint, type BudgetAddCategoryWrite } from './budgets-contract'
import { isBudgetContentQueryForEpoch } from './query-keys'

export type AddBudgetCategoryFailure = 'unknown' | 'duplicate' | 'demo' | 'access' | 'not-found' | 'invalid' | 'general'
export const classifyAddBudgetCategoryFailure = (error: unknown): AddBudgetCategoryFailure => {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'cancelled' || error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && error.status === 400) return 'duplicate'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  return 'general'
}

export function useAddBudgetCategory() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAddBudgetCategory requires an authenticated runtime')
  const queryClient = useQueryClient()
  const flight = useRef(false)
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async ({ budgetId, value }: { budgetId: number; value: BudgetAddCategoryWrite }) => {
      if (flight.current) throw new Error('A category addition is already pending.')
      flight.current = true
      try {
        const body = Object.freeze({ ...budgetAddCategoryWriteSchema.parse(value) })
        return await runtime.apiClient.write(createBudgetAddCategoryEndpoint(budgetId), {
          body,
          commit: () => { void queryClient.invalidateQueries({ predicate: (query) => isBudgetContentQueryForEpoch(query.queryKey, runtime.epochId) }) },
        })
      } finally { flight.current = false }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
