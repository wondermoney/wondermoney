import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createEditTransactionAmountEndpoint, freezeEditTransactionAmount, type EditTransactionAmountDraft } from './transactions-contract'
import { isManualTransactionAffectedQuery } from './use-create-manual-transaction'

export function useEditTransactionAmount() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useEditTransactionAmount requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (draft: EditTransactionAmountDraft) => {
      if (inFlight.current) throw new Error('An amount change is already pending.')
      const frozen = freezeEditTransactionAmount(draft)
      inFlight.current = true
      try {
        return await runtime.apiClient.write(createEditTransactionAmountEndpoint(frozen.transactionId), {
          body: frozen.payload,
          commit: () => {
            void queryClient.invalidateQueries({ predicate: (query) => isManualTransactionAffectedQuery(query.queryKey, runtime.epochId) })
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
