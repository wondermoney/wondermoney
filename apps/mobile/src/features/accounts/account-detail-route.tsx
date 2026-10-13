import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { createInsightDateScope } from '@/features/account-insights/date-scope'
import { mapMetricGroups } from '@/features/account-insights/insights-view-model'
import { useAccountMetrics } from '@/features/account-insights/use-account-metrics'
import type { RecentTransactionsSectionState } from '@/features/transactions/recent-transactions-section'
import { mapRecentTransactions } from '@/features/transactions/recent-transactions-view-model'
import { useRecentTransactions } from '@/features/transactions/use-recent-transactions'

import { AccountDetailScreen, type AccountDetailViewState } from './account-detail-screen'
import { mapAccountDetail } from './account-detail-view-model'
import { parseAccountId } from './accounts-contract'
import { useAccount } from './use-account'

export function AccountDetailRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const accountId = parseAccountId(params.accountId)
  const query = useAccount(accountId)
  // Memoized once per mount: createInsightDateScope defaults `now` to a fresh
  // `new Date()`, and an unmemoized call here fed a millisecond-fresh value
  // into useAccountMetrics's query key on every render — React Query treats
  // that as a brand-new query each time, causing an unthrottled fetch loop
  // (see use-top-spending-category.ts, which hit the same pattern in
  // production testing).
  const fromDate = useMemo(() => createInsightDateScope('month').fromDate, [])
  const metrics = useAccountMetrics(accountId, fromDate)
  const recent = useRecentTransactions(accountId)
  const router = useRouter()
  const { signOut } = useProductRuntime()
  let state: AccountDetailViewState

  if (query.isInvalidId || metrics.isInvalidId) state = { status: 'invalid-id' }
  else if (query.isAccessTransition || metrics.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading || metrics.isLoading) state = { status: 'loading' }
  else if (query.data && metrics.data) {
    const data = { ...mapAccountDetail(query.data.account), metrics: mapMetricGroups(metrics.data.metrics).flatMap((group) => group.rows), metricsFromDate: fromDate }
    state = query.isRefreshFailure || metrics.isRefreshFailure ? { status: 'refresh-error', data } : { status: 'loaded', data }
  } else if (query.isNotFound) state = { status: 'not-found' }
  else if ([query.error, metrics.error].some((error) => error instanceof ApiError && error.code === 'invalid-response')) {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  // The recent-transactions section loads independently: its failure never removes the
  // verified account header, and unsafe rows are suppressed on invalid/404/access.
  let recentTransactions: RecentTransactionsSectionState
  if (recent.isLoading) recentTransactions = { status: 'loading' }
  else if (recent.data) {
    recentTransactions = { status: 'loaded', rows: mapRecentTransactions(recent.data.transactions), stale: recent.isRefreshFailure }
  } else if (recent.error instanceof ApiError && recent.error.code === 'invalid-response') {
    recentTransactions = { status: 'invalid-response' }
  } else recentTransactions = { status: 'error' }

  return (
    <AccountDetailScreen
      state={state}
      recentTransactions={recentTransactions}
       onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/accounts') }}
      onRetry={async () => { await Promise.all([query.refetch(), metrics.refetch()]) }}
      onRetryRecent={async () => { await recent.refetch() }}
      onLogout={signOut}
      onViewTransactions={() => router.push({
        pathname: '/accounts/[accountId]/transactions',
        params: { accountId: String(accountId) },
      })}
      onCreateTransaction={() => router.push({ pathname: '/accounts/transactions/create', params: { accountId: String(accountId) } })}
      onEdit={() => router.push({ pathname: '/accounts/[accountId]/edit', params: { accountId: String(accountId) } })}
    />
  )
}
