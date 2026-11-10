import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { portfolioPerformanceReportKey } from './query-keys'
import { conservativeReportQueryOptions, isAccessError, isInvalidResponse, useReportAccessErrors } from './query-state'
import { createPortfolioPerformanceReportEndpoint, portfolioPerformanceFilters, type ReportFilters } from './reports-contract'

export function usePortfolioPerformanceReport(filters: ReportFilters) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioPerformanceReport requires an authenticated runtime')
  // Only the period applies, so changing an account or category filter does not refetch it.
  const periodFilters = portfolioPerformanceFilters(filters)
  const query = useQuery({
    queryKey: portfolioPerformanceReportKey(runtime.epochId, periodFilters),
    queryFn: () => runtime.apiClient.read(createPortfolioPerformanceReportEndpoint(periodFilters)),
    ...conservativeReportQueryOptions,
  })
  const errors = useMemo(() => [query.error], [query.error])
  useReportAccessErrors(errors, blockAccess)
  const suppress = isAccessError(query.error) || isInvalidResponse(query.error)
  return {
    ...query,
    data: suppress ? undefined : query.data,
    isAccessTransition: isAccessError(query.error),
    isInvalidResponse: isInvalidResponse(query.error),
  }
}
