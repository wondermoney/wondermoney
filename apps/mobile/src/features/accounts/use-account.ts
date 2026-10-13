import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createAccountDetailEndpoint, isValidAccountId } from './accounts-contract'
import { accountKey } from './query-keys'

export function useAccount(accountId: number | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAccount requires an authenticated runtime')
  const validId = accountId !== null && isValidAccountId(accountId)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: accountKey(runtime.epochId, validId ? accountId : 0),
    queryFn: () => runtime.apiClient.read(createAccountDetailEndpoint(accountId!)),
    enabled: validId,
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
  const isNotFound = error?.code === 'http' && error.status === 404
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isNotFound || isAccessTransition
  const data = suppressData ? undefined : query.data

  return {
    ...query,
    data,
    isInvalidId: !validId,
    isNotFound,
    isAccessTransition,
    isInitialFailure: validId && query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
