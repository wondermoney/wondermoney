import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { reimbursementSuggestionsKey, transactionReimbursementsKey } from './query-keys'
import {
  createLinkReimbursementEndpoint,
  createReimbursementSuggestionsEndpoint,
  createTransactionReimbursementsEndpoint,
  createUnlinkReimbursementEndpoint,
  freezeLinkReimbursement,
  type LinkReimbursementDraft,
} from './reimbursements-contract'
import { isSplitAffectedQuery } from './use-transaction-splits'

const validId = (transactionId: number) => Number.isSafeInteger(transactionId) && transactionId > 0

/** A transaction's links, in either role, with what is left of its amount to link. */
export function useTransactionReimbursements(transactionId: number) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionReimbursements requires an authenticated runtime')
  return useQuery({
    queryKey: transactionReimbursementsKey(runtime.epochId, transactionId),
    queryFn: () => runtime.apiClient.read(createTransactionReimbursementsEndpoint(transactionId)),
    enabled: validId(transactionId),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/** Candidates for the other side; `search` (already trimmed and settled) narrows them by text. */
export function useReimbursementSuggestions(transactionId: number, search: string) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useReimbursementSuggestions requires an authenticated runtime')
  return useQuery({
    queryKey: reimbursementSuggestionsKey(runtime.epochId, transactionId, search),
    queryFn: () => runtime.apiClient.read(createReimbursementSuggestionsEndpoint(transactionId, { search })),
    enabled: validId(transactionId),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    // Typing a search keeps the last list on screen until the new one arrives.
    placeholderData: (previous) => previous,
  })
}

/**
 * A link moves spending off the expense's categories and off income, so after one changes the
 * same queries a split change touches are stale: the lists (and the links in them), budgets,
 * reports and net worth.
 */
export function useLinkReimbursement() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useLinkReimbursement requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (draft: LinkReimbursementDraft) => {
      if (inFlight.current) throw new Error('A reimbursement change is already pending.')
      const frozen = freezeLinkReimbursement(draft)
      inFlight.current = true
      try {
        return await runtime.apiClient.write(createLinkReimbursementEndpoint(frozen.transactionId), {
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

/** Removes one link; `transactionId` may be either side. */
export function useUnlinkReimbursement() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useUnlinkReimbursement requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: 0,
    mutationFn: async (target: Readonly<{ transactionId: number; transactionReimbursementKey: number }>) => {
      if (inFlight.current) throw new Error('A reimbursement change is already pending.')
      const endpoint = createUnlinkReimbursementEndpoint(target.transactionId, target.transactionReimbursementKey)
      inFlight.current = true
      try {
        return await runtime.apiClient.write(endpoint, {
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
