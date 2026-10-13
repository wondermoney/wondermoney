import { type Href, useLocalSearchParams, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { HoldingDetailScreen, type HoldingDetailViewState } from './holding-detail-screen'
import { filterPortfolioActivityByTicker, mapPortfolioActivity } from './portfolio-activity-view-model'
import { parsePortfolioId } from './portfolios-contract'
import { mapPortfolioDetail } from './portfolios-view-model'
import { usePortfolioActivity } from './use-portfolio-activity'
import { usePortfolioDetail } from './use-portfolio-detail'

export function HoldingDetailRoute() {
  const params = useLocalSearchParams<{ portfolioId?: string | string[]; assetId?: string | string[] }>()
  const portfolioId = parsePortfolioId(params.portfolioId)
  const assetId = parsePortfolioId(params.assetId)
  const detail = usePortfolioDetail(portfolioId)
  const activity = usePortfolioActivity(portfolioId, {})
  const router = useRouter()
  const { signOut } = useProductRuntime()

  const back = () => {
    if (portfolioId === null) { router.replace('/portfolio' as Href); return }
    router.replace({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolioId) } } as Href)
  }

  let state: HoldingDetailViewState
  if (assetId === null || detail.isInvalidId) state = { status: 'not-found' }
  else if (detail.isAccessTransition || activity.isAccessTransition) state = { status: 'access-transition' }
  else if (detail.isInitialLoading || activity.isInitialLoading) state = { status: 'loading' }
  else if (detail.data) {
    const view = mapPortfolioDetail(detail.data.metadata, detail.data.dashboard, detail.data.holdings)
    const holding = view.holdings.find((candidate) => candidate.id === assetId)
    if (!holding) state = { status: 'not-found' }
    else {
      const rows = activity.data ? filterPortfolioActivityByTicker(mapPortfolioActivity(activity.data.transactions), holding.symbol) : []
      state = { status: 'loaded', holding, activity: rows, refreshing: detail.isRefreshing || activity.isRefreshing }
    }
  } else if (detail.isNotFound) state = { status: 'not-found' }
  else state = { status: 'error' }

  return (
    <HoldingDetailScreen
      state={state}
      onBack={back}
      onRefresh={async () => { await Promise.all([detail.refetch(), activity.refetch()]) }}
      onLogout={signOut}
    />
  )
}
