import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { accountTransactionsKey, transactionsKey } from './query-keys'
import {
  createAccountTransactionsEndpoint,
  createAggregateTransactionsEndpoint,
  type TransactionFilters,
} from './transactions-contract'

export function useTransactions(filters: TransactionFilters, accountId: number | null = null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTransactions requires an authenticated runtime')
  const isAccountQuery = accountId !== null
  const validAccount = !isAccountQuery || (Number.isSafeInteger(accountId) && accountId > 0)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: isAccountQuery
      ? accountTransactionsKey(runtime.epochId, validAccount ? accountId : 0, filters)
      : transactionsKey(runtime.epochId, filters),
    queryFn: () => runtime.apiClient.read(isAccountQuery
      ? createAccountTransactionsEndpoint(accountId!, filters)
      : createAggregateTransactionsEndpoint(filters)),
    enabled: validAccount,
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
    isInvalidAccountId: !validAccount,
    isNotFound,
    isAccessTransition,
    isInitialFailure: validAccount && query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
