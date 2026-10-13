import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { createManualTransactionEndpoint, type FrozenManualTransaction } from './manual-transaction-contract'

export type ManualTransactionFailure = 'unknown' | 'demo' | 'access' | 'mfa' | 'validation' | 'cancelled'

export const isManualTransactionAffectedQuery = (queryKey: QueryKey, epochId: number): boolean => (
  (queryKey[0] === 'transactions' && queryKey[1] === epochId)
  || (queryKey[0] === 'accounts' && queryKey[1] === epochId)
  || (queryKey[0] === 'account' && queryKey[1] === epochId)
  || (queryKey[0] === 'account-insights' && queryKey[1] === epochId)
  || (queryKey[0] === 'budgets' && queryKey[2] === epochId)
  || (queryKey[0] === 'recurring' && queryKey[1] === epochId)
  || (queryKey[0] === 'net-worth' && queryKey[1] === epochId)
)

export function classifyManualTransactionFailure(error: unknown): ManualTransactionFailure {
  if (!(error instanceof ApiError)) return 'validation'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500) return 'validation'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'unknown' : 'cancelled'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  return 'unknown'
}

export function useCreateManualTransaction() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateManualTransaction requires an authenticated runtime')
  const queryClient = useQueryClient()
  const dispatched = useRef(false)

  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (frozen: FrozenManualTransaction) => {
      if (dispatched.current) throw new Error('This reviewed transaction has already been submitted.')
      dispatched.current = true
      let refresh: Promise<void> | undefined
      try {
        const result = await runtime.apiClient.write(createManualTransactionEndpoint(frozen.accountId), {
          body: frozen.payload,
          commit: () => {
            refresh = queryClient.invalidateQueries({ predicate: (query) => isManualTransactionAffectedQuery(query.queryKey, runtime.epochId) })
          },
        })
        await refresh
        return result
      } catch (error) {
        if (classifyManualTransactionFailure(error) !== 'unknown') dispatched.current = false
        throw error
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })

  return mutation
}
