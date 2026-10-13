import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import type { ReadEndpoint } from '@/lib/api/runtime-schema'

function useRecurringResource<Value>(endpoint: ReadEndpoint<Value>, key: (epochId: number) => readonly unknown[]) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('Recurring resources require an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: key(runtime.epochId),
    queryFn: () => runtime.apiClient.read(endpoint),
    retry: false,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
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

export { useRecurringResource }
