import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { archivedGoalsEndpoint, goalsEndpoint } from './goals-contract'
import { archivedGoalsKey, goalsKey } from './query-keys'

export function useGoals(includeArchived = false) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useGoals requires an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: includeArchived ? archivedGoalsKey(runtime.epochId) : goalsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(includeArchived ? archivedGoalsEndpoint : goalsEndpoint),
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
  const isNotFound = query.error instanceof ApiError
    && query.error.code === 'http'
    && query.error.status === 404
  const isAccessTransition = errorCode === 'mfa-required'
  const suppressData = errorCode === 'invalid-response' || isAccessTransition || isNotFound
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isNotFound,
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
