import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createQuoteEndpoint, isValidSymbol } from './markets-contract'
import { quoteKey } from './query-keys'

/**
 * Same read policy as use-account: no retry, no
 * focus/reconnect refetch, MFA routed through blockAccess.
 * `symbol` mirrors accountId's null-until-parsed contract: the route
 * validates the param via parseSymbol before this hook ever sees it.
 */
export function useQuote(symbol: string | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useQuote requires an authenticated runtime')
  const validSymbol = symbol !== null && isValidSymbol(symbol)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: quoteKey(runtime.epochId, validSymbol ? symbol : ''),
    queryFn: () => runtime.apiClient.read(createQuoteEndpoint(symbol!)),
    enabled: validSymbol,
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
  const isNotFound = error?.code === 'http' && error.status === 404
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isNotFound || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isInvalidId: !validSymbol,
    isNotFound,
    isAccessTransition,
    isInitialFailure: validSymbol && query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
