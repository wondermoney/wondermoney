import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { mapPortfolioDividendIncome } from './portfolio-activity-view-model'
import type { PortfolioPerformanceState } from './portfolio-performance-chart'
import { mapPortfolioPerformance } from './portfolio-performance-view-model'
import { type PortfolioOverviewSections, PortfoliosScreen, type PortfoliosViewState } from './portfolios-screen'
import {
  aggregatePortfolioHoldingsEndpoint,
  createPortfolioPerformanceEndpoint,
  createPortfolioTopMoversEndpoint,
  portfolioAllocationEndpoint,
  portfolioDividendIncomeEndpoint,
  portfolioMetricsEndpoint,
  type PortfolioPerformancePeriod,
} from './portfolios-contract'
import { mapHoldings, mapPortfolioOverview } from './portfolios-view-model'
import { aggregatePortfolioHoldingsKey, portfolioAnalyticsKey, portfolioPerformanceKey, portfolioTopMoversKey } from './query-keys'
import { type PortfolioResourceState, usePortfolioResource } from './use-portfolio-resource'
import { usePortfolios } from './use-portfolios'

function mapState<T, U>(state: PortfolioResourceState<T>, map: (data: T) => U): PortfolioResourceState<U> {
  return state.status === 'loaded' ? { status: 'loaded', data: map(state.data) } : state
}

export function PortfoliosRoute() {
  const [period, setPeriod] = useState<PortfolioPerformancePeriod>('YTD')
  const query = usePortfolios(period)
  const { signOut } = useProductRuntime()
  const router = useRouter()
  const hasPortfolios = (query.data?.portfolios.portfolios.length ?? 0) > 0

  // The sections web loads alongside the summary. Each loads, fails and retries on its own.
  const metrics = usePortfolioResource((epoch) => portfolioAnalyticsKey(epoch, 'metrics'), () => portfolioMetricsEndpoint, hasPortfolios)
  const performance = usePortfolioResource((epoch) => portfolioPerformanceKey(epoch, 'aggregate', period), () => createPortfolioPerformanceEndpoint(null, period), hasPortfolios, true)
  const allocation = usePortfolioResource((epoch) => portfolioAnalyticsKey(epoch, 'allocation'), () => portfolioAllocationEndpoint, hasPortfolios)
  const topMovers = usePortfolioResource((epoch) => portfolioTopMoversKey(epoch, 'aggregate', period), () => createPortfolioTopMoversEndpoint(null, period), hasPortfolios, true)
  const dividends = usePortfolioResource((epoch) => portfolioAnalyticsKey(epoch, 'dividends'), () => portfolioDividendIncomeEndpoint, hasPortfolios)
  const holdings = usePortfolioResource(aggregatePortfolioHoldingsKey, () => aggregatePortfolioHoldingsEndpoint, hasPortfolios)

  let state: PortfoliosViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isInitialLoading) state = { status: 'loading' }
  else if (query.data) {
    const data = mapPortfolioOverview(query.data.portfolios, query.data.dashboard)
    state = query.isRefreshFailure ? { status: 'refresh-error', data, refreshing: query.isRefreshing } : { status: 'loaded', data, refreshing: query.isRefreshing }
  } else if (query.isInvalidResponse) state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const currency = query.data?.dashboard.summary.currency ?? null
  const performanceState: PortfolioPerformanceState = performance.state.status === 'loaded'
    ? { status: 'loaded', data: mapPortfolioPerformance(performance.state.data) }
    : performance.state
  const sections: PortfolioOverviewSections = {
    metrics: metrics.state,
    performance: performanceState,
    allocation: allocation.state,
    topMovers: topMovers.state,
    dividends: mapState(dividends.state, (data) => mapPortfolioDividendIncome(data, currency)),
    holdings: mapState(holdings.state, mapHoldings),
  }

  const refresh = async () => {
    await Promise.all([query.refetch(), metrics.refetch(), performance.refetch(), allocation.refetch(), topMovers.refetch(), dividends.refetch(), holdings.refetch()])
  }

  return (
    <PortfoliosScreen
      state={state}
      sections={sections}
      period={period}
      onSelectPeriod={setPeriod}
      onCreatePortfolio={() => router.push('/portfolio/create')}
      onAddTransaction={(portfolioId) => router.push(`/portfolio/${portfolioId}/transaction-create` as Href)}
      onOpenHolding={(holding) => { if (holding.portfolioId) router.push(`/portfolio/${holding.portfolioId}/holding/${holding.id}` as Href) }}
      onRefresh={refresh}
      onLogout={signOut}
      onSelectPortfolio={(portfolioId) => router.push({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolioId) } } as unknown as Href)}
    />
  )
}
