import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { mapPortfolioDividendIncome } from './portfolio-activity-view-model'
import { PortfolioDetailScreen, type PortfolioDetailViewState, type PortfolioDividendIncomeSectionState } from './portfolio-detail-screen'
import type { PortfolioPerformanceState } from './portfolio-performance-chart'
import { mapPortfolioPerformance } from './portfolio-performance-view-model'
import { createPortfolioAllocationEndpoint, createPortfolioTopMoversEndpoint, parsePortfolioId, type PortfolioPerformancePeriod } from './portfolios-contract'
import { mapPortfolioDetail } from './portfolios-view-model'
import { usePortfolioDetail } from './use-portfolio-detail'
import { usePortfolioDividendIncome } from './use-portfolio-dividend-income'
import { usePortfolioPerformance } from './use-portfolio-performance'
import { portfolioAllocationKey, portfolioTopMoversKey } from './query-keys'
import { usePortfolioResource } from './use-portfolio-resource'

export function PortfolioDetailRoute() {
  const params = useLocalSearchParams<{ portfolioId?: string | string[] }>()
  const portfolioId = parsePortfolioId(params.portfolioId)
  const query = usePortfolioDetail(portfolioId)
  const [period, setPeriod] = useState<PortfolioPerformancePeriod>('YTD')
  const performanceQuery = usePortfolioPerformance(portfolioId, period)
  const dividendIncomeQuery = usePortfolioDividendIncome(portfolioId)
  const allocation = usePortfolioResource((epoch) => portfolioAllocationKey(epoch, portfolioId ?? 0), () => createPortfolioAllocationEndpoint(portfolioId!), portfolioId !== null)
  // Web's detail page has no period select: its top movers, like its summary, are YTD.
  const topMovers = usePortfolioResource((epoch) => portfolioTopMoversKey(epoch, portfolioId ?? 0, 'YTD'), () => createPortfolioTopMoversEndpoint(portfolioId!, 'YTD'), portfolioId !== null)
  const router = useRouter()
  const { signOut } = useProductRuntime()
  let state: PortfolioDetailViewState
  if (query.isInvalidId) state = { status: 'invalid-id' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isInitialLoading) state = { status: 'loading' }
  else if (query.data) {
    const data = mapPortfolioDetail(query.data.metadata, query.data.dashboard, query.data.holdings)
    state = query.isRefreshFailure ? { status: 'refresh-error', data, refreshing: query.isRefreshing } : { status: 'loaded', data, refreshing: query.isRefreshing }
  } else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.isInvalidResponse) state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const performanceState: PortfolioPerformanceState = performanceQuery.isAccessTransition || (!performanceQuery.data && performanceQuery.isPending)
    ? { status: 'loading' }
    : performanceQuery.data
      ? { status: 'loaded', data: mapPortfolioPerformance(performanceQuery.data) }
      : { status: 'error' }

  const reportingCurrency = query.data ? query.data.metadata.portfolio.currencyKey.code : null
  const dividendIncomeState: PortfolioDividendIncomeSectionState = dividendIncomeQuery.isAccessTransition
    ? { status: 'idle' }
    : dividendIncomeQuery.data
      ? { status: 'loaded', data: mapPortfolioDividendIncome(dividendIncomeQuery.data, reportingCurrency) }
      : dividendIncomeQuery.isPending
        ? { status: 'loading' }
        : { status: 'error' }

  return <PortfolioDetailScreen
    state={state}
    performance={{ state: performanceState, period, onSelectPeriod: setPeriod }}
    dividendIncome={dividendIncomeState}
    allocation={allocation.state}
    topMovers={topMovers.state}
    onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/portfolio') }}
    onOpenSettings={() => portfolioId !== null && router.push(`/portfolio/${portfolioId}/settings`)}
    onOpenActivity={() => portfolioId !== null && router.push(`/portfolio/${portfolioId}/activity`)}
    onOpenImport={() => portfolioId !== null && router.push(`/portfolio/${portfolioId}/import`)}
    onOpenAddTransaction={() => portfolioId !== null && router.push(`/portfolio/${portfolioId}/transaction-create`)}
    onOpenHolding={(assetId) => portfolioId !== null && router.push(`/portfolio/${portfolioId}/holding/${assetId}`)}
    onRefresh={async () => { await Promise.all([query.refetch(), allocation.refetch(), topMovers.refetch(), dividendIncomeQuery.refetch(), performanceQuery.refetch()]) }}
    onLogout={signOut}
  />
}
