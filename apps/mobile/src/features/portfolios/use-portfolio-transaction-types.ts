import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { portfolioTransactionTypesEndpoint } from './portfolios-contract'
import { portfolioTransactionTypesKey } from './query-keys'
import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, usePortfolioAccessErrors } from './query-state'

export function usePortfolioTransactionTypes() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioTransactionTypes requires an authenticated runtime')
  const query = useQuery({
    queryKey: portfolioTransactionTypesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(portfolioTransactionTypesEndpoint),
    ...conservativePortfolioQueryOptions,
  })
  const errors = useMemo(() => [query.error], [query.error])
  usePortfolioAccessErrors(errors, blockAccess)
  return {
    ...query,
    data: isAccessError(query.error) || isInvalidResponse(query.error) ? undefined : query.data,
    isAccessTransition: isAccessError(query.error),
    isInvalidResponse: isInvalidResponse(query.error),
  }
}
