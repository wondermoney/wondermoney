import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createPortfolioDividendIncomeEndpoint, isValidPortfolioId } from './portfolios-contract'
import { portfolioDividendIncomeKey } from './query-keys'
import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, isRateLimited, usePortfolioAccessErrors } from './query-state'

/**
 * RAD-515 — per-portfolio dividend income, kept as its own independent query (same pattern as
 * usePortfolioPerformance alongside usePortfolioDetail) rather than folded into the detail hook:
 * dividend income is supplementary, so a slow or failed fetch here must never block the rest of
 * the detail page from rendering.
 */
export function usePortfolioDividendIncome(portfolioId: number | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioDividendIncome requires an authenticated runtime')
  const valid = portfolioId !== null && isValidPortfolioId(portfolioId)
  const query = useQuery({
    queryKey: portfolioDividendIncomeKey(runtime.epochId, valid ? portfolioId : 0),
    queryFn: () => runtime.apiClient.read(createPortfolioDividendIncomeEndpoint(portfolioId!)),
    enabled: valid,
    ...conservativePortfolioQueryOptions,
  })
  const errors = useMemo(() => [query.error], [query.error])
  usePortfolioAccessErrors(errors, blockAccess)
  const suppress = isAccessError(query.error) || isInvalidResponse(query.error)
  return {
    ...query,
    data: suppress ? undefined : query.data,
    isAccessTransition: isAccessError(query.error),
    isInvalidResponse: isInvalidResponse(query.error),
    isRateLimited: isRateLimited(query.error),
  }
}
