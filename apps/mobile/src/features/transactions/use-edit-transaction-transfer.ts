import type { QueryKey } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createEditTransactionAmountEndpoint, freezeTransferEdit, type TransferEditDraft } from './transactions-contract'
import { isManualTransactionAffectedQuery } from './use-create-manual-transaction'

/**
 * What re-typing a transaction changes: everything a manual transaction touches (the lists,
 * balances, home cash flow, budgets) and every report, since transfers are left out of them.
 */
export const isTransferEditAffectedQuery = (queryKey: QueryKey, epochId: number): boolean => (
  isManualTransactionAffectedQuery(queryKey, epochId)
  || (queryKey[0] === 'reports' && queryKey[1] === epochId)
)

/** Marks a transaction as a transfer (optionally with where it went), or back as not one. */
export function useEditTransactionTransfer() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useEditTransactionTransfer requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (draft: TransferEditDraft) => {
      if (inFlight.current) throw new Error('A transfer change is already pending.')
      const frozen = freezeTransferEdit(draft)
      inFlight.current = true
      try {
        return await runtime.apiClient.write(createEditTransactionAmountEndpoint(frozen.transactionId), {
          body: frozen.payload,
          commit: () => {
            void queryClient.invalidateQueries({ predicate: (query) => isTransferEditAffectedQuery(query.queryKey, runtime.epochId) })
          },
        })
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
