import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { DEFAULT_RANGE_DAYS, presetRange } from '@/features/transactions/transactions-date-range'

import { PortfolioActivityScreen, type PortfolioActivityViewState } from './portfolio-activity-screen'
import { mapPortfolioActivity } from './portfolio-activity-view-model'
import { parsePortfolioActivityFilters, parsePortfolioId, portfoliosEndpoint } from './portfolios-contract'
import { portfoliosKey } from './query-keys'
import { usePortfolioResource } from './use-portfolio-resource'
import { useDeletePortfolioTransaction } from './use-delete-portfolio-transaction'
import { useEditPortfolioTransaction } from './use-edit-portfolio-transaction'
import { usePortfolioActivity } from './use-portfolio-activity'

export function PortfolioActivityRoute({ aggregate }: { aggregate: boolean }) {
  const params = useLocalSearchParams<{ portfolioId?: string | string[]; fromDate?: string | string[]; toDate?: string | string[]; range?: string | string[] }>()
  const portfolioId = aggregate ? 'aggregate' as const : parsePortfolioId(params.portfolioId)
  // Web opens on the last 60 days; `range=all` is the explicit "All dates" choice.
  const [defaultRange] = useState(() => presetRange(DEFAULT_RANGE_DAYS))
  const undated = params.fromDate === undefined && params.toDate === undefined
  const filters = undated
    ? (params.range === 'all' ? {} : defaultRange)
    : parsePortfolioActivityFilters(params.fromDate, params.toDate)
  const query = usePortfolioActivity(portfolioId, filters)
  const deleteMutation = useDeletePortfolioTransaction(typeof portfolioId === 'number' ? portfolioId : 0)
  const editMutation = useEditPortfolioTransaction(typeof portfolioId === 'number' ? portfolioId : 0)
  const router = useRouter()
  const { signOut } = useProductRuntime()
  // The aggregate page's "Add transaction" asks which portfolio, as web's add modal does.
  const portfolios = usePortfolioResource(portfoliosKey, () => portfoliosEndpoint, aggregate)
  const portfolioOptions = portfolios.state.status === 'loaded'
    ? portfolios.state.data.portfolios.map((portfolio) => ({ value: portfolio.portfolioKey, label: portfolio.name }))
    : []
  let state: PortfolioActivityViewState
  if (query.isInvalidRequest) state = { status: 'invalid-request' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isInitialLoading) state = { status: 'loading' }
  else if (query.data) {
    const rows = mapPortfolioActivity(query.data.transactions)
    state = query.isRateLimited ? { status: 'rate-limited-cached', rows, refreshing: query.isRefreshing } : query.isRefreshFailure ? { status: 'refresh-error', rows, refreshing: query.isRefreshing } : { status: 'loaded', rows, refreshing: query.isRefreshing }
  } else if (query.isRateLimited) state = { status: 'rate-limited' }
  else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.isInvalidResponse) state = { status: 'invalid-response' }
  else state = { status: 'error' }
  const goBack = () => {
    if (aggregate || portfolioId === null) {
      router.replace('/portfolio')
      return
    }
    router.replace({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolioId) } })
  }
  const applyFilters = (next: { fromDate?: string; toDate?: string }, options?: { all?: boolean }) => router.replace({
    pathname: aggregate ? '/portfolio/activity' : '/portfolio/[portfolioId]/activity',
    params: { ...(aggregate ? {} : { portfolioId: String(portfolioId) }), ...(options?.all || (!next.fromDate && !next.toDate) ? { range: 'all' } : next) },
  } as unknown as Href)
  return <PortfolioActivityScreen
    state={state}
    aggregate={aggregate}
    filters={filters ?? {}}
    onApplyFilters={applyFilters}
    onBack={goBack}
    onRefresh={query.refetch}
    onLogout={signOut}
    onDeleteTransaction={aggregate || typeof portfolioId !== 'number' ? undefined : async (transactionKey) => { await deleteMutation.mutateAsync(transactionKey) }}
    onEditTransaction={aggregate || typeof portfolioId !== 'number' ? undefined : async (transactionKey, draft) => { await editMutation.mutateAsync({ transactionId: transactionKey, draft }) }}
    onAddTransaction={aggregate
      ? (id) => { if (id !== undefined) router.push(`/portfolio/${id}/transaction-create` as Href) }
      : typeof portfolioId === 'number' ? () => router.push(`/portfolio/${portfolioId}/transaction-create`) : undefined}
    portfolioOptions={portfolioOptions}
  />
}
