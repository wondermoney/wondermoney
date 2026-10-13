import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createPortfolioEndpoint, isValidPortfolioId } from './portfolios-contract'
import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, isNotFound, usePortfolioAccessErrors } from './query-state'
import { portfolioKey } from './query-keys'

export function usePortfolioMetadata(portfolioId: number | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioMetadata requires an authenticated runtime')
  const valid = portfolioId !== null && isValidPortfolioId(portfolioId)
  const query = useQuery({
    queryKey: portfolioKey(runtime.epochId, valid ? portfolioId : 0),
    queryFn: () => runtime.apiClient.read(createPortfolioEndpoint(portfolioId!)),
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
    isInvalidId: !valid,
    isInvalidResponse: isInvalidResponse(query.error),
    isNotFound: isNotFound(query.error),
  }
}
