import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  createRemoveTransactionSplitsEndpoint,
  createSetTransactionSplitsEndpoint,
  freezeSetTransactionSplits,
  type TransactionSplitLineRequest,
} from './transactions-contract'
import { isManualTransactionAffectedQuery } from './use-create-manual-transaction'

/**
 * A split moves spending between categories, so after one changes the lists, the transaction's
 * history, budgets and reports are all stale.
 */
export const isSplitAffectedQuery = (queryKey: readonly unknown[], epochId: number): boolean => (
  isManualTransactionAffectedQuery(queryKey, epochId)
  || (queryKey[0] === 'reports' && queryKey[1] === epochId)
)

/** Replaces every line of a transaction's split (at least two, summing exactly to its amount). */
export function useSetTransactionSplits() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useSetTransactionSplits requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (draft: Readonly<{ transactionId: number; lines: readonly TransactionSplitLineRequest[] }>) => {
      if (inFlight.current) throw new Error('A split change is already pending.')
      const frozen = freezeSetTransactionSplits(draft)
      inFlight.current = true
      try {
        return await runtime.apiClient.write(createSetTransactionSplitsEndpoint(frozen.transactionId), {
          body: frozen.payload,
          commit: () => {
            void queryClient.invalidateQueries({ predicate: (query) => isSplitAffectedQuery(query.queryKey, runtime.epochId) })
          },
        })
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

/** Removes the split; the transaction keeps its largest line's category. */
export function useRemoveTransactionSplits() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useRemoveTransactionSplits requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (transactionId: number) => {
      if (inFlight.current) throw new Error('A split change is already pending.')
      inFlight.current = true
      try {
        return await runtime.apiClient.write(createRemoveTransactionSplitsEndpoint(transactionId), {
          commit: () => {
            void queryClient.invalidateQueries({ predicate: (query) => isSplitAffectedQuery(query.queryKey, runtime.epochId) })
          },
        })
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
