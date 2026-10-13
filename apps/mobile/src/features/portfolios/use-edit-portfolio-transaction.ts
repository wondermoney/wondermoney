import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { createEditPortfolioTransactionEndpoint, freezePortfolioTransactionEdit, isValidPortfolioId, type PortfolioTransactionEditDraft } from './portfolios-contract'
import { isPortfolioContentQueryForEpoch } from './query-keys'

export type EditPortfolioTransactionFailure = 'demo' | 'access' | 'mfa' | 'not-found' | 'cancelled' | 'unknown' | 'request' | 'general'

export function classifyEditPortfolioTransactionFailure(error: unknown): EditPortfolioTransactionFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'request' : 'general'
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

export function useEditPortfolioTransaction(portfolioId: number) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useEditPortfolioTransaction requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ transactionId, draft }: { transactionId: number; draft: PortfolioTransactionEditDraft }) => {
      if (!isValidPortfolioId(portfolioId)) throw new Error('A positive safe portfolio id is required.')
      const body = freezePortfolioTransactionEdit(draft)
      return runtime.apiClient.write(createEditPortfolioTransactionEndpoint(portfolioId, transactionId), {
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
