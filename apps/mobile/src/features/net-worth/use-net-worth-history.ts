import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createNetWorthHistoryEndpoint, NET_WORTH_HISTORY_MONTHS } from './net-worth-contract'
import { netWorthHistoryKey } from './query-keys'

export function useNetWorthHistory(months: number = NET_WORTH_HISTORY_MONTHS) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useNetWorthHistory requires an authenticated runtime')

  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: netWorthHistoryKey(runtime.epochId, months),
    queryFn: () => runtime.apiClient.read(createNetWorthHistoryEndpoint(months)),
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
  const suppressFinancialData = errorCode === 'invalid-response' || isAccessTransition
  return {
    ...query,
    data: suppressFinancialData ? undefined : query.data,
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressFinancialData),
    isRefreshFailure: query.isError && query.data !== undefined && !isAccessTransition,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
