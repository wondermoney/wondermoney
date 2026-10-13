import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createAddToWatchlistEndpoint, createRemoveFromWatchlistEndpoint } from './markets-contract'
import { watchlistKey } from './query-keys'

/**
 * RAD-243 (slice 2) — add/remove are both idempotent server-side (adding an
 * already-watchlisted symbol, or removing an absent one, is a no-op, not an
 * error), so neither mutation builds a client-side "is it already there"
 * guard: the caller may always dispatch the intended action and let the
 * server settle it. `inFlight` below only guards against duplicate taps on
 * the same mutation instance while a request is outstanding — it is not a
 * membership check.
 */
function useWatchlistMembershipMutation(createEndpoint: (symbol: string) => ReturnType<typeof createAddToWatchlistEndpoint>) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useWatchlistMembershipMutation requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: false,
    mutationFn: async (symbol: string) => {
      if (inFlight.current) throw new Error('A watchlist change is already pending.')
      inFlight.current = true
      try {
        return await runtime.apiClient.write(createEndpoint(symbol), {
          commit: () => { void queryClient.invalidateQueries({ queryKey: watchlistKey(runtime.epochId) }) },
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

export function useAddToWatchlist() {
  return useWatchlistMembershipMutation(createAddToWatchlistEndpoint)
}

export function useRemoveFromWatchlist() {
  return useWatchlistMembershipMutation(createRemoveFromWatchlistEndpoint)
}
