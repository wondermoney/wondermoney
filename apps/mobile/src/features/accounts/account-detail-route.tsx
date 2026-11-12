import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { buildBalanceSeries } from '@/features/account-insights/balance-growth'
import { summarizeMetrics } from '@/features/account-insights/metrics-summary'
import { useAccountMetrics } from '@/features/account-insights/use-account-metrics'
import { mapTransactions } from '@/features/transactions/transactions-view-model'
import { useTransactions } from '@/features/transactions/use-transactions'
import type { RecentTransactionsSectionState } from '@/features/transactions/recent-transactions-section'
import { mapRecentTransactions } from '@/features/transactions/recent-transactions-view-model'
import { useRecentTransactions } from '@/features/transactions/use-recent-transactions'

import { AccountDetailScreen, type AccountDetailData, type AccountDetailViewState } from './account-detail-screen'
import { mapAccountDetail } from './account-detail-view-model'
import { parseAccountId } from './accounts-contract'
import { useAccount } from './use-account'
import { useAccountForecast } from './use-account-forecast'
import { useAccountRecalculation } from './use-account-recalculation'
import { useCreditCardStatements } from './use-credit-card-statements'

function creditCardStatementState(
  creditCard: NonNullable<ReturnType<typeof mapAccountDetail>['creditCard']> | null,
  statements: ReturnType<typeof useCreditCardStatements>,
): AccountDetailData['creditCardStatement'] {
  if (!creditCard) return undefined
  if (statements.data) {
    const list = statements.data.statements
    const current = list.find((statement) => statement.isCurrent) ?? list[list.length - 1]
    return current
      ? { status: 'loaded', statement: current, statements: list, creditLimit: creditCard.creditLimit ?? null }
      : { status: 'empty' }
  }
  if (statements.error && statements.error instanceof ApiError && statements.error.code === 'invalid-response') return { status: 'invalid-response' }
  if (statements.error) return { status: 'error' }
  return { status: 'loading' }
}

export function AccountDetailRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const accountId = parseAccountId(params.accountId)
  const query = useAccount(accountId)
  // No fromDate, as web's account page: the API's default period and its
  // comparison. (A fresh `new Date()` here would also churn the query key.)
  const metrics = useAccountMetrics(accountId)
  const recent = useRecentTransactions(accountId)
  // The projected low point and the recurring payments still to come.
  const forecast = useAccountForecast(accountId)
  // The account's ledger feeds the Balance growth chart, as on web.
  const noFilters = useMemo(() => ({}), [])
  const ledger = useTransactions(noFilters, accountId ?? 0)
  const recalculation = useAccountRecalculation()
  const creditCard = query.data?.account.creditCard ?? null
  const statements = useCreditCardStatements(accountId, Boolean(creditCard))
  const router = useRouter()
  const { signOut } = useProductRuntime()
  let state: AccountDetailViewState

  if (query.isInvalidId) state = { status: 'invalid-id' }
  else if (query.isAccessTransition || metrics.isAccessTransition || ledger.isAccessTransition || forecast.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const ledgerRows = ledger.data ? mapTransactions(ledger.data) : null
    const forecastSeries = forecast.data?.accounts.find((series) => series.accountKey === accountId) ?? null
    const data: AccountDetailData = {
      ...mapAccountDetail(query.data.account),
      metrics: metrics.data
        ? { status: 'loaded', summary: summarizeMetrics(metrics.data.metrics) }
        : metrics.isLoading ? { status: 'loading' } : { status: 'error' },
      balance: ledgerRows
        ? { status: 'loaded', data: buildBalanceSeries(ledgerRows) }
        : ledger.isLoading ? { status: 'loading' } : { status: 'error' },
      forecast: forecastSeries
        ? { status: 'loaded', series: forecastSeries }
        : forecast.isLoading ? { status: 'loading' } : forecast.data ? { status: 'unavailable' } : { status: 'error' },
      creditCardStatement: creditCardStatementState(creditCard, statements),
    }
    state = query.isRefreshFailure ? { status: 'refresh-error', data } : { status: 'loaded', data }
  } else if (query.isNotFound) state = { status: 'not-found' }
  else if ([query.error].some((error) => error instanceof ApiError && error.code === 'invalid-response')) {
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
      onRetry={async () => { await Promise.all([query.refetch(), metrics.refetch(), ledger.refetch(), forecast.refetch()]) }}
      onRetryRecent={async () => { await recent.refetch() }}
      onLogout={signOut}
      onViewTransactions={() => router.push({
        pathname: '/accounts/[accountId]/transactions',
        params: { accountId: String(accountId) },
      })}
      onCreateTransaction={() => router.push({ pathname: '/accounts/transactions/create', params: { accountId: String(accountId) } })}
      onImportTransactions={query.data?.account.source === 'manual'
        ? () => router.push({ pathname: '/accounts/transactions/import', params: { accountId: String(accountId) } })
        : undefined}
      onEdit={() => router.push({ pathname: '/accounts/[accountId]/edit', params: { accountId: String(accountId) } })}
      onRecalculate={accountId === null ? undefined : () => { void recalculation.start(accountId) }}
      recalculation={recalculation.state}
      onDismissRecalculation={recalculation.reset}
    />
  )
}
