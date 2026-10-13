import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { householdEndpoint } from './household-contract'
import { householdKey } from './query-keys'

export function useHousehold() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useHousehold requires an authenticated runtime')

  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: householdKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(householdEndpoint),
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
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
