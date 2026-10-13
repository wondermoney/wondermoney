import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { accountsEndpoint } from './accounts-contract'
import { accountsKey } from './query-keys'

export function useAccounts() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAccounts requires an authenticated runtime')

  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: accountsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(accountsEndpoint),
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
    isRefreshFailure: query.isError && query.data !== undefined && !suppressFinancialData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
