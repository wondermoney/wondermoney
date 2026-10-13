import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { reportPriorPeriodFilters } from './report-prior-period'
import { spendingByCategoryReportKey } from './query-keys'
import { conservativeReportQueryOptions, isAccessError, isInvalidResponse, useReportAccessErrors } from './query-state'
import { createSpendingByCategoryEndpoint, type ReportFilters } from './reports-contract'

/**
 * Fires two independent queries: the current period (the one that drives loading/error/access
 * states) and the immediately preceding period of the same length, used only for a supplementary
 * trend indicator. The prior query's own failure is not surfaced as a hard error — mirrors web,
 * where a trend-comparison fetch failing shouldn't block the report itself from rendering.
 */
export function useSpendingByCategoryReport(filters: ReportFilters) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useSpendingByCategoryReport requires an authenticated runtime')
  const priorFilters = useMemo(() => reportPriorPeriodFilters(filters), [filters])

  const current = useQuery({
    queryKey: spendingByCategoryReportKey(runtime.epochId, filters),
    queryFn: () => runtime.apiClient.read(createSpendingByCategoryEndpoint(filters)),
    ...conservativeReportQueryOptions,
  })
  const prior = useQuery({
    queryKey: spendingByCategoryReportKey(runtime.epochId, priorFilters),
    queryFn: () => runtime.apiClient.read(createSpendingByCategoryEndpoint(priorFilters)),
    ...conservativeReportQueryOptions,
  })

  const errors = useMemo(() => [current.error], [current.error])
  useReportAccessErrors(errors, blockAccess)
  const suppress = isAccessError(current.error) || isInvalidResponse(current.error)

  return {
    ...current,
    data: suppress ? undefined : current.data,
    isAccessTransition: isAccessError(current.error),
    isInvalidResponse: isInvalidResponse(current.error),
    priorData: prior.isSuccess ? prior.data : undefined,
    priorReady: !prior.isLoading,
  }
}
