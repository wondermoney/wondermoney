import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createAccountMetricsEndpoint } from './insights-contract'
import { accountMetricsKey } from './query-keys'
import { useInsightQuery } from './use-insight-query'

export function useAccountMetrics(accountId: number | null, fromDate: string) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Account metrics require an authenticated runtime')
  const valid = accountId !== null && Number.isSafeInteger(accountId) && accountId > 0
  const query = useInsightQuery(createAccountMetricsEndpoint(valid ? accountId : 1, fromDate), accountMetricsKey(runtime.epochId, valid ? accountId : 0, fromDate), valid)
  return { ...query, isInvalidId: !valid }
}
