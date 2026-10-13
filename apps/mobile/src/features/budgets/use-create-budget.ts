import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { budgetCreateWriteSchema, createBudgetEndpoint, type BudgetCreateWrite } from './budgets-contract'
import { isBudgetQueryForEpoch } from './query-keys'

export type CreateBudgetFailure = 'unknown' | 'demo' | 'access' | 'invalid' | 'general'

export const classifyCreateBudgetFailure = (error: unknown): CreateBudgetFailure => {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'cancelled' || error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  return 'general'
}

export function useCreateBudget() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateBudget requires an authenticated runtime')
  const queryClient = useQueryClient()
  const flight = useRef(false)
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: BudgetCreateWrite) => {
      if (flight.current) throw new Error('A budget creation is already pending.')
      flight.current = true
      try {
        const parsed = budgetCreateWriteSchema.parse(input)
        const frozen = Object.freeze({ ...parsed, incomes: Object.freeze(parsed.incomes.map((income) => Object.freeze({ ...income }))) })
        return await runtime.apiClient.write(createBudgetEndpoint, {
          body: frozen,
          commit: () => { void queryClient.invalidateQueries({ predicate: (query) => isBudgetQueryForEpoch(query.queryKey, runtime.epochId) }) },
        })
      } finally { flight.current = false }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
