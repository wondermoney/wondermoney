import { type Href, useLocalSearchParams, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { PortfolioActivityScreen, type PortfolioActivityViewState } from './portfolio-activity-screen'
import { mapPortfolioActivity } from './portfolio-activity-view-model'
import { parsePortfolioActivityFilters, parsePortfolioId } from './portfolios-contract'
import { useDeletePortfolioTransaction } from './use-delete-portfolio-transaction'
import { useEditPortfolioTransaction } from './use-edit-portfolio-transaction'
import { usePortfolioActivity } from './use-portfolio-activity'

export function PortfolioActivityRoute({ aggregate }: { aggregate: boolean }) {
  const params = useLocalSearchParams<{ portfolioId?: string | string[]; fromDate?: string | string[]; toDate?: string | string[] }>()
  const portfolioId = aggregate ? 'aggregate' as const : parsePortfolioId(params.portfolioId)
  const filters = parsePortfolioActivityFilters(params.fromDate, params.toDate)
  const query = usePortfolioActivity(portfolioId, filters)
  const deleteMutation = useDeletePortfolioTransaction(typeof portfolioId === 'number' ? portfolioId : 0)
  const editMutation = useEditPortfolioTransaction(typeof portfolioId === 'number' ? portfolioId : 0)
  const router = useRouter()
  const { signOut } = useProductRuntime()
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
  const applyFilters = (next: { fromDate?: string; toDate?: string }) => router.replace({
    pathname: aggregate ? '/portfolio/activity' : '/portfolio/[portfolioId]/activity',
    params: { ...(aggregate ? {} : { portfolioId: String(portfolioId) }), ...next },
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
    onAddTransaction={!aggregate && typeof portfolioId === 'number' ? () => router.push(`/portfolio/${portfolioId}/transaction-create`) : undefined}
  />
}
