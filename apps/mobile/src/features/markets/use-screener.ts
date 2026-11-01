import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createScreenerEndpoint, type ScreenerFilters } from './markets-contract'
import { screenerKey } from './query-keys'

const DISABLED_FILTERS: ScreenerFilters = { isEtf: false, isActivelyTrading: true, page: 0, limit: 0 }

/**
 * Same read policy as use-quote / use-watchlist: no
 * retry, no focus/reconnect refetch, MFA routed through
 * blockAccess. `filters` mirrors use-quote's null-until-ready contract:
 * the screener route only supplies filters once the user has pressed
 * "Apply filters" for the first time, so `null` here disables the query
 * entirely and fires zero requests before that.
 *
 * This fetches one page at a time (like use-quote fetches one symbol)
 * rather than accumulating pages itself via `useInfiniteQuery` — the
 * screener route owns page accumulation, since it also needs to reset
 * accumulated results on every new filter submission.
 */
export function useScreener(filters: ScreenerFilters | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useScreener requires an authenticated runtime')
  const enabled = filters !== null
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: screenerKey(runtime.epochId, filters ?? DISABLED_FILTERS),
    queryFn: () => runtime.apiClient.read(createScreenerEndpoint(filters!)),
    enabled,
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
    isInitialFailure: enabled && query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
