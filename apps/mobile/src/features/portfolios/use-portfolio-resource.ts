import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { ReadEndpoint } from '@/lib/api/runtime-schema'

import { conservativePortfolioQueryOptions, isAccessError, isInvalidResponse, usePortfolioAccessErrors } from './query-state'

/** One supplementary section's data: it loads, fails or shows on its own, never blocking the page. */
export type PortfolioResourceState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: T }

/**
 * A read for one page section (top movers, allocation, holdings) with the feature's conservative
 * query options and MFA handling.
 */
export function usePortfolioResource<T>(
  queryKey: (epochId: number) => readonly unknown[],
  endpoint: () => ReadEndpoint<T>,
  enabled = true,
  /** Keep the last figures while a new key (another period) loads. Never across portfolios. */
  keepPrevious = false,
): { state: PortfolioResourceState<T>; isAccessTransition: boolean; refetch: () => Promise<unknown> } {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioResource requires an authenticated runtime')
  const query = useQuery<T, Error, T, readonly unknown[]>({
    queryKey: queryKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(endpoint()),
    enabled,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    ...conservativePortfolioQueryOptions,
  })
  const errors = useMemo(() => [query.error], [query.error])
  usePortfolioAccessErrors(errors, blockAccess)
  const suppress = isAccessError(query.error) || isInvalidResponse(query.error)
  const state: PortfolioResourceState<T> = query.data !== undefined && !suppress
    ? { status: 'loaded', data: query.data }
    : query.error ? { status: 'error' } : { status: 'loading' }
  return { state, isAccessTransition: isAccessError(query.error), refetch: query.refetch }
}
