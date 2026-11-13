import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createEditTransactionAmountEndpoint, freezeSpentBy, type SpentByDraft } from './transactions-contract'
import { isTransferEditAffectedQuery } from './use-edit-transaction-transfer'

/**
 * Sets a transaction's "Spent by" (a member or Shared), or back to its account's default. It moves
 * the money between members, so everything a member filter reads refreshes: the lists, home's
 * cash flow and spending, budgets and every report.
 */
export function useEditTransactionAttribution() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useEditTransactionAttribution requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (draft: SpentByDraft) => {
      if (inFlight.current) throw new Error('A spent-by change is already pending.')
      const frozen = freezeSpentBy(draft)
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
