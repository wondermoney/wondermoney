import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createFundamentalsEndpoint, isValidSymbol } from './markets-contract'
import { fundamentalsKey } from './query-keys'

/**
 * Key-metrics TTM. `staleTime` mirrors the API's own `/fundamentals` cache window
 * (1 hour, see routes/v1/financial-markets.ts) so this hook never refetches sooner than the
 * server could possibly return fresher data.
 */
const FUNDAMENTALS_STALE_TIME_MS = 60 * 60 * 1000

export function useTickerFundamentals(symbol: string | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTickerFundamentals requires an authenticated runtime')
  const validSymbol = symbol !== null && isValidSymbol(symbol)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: fundamentalsKey(runtime.epochId, validSymbol ? symbol : ''),
    queryFn: () => runtime.apiClient.read(createFundamentalsEndpoint(symbol!)),
    enabled: validSymbol,
    staleTime: FUNDAMENTALS_STALE_TIME_MS,
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
