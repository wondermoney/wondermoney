import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { isValidAccountId } from '@/features/accounts/accounts-contract'
import { ApiError } from '@/lib/api/errors'

import { createRecentTransactionsEndpoint } from './recent-transactions-contract'
import { recentTransactionsKey } from './query-keys'

/**
 * Independently loaded recent-transactions section for the account detail. Calls the
 * dedicated least-privilege endpoint once with the path account id and no filters;
 * never falls back to the legacy transaction endpoint. No retries or focus/reconnect
 * refresh. Invalid/404/access transitions suppress rows; an ordinary refresh failure
 * may retain the previously loaded rows.
 */
export function useRecentTransactions(accountId: number | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useRecentTransactions requires an authenticated runtime')
  const validId = accountId !== null && isValidAccountId(accountId)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: recentTransactionsKey(runtime.epochId, validId ? accountId : 0),
    queryFn: () => runtime.apiClient.read(createRecentTransactionsEndpoint(accountId!)),
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
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isInvalidId: !validId,
    isNotFound,
    isAccessTransition,
    isInitialFailure: validId && query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
