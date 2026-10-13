import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { portfolioCurrenciesEndpoint } from './portfolios-contract'
import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, usePortfolioAccessErrors } from './query-state'
import { portfolioCurrenciesKey } from './query-keys'

export function usePortfolioCurrencies() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioCurrencies requires an authenticated runtime')
  const query = useQuery({
    queryKey: portfolioCurrenciesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(portfolioCurrenciesEndpoint),
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
