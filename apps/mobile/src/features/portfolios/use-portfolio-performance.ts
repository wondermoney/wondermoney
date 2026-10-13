import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createPortfolioPerformanceEndpoint, isValidPortfolioId, type PortfolioPerformancePeriod } from './portfolios-contract'
import { portfolioPerformanceKey } from './query-keys'
import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, isNotFound, usePortfolioAccessErrors } from './query-state'

export function usePortfolioPerformance(portfolioId: number | null, period: PortfolioPerformancePeriod) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioPerformance requires an authenticated runtime')
  const valid = portfolioId !== null && isValidPortfolioId(portfolioId)
  const query = useQuery({
    queryKey: portfolioPerformanceKey(runtime.epochId, valid ? portfolioId : 0, period),
    queryFn: () => runtime.apiClient.read(createPortfolioPerformanceEndpoint(portfolioId!, period)),
    enabled: valid,
    ...conservativePortfolioQueryOptions,
  })
  const errors = useMemo(() => [query.error], [query.error])
  usePortfolioAccessErrors(errors, blockAccess)
  const suppress = isAccessError(query.error) || isInvalidResponse(query.error) || isNotFound(query.error)
  return {
    ...query,
    data: suppress ? undefined : query.data,
    isAccessTransition: isAccessError(query.error),
    isInvalidResponse: isInvalidResponse(query.error),
    isNotFound: isNotFound(query.error),
  }
}
