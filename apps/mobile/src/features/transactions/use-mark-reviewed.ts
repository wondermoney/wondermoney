import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { transactionsRootKey } from './query-keys'
import { type TransactionFilters, transactionFilterParams, updateTransactionsEndpoint } from './transactions-contract'

/**
 * The rows a bulk change acts on: loaded ids, or `filter` — every row the list's server filters
 * match ("select all matching"), at most 5,000, which the API resolves itself.
 */
export type TransactionBulkSelection =
  | Readonly<{ transactionIds: readonly number[]; filter?: undefined }>
  /** `accountId`: one account's ledger, whose list is that account's rows only. */
  | Readonly<{ filter: TransactionFilters; accountId?: number | null; transactionIds?: undefined }>

export type TransactionBulkAction = TransactionBulkSelection & (
  | Readonly<{ type: 'review' }>
  | Readonly<{ type: 'category'; categoryId: number }>
  | Readonly<{ type: 'hidden' }>
  | Readonly<{ type: 'unhidden' }>
  | Readonly<{ type: 'addTag'; tagId: number }>
  | Readonly<{ type: 'removeTag'; tagId: number }>
)

/** The selection as the request body names it. */
export function bulkSelectionBody(selection: TransactionBulkSelection): { transactionIds: number[] } | { filter: Record<string, string> } {
  if (!selection.filter) return { transactionIds: normalizePersistedTransactionIds(selection.transactionIds ?? []) }
  const filter = transactionFilterParams(selection.filter)
  return { filter: selection.accountId ? { ...filter, accountKeys: String(selection.accountId) } : filter }
}

const changeOf = (action: TransactionBulkAction) => {
  switch (action.type) {
    case 'review': return { reviewed: true }
    case 'category': return { categoryId: String(action.categoryId) }
    case 'hidden': return { hidden: true }
    case 'unhidden': return { hidden: false }
    case 'addTag': return { addTagIds: [action.tagId] }
    case 'removeTag': return { removeTagIds: [action.tagId] }
  }
}

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
      const selection = bulkSelectionBody(action)
      if (action.type === 'category' && (!Number.isSafeInteger(action.categoryId) || action.categoryId <= 0)) {
        throw new Error('A positive category id is required.')
      }
      if ((action.type === 'addTag' || action.type === 'removeTag') && (!Number.isSafeInteger(action.tagId) || action.tagId <= 0)) {
        throw new Error('A positive tag id is required.')
      }
      inFlight.current = true
      try {
        return await runtime.apiClient.write(updateTransactionsEndpoint, {
          body: { ...selection, ...changeOf(action) },
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
