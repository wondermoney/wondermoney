import { useMemo } from 'react'

import { createCategorySpendingEndpoint } from './insights-contract'
import { createInsightDateScope } from './date-scope'
import { categorySpendingKey } from './query-keys'
import { useInsightQuery } from './use-insight-query'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'

/**
 * RAD-198 — dashboard insights teaser. Requests exactly the top-1 spending
 * category for the current month, not the full account-insights bundle
 * (metrics + cashflow + categories) the dedicated Insights screen loads —
 * a dashboard card doesn't need per-account rows or a cashflow series.
 * Shares its query key with the full insights screen's category query so
 * navigating there doesn't refetch redundantly.
 *
 * `now` is optional and falls back to a value memoized once per mount, not a
 * bare `new Date()` default: a default parameter is re-evaluated on every
 * call, so an unmemoized caller (the dashboard route never supplied one) fed
 * a millisecond-fresh timestamp into the query key on every render. React
 * Query treats a structurally different key as a brand-new query regardless
 * of staleTime, so every render re-fetched, whose settling (success or
 * error) triggered the next render — an unthrottled loop bounded only by
 * network round-trip time. Caught in production testing as a sustained
 * ~15-20 req/s flood against the live API the moment the dashboard mounted.
 */
export function useTopSpendingCategory(now?: Date) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Account insights require an authenticated runtime')
  const fallbackNow = useMemo(() => new Date(), [])
  const scope = createInsightDateScope('month', now ?? fallbackNow)
  return useInsightQuery(createCategorySpendingEndpoint(scope, 1), categorySpendingKey(runtime.epochId, scope, 1))
}
