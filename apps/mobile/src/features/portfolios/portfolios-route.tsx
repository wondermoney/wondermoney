import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import type { PortfolioAnalyticsState } from './portfolio-analytics-panel'
import { PortfoliosScreen, type PortfoliosViewState } from './portfolios-screen'
import { mapPortfolioAnalytics } from './portfolio-activity-view-model'
import { mapPortfolioOverview } from './portfolios-view-model'
import { usePortfolioAnalytics } from './use-portfolio-analytics'
import { usePortfolios } from './use-portfolios'

export function PortfoliosRoute() {
  const query = usePortfolios()
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const analytics = usePortfolioAnalytics(analyticsEnabled)
  const { signOut } = useProductRuntime()
  const router = useRouter()
  let state: PortfoliosViewState
  if (query.isAccessTransition || analytics.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isInitialLoading) state = { status: 'loading' }
  else if (query.data) {
    const data = mapPortfolioOverview(query.data.portfolios, query.data.dashboard)
    state = query.isRefreshFailure ? { status: 'refresh-error', data, refreshing: query.isRefreshing } : { status: 'loaded', data, refreshing: query.isRefreshing }
  } else if (query.isInvalidResponse) state = { status: 'invalid-response' }
  else state = { status: 'error' }
  let analyticsState: PortfolioAnalyticsState
  if (!analyticsEnabled) analyticsState = { status: 'idle' }
  else if (analytics.isInitialLoading) analyticsState = { status: 'loading' }
  else if (analytics.data) {
    const data = mapPortfolioAnalytics(analytics.data.allocation, analytics.data.dividends, analytics.data.metrics, query.data?.dashboard.summary.currency ?? null)
    analyticsState = analytics.isRateLimited ? { status: 'rate-limited-cached', data, refreshing: analytics.isRefreshing } : analytics.isRefreshFailure ? { status: 'refresh-error', data, refreshing: analytics.isRefreshing } : { status: 'loaded', data, refreshing: analytics.isRefreshing }
  } else if (analytics.isRateLimited) analyticsState = { status: 'rate-limited' }
  else if (analytics.isInvalidResponse) analyticsState = { status: 'invalid-response' }
  else analyticsState = { status: 'error' }
  return <PortfoliosScreen state={state} analyticsState={analyticsState} onEnableAnalytics={() => setAnalyticsEnabled(true)} onRetryAnalytics={analytics.refetch} onCreatePortfolio={() => router.push('/portfolio/create')} onOpenActivity={() => router.push('/portfolio/activity')} onRefresh={query.refetch} onLogout={signOut} onSelectPortfolio={(portfolioId) => router.push({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolioId) } } as unknown as Href)} />
}
