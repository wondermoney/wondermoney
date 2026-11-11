import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import { transactionReviewSummaryKey } from './query-keys'
import { transactionReviewSummaryEndpoint } from './transactions-contract'

/**
 * The review inbox's status for Home: how many transactions await review and
 * what their absolute amounts add up to in the reader's base currency. The API
 * counts the same rows as the list's `unreviewedOnly=true`, so the two agree.
 */
export function useTransactionReviewSummary() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionReviewSummary requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: transactionReviewSummaryKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(transactionReviewSummaryEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}
