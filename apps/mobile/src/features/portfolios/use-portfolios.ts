import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createAggregatePortfolioDashboardEndpoint, type PortfolioPerformancePeriod, portfoliosEndpoint } from './portfolios-contract'
import {
  conservativePortfolioQueryOptions,
  isAccessError,
  isInvalidResponse,
  usePortfolioAccessErrors,
} from './query-state'
import { aggregatePortfolioDashboardKey, portfoliosKey } from './query-keys'

/**
 * The household's portfolio list and the aggregate dashboard. `member` (the Portfolios tab's
 * member filter) narrows the dashboard to the portfolios that member owns; the list stays the
 * household's, so the tab can tell a member with no portfolios from a household with none.
 */
export function usePortfolios(period: PortfolioPerformancePeriod = 'YTD', member?: string) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolios requires an authenticated runtime')

  const portfolios = useQuery({
    queryKey: portfoliosKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(portfoliosEndpoint),
    ...conservativePortfolioQueryOptions,
  })
  const dashboard = useQuery({
    queryKey: aggregatePortfolioDashboardKey(runtime.epochId, period, member),
    queryFn: () => runtime.apiClient.read(createAggregatePortfolioDashboardEndpoint(period, member)),
    // Switching period or member keeps the previous figures on screen until the new ones land.
    placeholderData: keepPreviousData,
    ...conservativePortfolioQueryOptions,
  })
  const errors = useMemo(() => [portfolios.error, dashboard.error], [dashboard.error, portfolios.error])
  usePortfolioAccessErrors(errors, blockAccess)

  const hasData = portfolios.data !== undefined && dashboard.data !== undefined
  const hasError = errors.some(Boolean)
  const suppressData = errors.some((error) => isAccessError(error) || isInvalidResponse(error))

  return {
    data: hasData && !suppressData ? { dashboard: dashboard.data, portfolios: portfolios.data } : undefined,
    error: errors.find(Boolean) ?? null,
    isAccessTransition: errors.some(isAccessError),
    isInitialLoading: !hasData && !hasError && (portfolios.isPending || dashboard.isPending),
    isInvalidResponse: errors.some(isInvalidResponse),
    isRefreshFailure: hasData && hasError && !suppressData,
    isRefreshing: hasData && (portfolios.isFetching || dashboard.isFetching),
    refetch: async () => { await Promise.all([portfolios.refetch(), dashboard.refetch()]) },
  }
}
