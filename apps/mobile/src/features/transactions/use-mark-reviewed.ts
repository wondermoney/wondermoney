import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { transactionsRootKey } from './query-keys'
import { updateTransactionsEndpoint } from './transactions-contract'

export type TransactionBulkAction =
  | Readonly<{ transactionIds: readonly number[]; type: 'review' }>
  | Readonly<{ transactionIds: readonly number[]; type: 'category'; categoryId: number }>
  | Readonly<{ transactionIds: readonly number[]; type: 'hidden' }>
  | Readonly<{ transactionIds: readonly number[]; type: 'unhidden' }>

export function normalizePersistedTransactionIds(transactionIds: readonly number[]): number[] {
  if (transactionIds.length === 0 || transactionIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Only positive persisted transactions can be changed.')
  }
  return [...new Set(transactionIds)].sort((left, right) => left - right)
}

export function useTransactionBulkActions() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionBulkActions requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (action: TransactionBulkAction) => {
      if (inFlight.current) throw new Error('A transaction change is already pending.')
      const transactionIds = normalizePersistedTransactionIds(action.transactionIds)
      if (action.type === 'category' && (!Number.isSafeInteger(action.categoryId) || action.categoryId <= 0)) {
        throw new Error('A positive category id is required.')
      }
      inFlight.current = true
      try {
        return await runtime.apiClient.write(updateTransactionsEndpoint, {
          body: action.type === 'review'
            ? { transactionIds, reviewed: true }
            : action.type === 'category'
              ? { transactionIds, categoryId: String(action.categoryId) }
              : { transactionIds, hidden: action.type === 'hidden' },
          commit: () => {
            void queryClient.invalidateQueries({ queryKey: transactionsRootKey(runtime.epochId) })
            void queryClient.invalidateQueries({ queryKey: ['account-insights', runtime.epochId] })
            if (action.type === 'category') {
              void queryClient.invalidateQueries({ queryKey: ['budgets', 'month', runtime.epochId] })
              void queryClient.invalidateQueries({ queryKey: ['recurring', runtime.epochId] })
            }
          },
        })
      } finally {
        inFlight.current = false
      }
    },
  })
}

export function useMarkTransactionReviewed() {
  const bulk = useTransactionBulkActions()
  return {
    ...bulk,
    mutate: (transactionId: number, options?: Parameters<typeof bulk.mutate>[1]) => bulk.mutate({ type: 'review', transactionIds: [transactionId] }, options),
    mutateAsync: (transactionId: number, options?: Parameters<typeof bulk.mutateAsync>[1]) => bulk.mutateAsync({ type: 'review', transactionIds: [transactionId] }, options),
  }
}
