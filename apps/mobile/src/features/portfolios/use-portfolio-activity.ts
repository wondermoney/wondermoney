import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createPortfolioActivityEndpoint, type PortfolioActivityFilters, isValidPortfolioId } from './portfolios-contract'
import { portfolioActivityKey } from './query-keys'
import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, isNotFound, isRateLimited, usePortfolioAccessErrors } from './query-state'

export function usePortfolioActivity(portfolioId: number | null | 'aggregate', filters: PortfolioActivityFilters | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioActivity requires an authenticated runtime')
  const validPortfolio = portfolioId === 'aggregate' || (portfolioId !== null && isValidPortfolioId(portfolioId))
  const enabled = validPortfolio && filters !== null
  const query = useQuery({
    queryKey: portfolioActivityKey(runtime.epochId, portfolioId ?? 0, filters?.fromDate, filters?.toDate),
    queryFn: () => runtime.apiClient.read(createPortfolioActivityEndpoint(portfolioId === 'aggregate' ? null : portfolioId!, filters!)),
    enabled,
    ...conservativePortfolioQueryOptions,
  })
  const accessErrors = useMemo(() => [query.error], [query.error])
  usePortfolioAccessErrors(accessErrors, blockAccess)
  const hasData = query.data !== undefined
  const suppressData = isAccessError(query.error) || isInvalidResponse(query.error) || isNotFound(query.error)
  return {
    data: hasData && !suppressData ? query.data : undefined,
    isAccessTransition: isAccessError(query.error),
    isInitialLoading: enabled && !hasData && query.error === null,
    isInvalidRequest: !enabled,
    isInvalidResponse: isInvalidResponse(query.error),
    isNotFound: isNotFound(query.error),
    isRateLimited: isRateLimited(query.error),
    isRefreshFailure: hasData && query.error !== null && !suppressData,
    isRefreshing: hasData && query.isFetching,
    refetch: query.refetch,
  }
}
