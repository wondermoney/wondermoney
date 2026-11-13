import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { netWorthKey } from '@/features/net-worth/query-keys'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import type { PortfolioAccountLinkInput } from './portfolio-account-link'
import { createPortfolioSettingsEndpoint, portfolioSettingsWriteSchema } from './portfolios-contract'
import { aggregatePortfolioDashboardPrefix, portfolioKey, portfoliosKey } from './query-keys'

export type PortfolioLinkFailure = 'link-held' | 'link-managed' | 'demo' | 'read-only' | 'mfa' | 'access' | 'not-found' | 'unknown' | 'request' | 'general'

/**
 * Why changing a link failed. `link-held`: the other member holds it, and `holder` names them
 * (the API sends nothing about the account). `link-managed`: the same refusal from an older API,
 * which answers a plain 403 without the name.
 */
export function classifyPortfolioLinkFailure(error: unknown): Readonly<{ failure: PortfolioLinkFailure; holder: string | null }> {
  if (error instanceof ApiError && error.code === 'portfolio-link-held') {
    return error.linkedBy ? { failure: 'link-held', holder: error.linkedBy } : { failure: 'link-managed', holder: null }
  }
  if (!(error instanceof ApiError)) return { failure: 'general', holder: null }
  if (error.code === 'demo-forbidden') return { failure: 'demo', holder: null }
  if (error.code === 'household-read-only') return { failure: 'read-only', holder: null }
  if (error.code === 'mfa-required') return { failure: 'mfa', holder: null }
  if (error.code === 'http' && error.status === 403) return { failure: 'link-managed', holder: null }
  if (error.code === 'auth-session' || (error.code === 'http' && error.status === 401)) return { failure: 'access', holder: null }
  if (error.code === 'http' && error.status === 404) return { failure: 'not-found', holder: null }
  if (isPostDispatchCancellation(error) || error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return { failure: 'unknown', holder: null }
  if (error.code === 'http' && (error.status ?? 0) >= 400) return { failure: 'request', holder: null }
  return { failure: 'general', holder: null }
}

/**
 * What a link changes: the portfolio itself, the lists that show it, and net worth (with its
 * history), which now counts the linked account's money once.
 */
export function invalidateAfterPortfolioLink(queryClient: QueryClient, epochId: number, portfolioId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: portfoliosKey(epochId), exact: true }),
    queryClient.invalidateQueries({ queryKey: portfolioKey(epochId, portfolioId), exact: true }),
    queryClient.invalidateQueries({ queryKey: aggregatePortfolioDashboardPrefix(epochId) }),
    // Not exact: the history under ['net-worth', epochId, 'history', …] changes too.
    queryClient.invalidateQueries({ queryKey: netWorthKey(epochId) }),
  ])
}

/**
 * Link a portfolio to an account the viewer can see, or unlink it (`accountLink: null`). Used by
 * the "Is this the same money?" suggestion on net worth; Portfolio settings sends the link with
 * its other fields. The write is a PUT of the whole link, so sending it again is safe: an outcome
 * the app could not confirm still refreshes net worth and the portfolios, and may be retried.
 */
export function useLinkPortfolioAccount() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useLinkPortfolioAccount requires an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async ({ portfolioId, accountLink }: Readonly<{ portfolioId: number; accountLink: PortfolioAccountLinkInput | null }>) => {
      const body = Object.freeze(portfolioSettingsWriteSchema.parse({ accountLink }))
      const response = await runtime.apiClient.write(createPortfolioSettingsEndpoint(portfolioId), {
        body,
        commit: () => { void invalidateAfterPortfolioLink(queryClient, runtime.epochId, portfolioId) },
      })
      if (response.portfolio.portfolioKey !== portfolioId) throw new ApiError('invalid-response')
      return response
    },
    onError: (error, { portfolioId }) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
      if (classifyPortfolioLinkFailure(error).failure === 'unknown') void invalidateAfterPortfolioLink(queryClient, runtime.epochId, portfolioId)
    },
  })
}
