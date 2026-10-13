import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { netWorthKey } from '@/features/net-worth/query-keys'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { createPortfolioWriteEndpoint, portfolioCreateWriteSchema, type PortfolioCreateWrite } from './portfolios-contract'
import { aggregatePortfolioDashboardKey, portfolioCreateUnknownKey, portfoliosKey } from './query-keys'

export type PortfolioCreateFailure = 'validation' | 'demo' | 'access' | 'mfa' | 'cancelled' | 'unknown' | 'request' | 'general'
export type PortfolioCreateUnknown = Readonly<{ payload: Readonly<PortfolioCreateWrite> }>

const activeCreates = new WeakMap<object, Set<number>>()
const locksFor = (client: object) => {
  let locks = activeCreates.get(client)
  if (!locks) { locks = new Set(); activeCreates.set(client, locks) }
  return locks
}

export function classifyPortfolioCreateFailure(error: unknown): PortfolioCreateFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'validation' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (isPostDispatchCancellation(error)) return 'unknown'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && (error.status ?? 0) >= 400) return 'request'
  return 'general'
}

export function useCreatePortfolio() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreatePortfolio requires an authenticated runtime')
  const queryClient = useQueryClient()
  const unknownKey = portfolioCreateUnknownKey(runtime.epochId)
  const unknown = useQuery<PortfolioCreateUnknown | null>({ queryKey: unknownKey, queryFn: async () => null, enabled: false, gcTime: Infinity })
  useEffect(() => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === 'portfolio-create' && query.queryKey[2] === 'unknown-outcome' && query.queryKey[1] !== runtime.epochId })
  }, [queryClient, runtime.epochId])
  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: PortfolioCreateWrite) => {
      const locks = locksFor(queryClient)
      if (locks.has(runtime.epochId)) throw new Error('Portfolio creation is already pending.')
      if (queryClient.getQueryData(unknownKey)) throw new ApiError('network')
      const payload = Object.freeze(portfolioCreateWriteSchema.parse(input))
      locks.add(runtime.epochId)
      try {
        try {
          return await runtime.apiClient.write(createPortfolioWriteEndpoint, {
            body: payload,
            commit: () => { void Promise.all([
              queryClient.invalidateQueries({ queryKey: portfoliosKey(runtime.epochId), exact: true }),
              queryClient.invalidateQueries({ queryKey: aggregatePortfolioDashboardKey(runtime.epochId), exact: true }),
              queryClient.invalidateQueries({ queryKey: netWorthKey(runtime.epochId), exact: true }),
            ]) },
          })
        } catch (error) {
          if (classifyPortfolioCreateFailure(error) === 'unknown') queryClient.setQueryData(unknownKey, Object.freeze({ payload }))
          throw error
        }
      } finally { locks.delete(runtime.epochId) }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
  return { ...mutation, unknownOutcome: unknown.data ?? null }
}
