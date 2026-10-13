import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createAggregateMetricsEndpoint, createCashflowEndpoint, createCategorySpendingEndpoint, type DateScope } from './insights-contract'
import { aggregateMetricsKey, cashflowKey, categorySpendingKey } from './query-keys'
import { useInsightQuery } from './use-insight-query'

export function useAccountInsights(scope: DateScope, categoryLimit = 5) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Account insights require an authenticated runtime')
  const metrics = useInsightQuery(createAggregateMetricsEndpoint(scope), aggregateMetricsKey(runtime.epochId, scope))
  const cashflow = useInsightQuery(createCashflowEndpoint(scope), cashflowKey(runtime.epochId, scope))
  const categories = useInsightQuery(createCategorySpendingEndpoint(scope, categoryLimit), categorySpendingKey(runtime.epochId, scope, categoryLimit))
  return { metrics, cashflow, categories }
}
