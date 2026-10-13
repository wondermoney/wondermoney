import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { ApiError } from '@/lib/api/errors'
import { ApiError as RuntimeApiError } from '@/lib/api/errors'
import type { ReadEndpoint } from '@/lib/api/runtime-schema'

import { profileEndpoint } from './self-contracts'
import { profileKey } from './query-keys'

function useSelfResource<Value>(endpoint: ReadEndpoint<Value>) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('Self resource requires an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const key = profileKey(runtime.epochId)
  const query = useQuery({
    queryKey: key,
    queryFn: () => runtime.apiClient.read(endpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (query.error === handledError.current) return
    handledError.current = query.error
    if (!(query.error instanceof RuntimeApiError)) return
    if (query.error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess, query.error])

  const error = query.error instanceof RuntimeApiError ? query.error as ApiError : null
  const isNotFound = error?.code === 'http' && error.status === 404
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isNotFound || isAccessTransition
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

export const useProfile = () => useSelfResource(profileEndpoint)
