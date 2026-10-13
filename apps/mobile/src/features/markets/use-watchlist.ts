import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createWatchlistEndpoint } from './markets-contract'
import { watchlistKey } from './query-keys'

/**
 * RAD-243 (slice 2) — same read policy as use-quote: no retry, no
 * focus/reconnect refetch, MFA routed through blockAccess.
 * Unlike use-quote there is no route param to validate — it is a single,
 * fixed list per authenticated tenant, so there is no `isInvalidId` concept.
 */
export function useWatchlist() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useWatchlist requires an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: watchlistKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(createWatchlistEndpoint()),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (query.error === handledError.current) return
    handledError.current = query.error
    if (!(query.error instanceof ApiError)) return
    if (query.error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess, query.error])

  const error = query.error instanceof ApiError ? query.error : null
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
