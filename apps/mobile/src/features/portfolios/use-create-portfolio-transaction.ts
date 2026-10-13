import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import {
  createCreatePortfolioTransactionEndpoint,
  freezePortfolioTransactionCreate,
  isValidPortfolioId,
  type PortfolioTransactionCreateDraft,
} from './portfolios-contract'
import { isPortfolioContentQueryForEpoch } from './query-keys'

export type CreatePortfolioTransactionFailure = 'demo' | 'access' | 'mfa' | 'cancelled' | 'invalid' | 'invalid-response' | 'unknown' | 'general'

export function classifyCreatePortfolioTransactionFailure(error: unknown): CreatePortfolioTransactionFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (isPostDispatchCancellation(error)) return 'unknown'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'invalid-response') return 'invalid-response'
  if (error.code === 'network' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && (error.status ?? 0) >= 400) return 'invalid'
  return 'general'
}

export function useCreatePortfolioTransaction(portfolioId: number) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreatePortfolioTransaction requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (draft: PortfolioTransactionCreateDraft) => {
      if (!isValidPortfolioId(portfolioId)) throw new Error('A positive safe portfolio id is required.')
      const body = freezePortfolioTransactionCreate(draft)
      return runtime.apiClient.write(createCreatePortfolioTransactionEndpoint(portfolioId), {
        body,
        commit: () => {
          void queryClient.invalidateQueries({
            predicate: (query) => isPortfolioContentQueryForEpoch(query.queryKey, runtime.epochId),
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
