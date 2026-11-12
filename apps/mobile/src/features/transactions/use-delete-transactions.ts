import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { accountsKey } from '@/features/accounts/query-keys'

import { transactionsRootKey } from './query-keys'
import { createDeleteTransactionEndpoint, deleteTransactionsEndpoint, type DeleteTransactionsResult } from './transactions-contract'
import { bulkSelectionBody, type TransactionBulkSelection } from './use-mark-reviewed'

/** The bank-synced rows a bulk delete skipped, which the app offers to hide. */
export const skippedBankSyncedIds = (result: DeleteTransactionsResult): number[] => result.skipped
  .filter((entry) => entry.reason === 'bank_synced')
  .flatMap((entry) => entry.transactionIds)

/**
 * Delete transactions: one row by id, or a bulk selection (ids or the list's filter). A delete
 * moves running balances, account balances and every total, so the transactions, the accounts and
 * the insights are refetched once it commits. A bank-synced row is never deleted: alone it is a
 * 409, and in a bulk request it is skipped and reported.
 */
export function useDeleteTransactions() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useDeleteTransactions requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  const commit = () => {
    void queryClient.invalidateQueries({ queryKey: transactionsRootKey(runtime.epochId) })
    void queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId) })
    void queryClient.invalidateQueries({ queryKey: ['account-insights', runtime.epochId] })
  }
  const guarded = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (inFlight.current) throw new Error('A transaction change is already pending.')
    inFlight.current = true
    try {
      return await run()
    } finally {
      inFlight.current = false
    }
  }
  const bulk = useMutation({
    retry: 0,
    mutationFn: (selection: TransactionBulkSelection) => guarded(() => runtime.apiClient.write(deleteTransactionsEndpoint, { body: bulkSelectionBody(selection), commit })),
  })
  const single = useMutation({
    retry: 0,
    mutationFn: (transactionId: number) => guarded(() => runtime.apiClient.write(createDeleteTransactionEndpoint(transactionId), { commit })),
  })
  return { bulk, single }
}
