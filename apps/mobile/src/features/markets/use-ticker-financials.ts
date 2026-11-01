import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createFinancialsEndpoint, isValidSymbol } from './markets-contract'
import { financialsKey } from './query-keys'

/**
 * Periodic income statement. `staleTime` mirrors the API's own `/financials` cache
 * window (3 days, see routes/v1/financial-markets.ts) — this data changes on a quarterly
 * reporting cadence, not intraday.
 */
const FINANCIALS_STALE_TIME_MS = 3 * 24 * 60 * 60 * 1000

export function useTickerFinancials(symbol: string | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTickerFinancials requires an authenticated runtime')
  const validSymbol = symbol !== null && isValidSymbol(symbol)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: financialsKey(runtime.epochId, validSymbol ? symbol : ''),
    queryFn: () => runtime.apiClient.read(createFinancialsEndpoint(symbol!)),
    enabled: validSymbol,
    staleTime: FINANCIALS_STALE_TIME_MS,
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
  }
}
