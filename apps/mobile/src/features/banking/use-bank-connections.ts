import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { resolveConnectionsPollIntervalMs } from './connection-poll-policy'
import { createBankConnectionsEndpoint, type BankConnectionsResponseDto } from './connection-status-contract'
import { bankConnectionsKey } from './query-keys'

/**
 * Read-only bank connection status loader. Mirrors the
 * read pattern of use-self-resource / use-net-worth-history: no retry, no
 * focus/reconnect refetch, MFA routed through blockAccess.
 * Invalid-response and 404 suppress the data so the screen can render a
 * safe "could not load" state instead of a stale answer. The endpoint
 * contract validates the fields the screen uses and strips the rest, so an
 * additive API change doesn't fail the list.
 *
 * Bounded polling: mobile has no push/webhook signal for when
 * a just-started bank connection finishes syncing, so while any
 * connection reads `processing` this refetches on a fixed interval (see
 * connection-poll-policy.ts) instead of leaving the user staring at a
 * stale status with only a manual pull-to-refresh.
 */
export function useBankConnections() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useBankConnections requires an authenticated runtime')
  const handledError = useRef<unknown>(null)
  const processingSince = useRef<number | null>(null)
  const query = useQuery({
    queryKey: bankConnectionsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(createBankConnectionsEndpoint()),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    refetchInterval: (activeQuery: { state: { data?: BankConnectionsResponseDto } }) => {
      const rows = activeQuery.state.data?.connections
      const now = Date.now()
      const hasProcessing = Boolean(rows?.some((row) => row.status === 'processing'))
      processingSince.current = hasProcessing ? (processingSince.current ?? now) : null
      return resolveConnectionsPollIntervalMs(rows, processingSince.current, now)
    },
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
    isNotFound,
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
