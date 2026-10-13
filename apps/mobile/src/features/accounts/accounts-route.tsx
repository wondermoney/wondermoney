import { type Href, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { createInsightDateScope } from '@/features/account-insights/date-scope'
import type { InsightPeriod } from '@/features/account-insights/insights-contract'
import { mapCashflow, mapCategorySpending, mapMetricGroups, safeReportingCurrency } from '@/features/account-insights/insights-view-model'
import { useAccountInsights } from '@/features/account-insights/use-account-insights'

import { AccountsScreen, type AccountsViewState } from './accounts-screen'
import { mapAccounts } from './accounts-view-model'
import { useAccounts } from './use-accounts'

export function AccountsRoute() {
  const query = useAccounts()
  const [period, setPeriod] = useState<InsightPeriod>('month')
  const scope = useMemo(() => createInsightDateScope(period), [period])
  const insights = useAccountInsights(scope)
  const { signOut } = useProductRuntime()
  const router = useRouter()
  let state: AccountsViewState

  const insightQueries = [insights.metrics, insights.cashflow, insights.categories]
  if (query.isAccessTransition || insightQueries.some((item) => item.isAccessTransition)) state = { status: 'access-transition' }
  else if (query.isLoading || insightQueries.some((item) => item.isLoading)) state = { status: 'loading' }
  else if (query.data && insights.metrics.data && insights.cashflow.data && insights.categories.data) {
    const accounts = mapAccounts(query.data)
    const reportingCurrency = safeReportingCurrency(accounts.map((account) => account.primaryCurrencyCode))
    const data = { accounts, insights: { period, metricGroups: mapMetricGroups(insights.metrics.data.metrics), categories: mapCategorySpending(insights.categories.data.categorySpending), cashflow: mapCashflow(insights.cashflow.data.cashflow, reportingCurrency) } }
    const stale = query.isRefreshFailure || insightQueries.some((item) => item.isRefreshFailure)
    state = stale
      ? { status: 'refresh-error', data, refreshing: query.isRefreshing || insightQueries.some((item) => item.isRefreshing) }
      : { status: 'loaded', data, refreshing: query.isRefreshing || insightQueries.some((item) => item.isRefreshing) }
  } else if ([query.error, ...insightQueries.map((item) => item.error)].some((error) => error instanceof ApiError && error.code === 'invalid-response')) {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  return (
    <AccountsScreen
      state={state}
      onRefresh={async () => { await Promise.all([query.refetch(), ...insightQueries.map((item) => item.refetch())]) }}
      onInsightPeriodChange={setPeriod}
      onLogout={signOut}
      onViewTransactions={() => router.push('/accounts/transactions' as Href)}
      onCreateAccount={() => router.push('/accounts/create' as Href)}
      onViewRecurring={() => router.push('/accounts/recurring' as Href)}
      onSelectAccount={(accountId) => router.push({
        pathname: '/accounts/[accountId]',
        params: { accountId: String(accountId) },
      } as unknown as Href)}
    />
  )
}
