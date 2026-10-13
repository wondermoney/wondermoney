import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { debtStrategyEndpoint } from './goals-contract'
import { debtStrategyKey } from './query-keys'

export function useDebtStrategy() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDebtStrategy requires an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: debtStrategyKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(debtStrategyEndpoint),
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

  const errorCode = query.error instanceof ApiError ? query.error.code : null
  const isAccessTransition = errorCode === 'mfa-required'
  const suppressData = errorCode === 'invalid-response' || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isInvalidResponse: errorCode === 'invalid-response',
    isAccessTransition,
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
