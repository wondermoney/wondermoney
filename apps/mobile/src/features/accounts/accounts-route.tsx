import { type Href, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { DEFAULT_ACCOUNTS_TIMEFRAME, getAccountsTimeframeScope, type AccountsTimeframe } from '@/features/account-insights/accounts-timeframe'
import { buildBalanceSeries } from '@/features/account-insights/balance-growth'
import { mapCashflow, mapCategorySpending } from '@/features/account-insights/insights-view-model'
import type { MetricsSectionState } from '@/features/account-insights/metrics-stats'
import { summarizeMetrics } from '@/features/account-insights/metrics-summary'
import { useAccountInsights } from '@/features/account-insights/use-account-insights'
import { mapTransactions } from '@/features/transactions/transactions-view-model'
import { useTransactions } from '@/features/transactions/use-transactions'

import { AccountsScreen, type AccountsInsights, type AccountsViewState, type SectionState } from './accounts-screen'
import { mapAccounts } from './accounts-view-model'
import { useAccounts } from './use-accounts'

type Resource<T> = { data?: T; isLoading?: boolean; error?: unknown }

function section<T, R>(query: Resource<T>, map: (data: T) => R): SectionState<R> {
  if (query.data !== undefined) return { status: 'loaded', data: map(query.data) }
  if (query.isLoading) return { status: 'loading' }
  return { status: 'error' }
}

export function AccountsRoute() {
  const query = useAccounts()
  const [timeframe, setTimeframe] = useState<AccountsTimeframe>(DEFAULT_ACCOUNTS_TIMEFRAME)
  // Memoized per timeframe: the scope's `now` is part of every query key.
  const scope = useMemo(() => getAccountsTimeframeScope(timeframe), [timeframe])
  const insights = useAccountInsights(scope, 6)
  const transactionFilters = useMemo(() => ({ fromDate: scope.fromDate, toDate: scope.toDate }), [scope])
  const transactions = useTransactions(transactionFilters)
  const { signOut } = useProductRuntime()
  const router = useRouter()
  let state: AccountsViewState

  // Only the accounts list gates the page; each insight section loads and fails on its own.
  const insightQueries = [insights.metrics, insights.cashflow, insights.categories, transactions]
  if (query.isAccessTransition || insightQueries.some((item) => item.isAccessTransition)) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const accounts = mapAccounts(query.data)
    const metricsSection = section(insights.metrics, (data) => summarizeMetrics(data.metrics))
    const metrics: MetricsSectionState = metricsSection.status === 'loaded' ? { status: 'loaded', summary: metricsSection.data } : metricsSection
    const currency = accounts[0]?.primaryCurrencyCode ?? null
    const mappedTransactions = section(transactions, (data) => mapTransactions(data))
    const data = {
      accounts,
      insights: {
        timeframe,
        metrics,
        categories: section(insights.categories, (data) => mapCategorySpending(data.categorySpending, 6)),
        categoriesCompleteness: insights.categories.data?.completeness,
        cashflow: section(insights.cashflow, (data) => mapCashflow(data.cashflow, currency)),
        transactions: mappedTransactions,
        balance: mappedTransactions.status === 'loaded'
          ? { status: 'loaded', data: buildBalanceSeries(mappedTransactions.data, scope.fromDate) }
          : mappedTransactions,
      } satisfies AccountsInsights,
    }
    const refreshing = query.isRefreshing || insightQueries.some((item) => item.isRefreshing)
    state = query.isRefreshFailure
      ? { status: 'refresh-error', data, refreshing }
      : { status: 'loaded', data, refreshing }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  return (
    <AccountsScreen
      onConnectBank={() => router.push('/more/banking/connect' as Href)}
      onCreateAccount={() => router.push('/accounts/create' as Href)}
      onCreateTransaction={() => router.push('/accounts/transactions/create' as Href)}
      onImportTransactions={() => router.push('/accounts/transactions/import' as Href)}
      onEditAccount={(accountId) => router.push({ pathname: '/accounts/[accountId]/edit', params: { accountId: String(accountId) } } as unknown as Href)}
      onLogout={signOut}
      onRefresh={async () => { await Promise.all([query.refetch(), ...insightQueries.map((item) => item.refetch())]) }}
      onSelectAccount={(accountId) => router.push({
        pathname: '/accounts/[accountId]',
        params: { accountId: String(accountId) },
      } as unknown as Href)}
      onTimeframeChange={setTimeframe}
      onViewTransactions={() => router.push('/accounts/transactions' as Href)}
      state={state}
    />
  )
}
