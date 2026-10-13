import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createCompanyInfoEndpoint, isValidSymbol } from './markets-contract'
import { companyInfoKey } from './query-keys'

/**
 * `/quote`'s name/currency are permanently null (see markets-contract.ts); this is the real
 * source for those two fields. Kept as its own independent query, mirroring how the watchlist
 * membership query is independent of the quote query — a still-loading or errored company-info
 * request must not block the quote screen from rendering.
 */
export function useCompanyInfo(symbol: string | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCompanyInfo requires an authenticated runtime')
  const validSymbol = symbol !== null && isValidSymbol(symbol)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: companyInfoKey(runtime.epochId, validSymbol ? symbol : ''),
    queryFn: () => runtime.apiClient.read(createCompanyInfoEndpoint(symbol!)),
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
