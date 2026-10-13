import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import type { ReadEndpoint } from '@/lib/api/runtime-schema'

export function useInsightQuery<Value>(endpoint: ReadEndpoint<Value>, queryKey: readonly unknown[], enabled = true) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('Account insights require an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey,
    queryFn: () => runtime.apiClient.read(endpoint),
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
  const suppress = error?.code === 'invalid-response' || isAccessTransition
  return { ...query, data: suppress ? undefined : query.data, isAccessTransition, isRefreshFailure: query.isError && query.data !== undefined && !suppress, isRefreshing: query.isFetching && query.data !== undefined }
}
