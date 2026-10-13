import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createSearchTickersEndpoint } from './markets-contract'
import { tickerSearchKey } from './query-keys'
import { useDebouncedValue } from './use-debounced-value'

/**
 * RAD-238 (slice 1) — 300ms feels responsive without firing a request on
 * every keystroke; short enough that users don't perceive a delay, long
 * enough to collapse a burst of keystrokes into one request.
 */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * Read-only ticker search, same shape as use-bank-institutions: no retry,
 * no focus/reconnect refetch, MFA routed through blockAccess.
 * The raw term is debounced here and trimmed before it ever reaches the
 * query key or the request — an empty/blank term after trimming disables
 * the query entirely so no request fires before the user types anything
 * (the API already handles an empty searchTerm server-side, but skipping
 * the request client-side avoids pointless traffic on every keystroke).
 */
export function useTickerSearch(searchTerm: string) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTickerSearch requires an authenticated runtime')
  const debouncedTerm = useDebouncedValue(searchTerm, SEARCH_DEBOUNCE_MS).trim()
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: tickerSearchKey(runtime.epochId, debouncedTerm),
    queryFn: () => runtime.apiClient.read(createSearchTickersEndpoint(debouncedTerm)),
    enabled: debouncedTerm.length > 0,
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
  }
}
