import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { createPortfolioSettingsEndpoint, portfolioSettingsWriteSchema, type PortfolioSettingsWrite } from './portfolios-contract'
import { aggregatePortfolioDashboardKey, portfolioKey, portfolioSettingsUnknownKey, portfoliosKey } from './query-keys'

export type PortfolioSettingsFailure = 'validation' | 'demo' | 'access' | 'mfa' | 'not-found' | 'cancelled' | 'unknown' | 'request' | 'general'
export type PortfolioSettingsUnknown = Readonly<{ payload: Readonly<PortfolioSettingsWrite> }>
const activeSettings = new WeakMap<object, Set<string>>()
const locksFor = (client: object) => { let value = activeSettings.get(client); if (!value) { value = new Set(); activeSettings.set(client, value) }; return value }

export function classifyPortfolioSettingsFailure(error: unknown): PortfolioSettingsFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'validation' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (isPostDispatchCancellation(error)) return 'unknown'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'http' && (error.status ?? 0) >= 400) return 'request'
  return 'general'
}

export function usePortfolioSettings(portfolioId: number) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioSettings requires an authenticated runtime')
  const queryClient = useQueryClient()
  const unknownKey = portfolioSettingsUnknownKey(runtime.epochId, portfolioId)
  const unknown = useQuery<PortfolioSettingsUnknown | null>({ queryKey: unknownKey, queryFn: async () => null, enabled: false, gcTime: Infinity })
  useEffect(() => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === 'portfolio-settings' && query.queryKey[1] !== runtime.epochId })
  }, [queryClient, runtime.epochId])
  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: PortfolioSettingsWrite) => {
      const lockKey = `${runtime.epochId}:${portfolioId}`
      const locks = locksFor(queryClient)
      if (locks.has(lockKey)) throw new Error('Portfolio settings are already pending.')
      if (queryClient.getQueryData(unknownKey)) throw new ApiError('network')
      const payload = Object.freeze(portfolioSettingsWriteSchema.parse(input))
      locks.add(lockKey)
      try {
        try {
          const response = await runtime.apiClient.write(createPortfolioSettingsEndpoint(portfolioId), {
            body: payload,
            commit: () => { void Promise.all([
              queryClient.invalidateQueries({ queryKey: portfoliosKey(runtime.epochId), exact: true }),
              queryClient.invalidateQueries({ queryKey: portfolioKey(runtime.epochId, portfolioId), exact: true }),
              queryClient.invalidateQueries({ queryKey: aggregatePortfolioDashboardKey(runtime.epochId), exact: true }),
            ]) },
          })
          if (response.portfolio.portfolioKey !== portfolioId) throw new ApiError('invalid-response')
          return response
        } catch (error) {
          if (classifyPortfolioSettingsFailure(error) === 'unknown') queryClient.setQueryData(unknownKey, Object.freeze({ payload }))
          throw error
        }
      } finally { locks.delete(lockKey) }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
  return {
    ...mutation,
    unknownOutcome: unknown.data ?? null,
    acknowledgeReconciliation: (outcome: 'applied' | 'not-applied') => {
      if (outcome !== 'applied' && outcome !== 'not-applied') throw new Error('Only a definitive reconciliation can be acknowledged.')
      queryClient.setQueryData(unknownKey, null)
    },
  }
}
