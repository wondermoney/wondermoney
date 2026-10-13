import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createHistoricalPriceEndpoint, isValidSymbol, type HistoricalPricePeriod } from './markets-contract'
import { historicalPriceKey } from './query-keys'

export function useHistoricalPrice(symbol: string | null, period: HistoricalPricePeriod) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useHistoricalPrice requires an authenticated runtime')
  const validSymbol = symbol !== null && isValidSymbol(symbol)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: historicalPriceKey(runtime.epochId, validSymbol ? symbol : '', period),
    queryFn: () => runtime.apiClient.read(createHistoricalPriceEndpoint(symbol!, period)),
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
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isAccessTransition,
  }
}
