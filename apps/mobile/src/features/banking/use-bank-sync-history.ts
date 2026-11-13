import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import type { BankConnectionProvider } from './connection-status-contract'
import { bankSyncHistoryKey } from './query-keys'
import { createBankSyncHistoryEndpoint } from './sync-history-contract'

/**
 * The last 20 sync runs for one connection. No retry and no focus refetch, like
 * the other banking reads: a history is a snapshot, and the screen offers an
 * explicit retry. A 404 means the connection is gone (or belongs to someone
 * else), which the screen reads as "not found" rather than an empty history.
 * `provider` picks the id space: a SimpleFIN connection has its own route.
 */
export function useBankSyncHistory(connectionId: number | null, provider: BankConnectionProvider = 'EnableBanking') {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBankSyncHistory requires an authenticated runtime')
  const query = useQuery({
    queryKey: bankSyncHistoryKey(runtime.epochId, connectionId ?? 0, provider),
    queryFn: () => runtime.apiClient.read(createBankSyncHistoryEndpoint(connectionId as number, provider)),
    enabled: connectionId !== null,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  return {
    ...query,
    isNotFound: query.error instanceof ApiError && query.error.code === 'http' && query.error.status === 404,
  }
}
