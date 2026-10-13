import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import {
  createPortfolioDashboardEndpoint,
  createPortfolioEndpoint,
  createPortfolioHoldingsEndpoint,
  isValidPortfolioId,
} from './portfolios-contract'
import {
  conservativePortfolioQueryOptions,
  isAccessError,
  isInvalidResponse,
  isNotFound,
  usePortfolioAccessErrors,
} from './query-state'
import { portfolioDashboardKey, portfolioHoldingsKey, portfolioKey } from './query-keys'

export function usePortfolioDetail(portfolioId: number | null) {
  const { runtime, blockAccess } = useProductRuntime()
  const queryClient = useQueryClient()
  if (!runtime) throw new Error('usePortfolioDetail requires an authenticated runtime')
  const validId = portfolioId !== null && isValidPortfolioId(portfolioId)
  const keyId = validId ? portfolioId : 0

  const metadata = useQuery({
    queryKey: portfolioKey(runtime.epochId, keyId),
    queryFn: () => runtime.apiClient.read(createPortfolioEndpoint(portfolioId!)),
    enabled: validId,
    ...conservativePortfolioQueryOptions,
  })
  const canLoadFinancialData = validId && metadata.data !== undefined
  const dashboard = useQuery({
    queryKey: portfolioDashboardKey(runtime.epochId, keyId),
    queryFn: () => runtime.apiClient.read(createPortfolioDashboardEndpoint(portfolioId!)),
    enabled: canLoadFinancialData,
    ...conservativePortfolioQueryOptions,
  })
  const holdings = useQuery({
    queryKey: portfolioHoldingsKey(runtime.epochId, keyId),
    queryFn: () => runtime.apiClient.read(createPortfolioHoldingsEndpoint(portfolioId!)),
    enabled: canLoadFinancialData,
    ...conservativePortfolioQueryOptions,
  })
  const errors = useMemo(
    () => [metadata.error, dashboard.error, holdings.error],
    [dashboard.error, holdings.error, metadata.error],
  )
  usePortfolioAccessErrors(errors, blockAccess)

  const hasData = metadata.data !== undefined && dashboard.data !== undefined && holdings.data !== undefined
  const hasError = errors.some(Boolean)
  const suppressData = errors.some((error) => isAccessError(error) || isInvalidResponse(error) || isNotFound(error))

  return {
    data: hasData && !suppressData
      ? { dashboard: dashboard.data, holdings: holdings.data, metadata: metadata.data }
      : undefined,
    error: errors.find(Boolean) ?? null,
    isAccessTransition: errors.some(isAccessError),
    isInitialLoading: validId && !hasData && !hasError,
    isInvalidId: !validId,
    isInvalidResponse: errors.some(isInvalidResponse),
    isNotFound: errors.some(isNotFound),
    isRefreshFailure: hasData && hasError && !suppressData,
    isRefreshing: hasData && (metadata.isFetching || dashboard.isFetching || holdings.isFetching),
    refetch: async () => {
      const metadataResult = await metadata.refetch()
      if (metadataResult.data !== undefined) {
        // Metadata gates these queries. Fetch through the client explicitly so
        // a retry made while they are disabled still recovers both datasets;
        // calling their refetch functions here can be a no-op before React has
        // rendered the new metadata state.
        await Promise.all([
          queryClient.fetchQuery({
            queryKey: portfolioDashboardKey(runtime.epochId, keyId),
            queryFn: () => runtime.apiClient.read(createPortfolioDashboardEndpoint(portfolioId!)),
            ...conservativePortfolioQueryOptions,
            staleTime: 0,
          }),
          queryClient.fetchQuery({
            queryKey: portfolioHoldingsKey(runtime.epochId, keyId),
            queryFn: () => runtime.apiClient.read(createPortfolioHoldingsEndpoint(portfolioId!)),
            ...conservativePortfolioQueryOptions,
            staleTime: 0,
          }),
        ])
      }
    },
  }
}
