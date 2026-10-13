import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { createDeletePortfolioTransactionEndpoint, isValidPortfolioId } from './portfolios-contract'
import { isPortfolioContentQueryForEpoch } from './query-keys'

export type DeletePortfolioTransactionFailure = 'demo' | 'access' | 'mfa' | 'not-found' | 'cancelled' | 'unknown' | 'request' | 'general'

export function classifyDeletePortfolioTransactionFailure(error: unknown): DeletePortfolioTransactionFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (isPostDispatchCancellation(error)) return 'unknown'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'http' && (error.status ?? 0) >= 400) return 'request'
  return 'general'
}

export function useDeletePortfolioTransaction(portfolioId: number) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDeletePortfolioTransaction requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (transactionId: number) => {
      if (!isValidPortfolioId(portfolioId)) throw new Error('A positive safe portfolio id is required.')
      return runtime.apiClient.write(createDeletePortfolioTransactionEndpoint(portfolioId, transactionId), {
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
