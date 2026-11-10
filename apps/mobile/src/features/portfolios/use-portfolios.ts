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

export function usePortfolios(period: PortfolioPerformancePeriod = 'YTD') {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolios requires an authenticated runtime')

  const portfolios = useQuery({
    queryKey: portfoliosKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(portfoliosEndpoint),
    ...conservativePortfolioQueryOptions,
  })
  const dashboard = useQuery({
    queryKey: aggregatePortfolioDashboardKey(runtime.epochId, period),
    queryFn: () => runtime.apiClient.read(createAggregatePortfolioDashboardEndpoint(period)),
    // Switching period keeps the previous figures on screen until the new ones land.
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
