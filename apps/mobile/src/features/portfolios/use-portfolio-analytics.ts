import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { portfolioAllocationEndpoint, portfolioDividendIncomeEndpoint, portfolioMetricsEndpoint } from './portfolios-contract'
import { portfolioAnalyticsKey } from './query-keys'
import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, isRateLimited, usePortfolioAccessErrors } from './query-state'

export function usePortfolioAnalytics(enabled: boolean) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioAnalytics requires an authenticated runtime')
  const allocation = useQuery({ queryKey: portfolioAnalyticsKey(runtime.epochId, 'allocation'), queryFn: () => runtime.apiClient.read(portfolioAllocationEndpoint), enabled, ...conservativePortfolioQueryOptions })
  const dividends = useQuery({ queryKey: portfolioAnalyticsKey(runtime.epochId, 'dividends'), queryFn: () => runtime.apiClient.read(portfolioDividendIncomeEndpoint), enabled, ...conservativePortfolioQueryOptions })
  const metrics = useQuery({ queryKey: portfolioAnalyticsKey(runtime.epochId, 'metrics'), queryFn: () => runtime.apiClient.read(portfolioMetricsEndpoint), enabled, ...conservativePortfolioQueryOptions })
  const errors = useMemo(() => [allocation.error, dividends.error, metrics.error], [allocation.error, dividends.error, metrics.error])
  usePortfolioAccessErrors(errors, blockAccess)
  const hasData = allocation.data !== undefined && dividends.data !== undefined && metrics.data !== undefined
  const suppressData = errors.some((error) => isAccessError(error) || isInvalidResponse(error))
  return {
    data: hasData && !suppressData ? { allocation: allocation.data, dividends: dividends.data, metrics: metrics.data } : undefined,
    isAccessTransition: errors.some(isAccessError),
    isInitialLoading: enabled && !hasData && !errors.some(Boolean),
    isInvalidResponse: errors.some(isInvalidResponse),
    isRateLimited: errors.some(isRateLimited),
    isRefreshFailure: hasData && errors.some(Boolean) && !suppressData,
    isRefreshing: hasData && (allocation.isFetching || dividends.isFetching || metrics.isFetching),
    refetch: async () => { await Promise.all([allocation.refetch(), dividends.refetch(), metrics.refetch()]) },
  }
}
