import { type Href, useRouter } from 'expo-router'
import { useMemo } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { accountMark, portfolioMark } from '@/components/ui/entity-mark'
import { mapCategorySpending } from '@/features/account-insights/insights-view-model'
import { useTopSpendingCategory } from '@/features/account-insights/use-top-spending-category'
import { useAccounts } from '@/features/accounts/use-accounts'
import { useInsights } from '@/features/insights/use-insights'
import { useBankAlertBanner } from '@/features/banking/use-bank-alerts'
import { mapBudget } from '@/features/budgets/budgets-view-model'
import { useBudgets } from '@/features/budgets/use-budgets'
import { useLoans } from '@/features/loans/use-loans'
import { useDashboardLayout } from '@/features/preferences/use-dashboard-layout'
import { useTransactions } from '@/features/transactions/use-transactions'
import { useTransactionReviewSummary } from '@/features/transactions/use-transaction-review-summary'
import { ApiError } from '@/lib/api/errors'

import {
  cashflowScale,
  isCurrentCashflowMonth,
  monthComparisonRange,
  monthSummary,
  monthTotalsOf,
  oldestRefresh,
  savingsSummary,
  upcomingLoanPayments,
  type ResolvedHistoryPoint,
} from './home-model'
import type { BudgetMonthRow, InsightsState, SectionState } from './home-sections'
import { monthlyHistoryPoints } from './net-worth-history-view-model'
import { NetWorthScreen, type HomeSections, type InsightState, type NetWorthViewState } from './net-worth-screen'
import { useHomeBudgetMonths, useHomeCashflow, useHomeCashflowComparison, useHomePortfolios } from './use-home-data'
import { useNetWorth } from './use-net-worth'
import { useNetWorthHistory } from './use-net-worth-history'
import { mapNetWorthSummary } from './net-worth-view-model'
import { useSetupChecklistDismissal } from './use-setup-checklist-dismissal'

/** Twelve month-closing points: web's home reads "since the end of December 2025" in November 2026. */
const HOME_HISTORY_MONTHS = 12
/** Web's latest-transactions section shows a fixed six. */
const LATEST_SHOWN = 6
const ALL_TRANSACTIONS = {} as const

type QueryLike<T> = { isLoading: boolean; data?: T; error?: unknown }

function sectionOf<T, R>(query: QueryLike<T>, map: (data: T) => R): SectionState<R> {
  if (query.data !== undefined) return { status: 'loaded', data: map(query.data) }
  if (query.isLoading) return { status: 'loading' }
  if (query.error) return { status: 'error' }
  return { status: 'loading' }
}

export function NetWorthRoute() {
  const router = useRouter()
  const { signOut } = useProductRuntime()
  // One "today" per mount, so the month windows and keys stay stable.
  const today = useMemo(() => new Date(), [])
  const year = today.getFullYear()
  const month = today.getMonth() + 1

  const query = useNetWorth()
  const history = useNetWorthHistory(HOME_HISTORY_MONTHS)
  const accounts = useAccounts()
  const budgets = useBudgets()
  const budgetList = useMemo(() => budgets.data?.budgets ?? [], [budgets.data])
  const budgetMonths = useHomeBudgetMonths(budgetList.map((budget) => budget.budgetKey), year, month)
  const cashflow = useHomeCashflow(today)
  const cashflowComparison = useHomeCashflowComparison(today)
  const comparisonRange = useMemo(() => monthComparisonRange(today), [today])
  const loans = useLoans()
  const latest = useTransactions(ALL_TRANSACTIONS)
  const reviewSummary = useTransactionReviewSummary()
  const portfolios = useHomePortfolios()
  const insight = useTopSpendingCategory()
  const insights = useInsights()
  const setupDismissal = useSetupChecklistDismissal()
  const bankAlerts = useBankAlertBanner()
  const dashboardLayout = useDashboardLayout()

  let state: NetWorthViewState
  if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const mapped = mapNetWorthSummary(query.data)
    const data = {
      primaryCurrency: mapped.currencyCode,
      total: mapped.totalNetWorth,
      rows: mapped.rows,
      completeness: mapped.completeness,
      unsupportedAccountCount: mapped.unsupportedCurrencies?.accounts ?? 0,
      unsupportedLoanCount: mapped.unsupportedCurrencies?.loans ?? 0,
      unsupportedPortfolioCount: mapped.unsupportedCurrencies?.portfolios ?? 0,
      unsupportedManualAssetCount: mapped.unsupportedCurrencies?.manualAssets ?? 0,
      unconvertedCurrencies: mapped.unconvertedCurrencies ?? [],
    }
    state = query.isRefreshFailure
      ? { status: 'refresh-error', data, refreshing: query.isRefreshing }
      : { status: 'loaded', data, refreshing: query.isRefreshing }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  const historyState = sectionOf(history, (data): readonly ResolvedHistoryPoint[] => monthlyHistoryPoints(data.points)
    .filter((point) => point.totalNetWorth !== null)
    .map((point) => ({ date: point.date, value: point.totalNetWorth as number })))

  const monthRows = sectionOf(budgets, () => budgetList.map((budget, index): BudgetMonthRow => {
    const monthQuery = budgetMonths[index]
    return {
      id: budget.budgetKey,
      name: budget.name,
      href: `/budgets/${budget.budgetKey}/${year}/${month}`,
      onRetry: () => void monthQuery?.refetch(),
      state: sectionOf(monthQuery ?? { isLoading: true }, (data) => {
        const mapped = mapBudget(data.budget, { year, month })
        return { summary: monthSummary(mapped), currency: mapped.currencyCode }
      }),
    }
  }))

  const loansState = sectionOf(loans, (data) => ({ upcoming: upcomingLoanPayments(data.loans, today), hasLoans: data.loans.length > 0 }))
  const latestState = sectionOf(latest, (data) => ({ review: reviewSummary.data ?? null, transactions: data.transactions.slice(0, LATEST_SHOWN) }))

  const accountMarks = useMemo(() => new Map((accounts.data?.accounts ?? []).map((account) => [
    account.accountKey,
    accountMark({ logoUrl: account.accountFinancialInstitutionKey?.logoUrl, institutionName: account.accountFinancialInstitutionKey?.displayName, type: account.accountType }),
  ])), [accounts.data])
  const portfolioMarks = useMemo(() => new Map((portfolios.data?.portfolios ?? []).map((portfolio) => [
    portfolio.portfolioKey,
    portfolioMark({ name: portfolio.broker?.displayName }),
  ])), [portfolios.data])

  const freshness = accounts.data ? oldestRefresh(accounts.data.accounts, new Date()) : null

  const setupReady = accounts.data !== undefined && !setupDismissal.dismissed
  const setup = setupReady ? {
    account: accounts.data!.accounts.length > 0,
    transactions: Boolean(latest.data?.transactions.length) && reviewSummary.data !== undefined && reviewSummary.data.count === 0,
    budget: budgetList.length > 0,
    portfolio: (portfolios.data?.portfolios.length ?? 0) > 0,
  } : null

  let insightState: InsightState
  if (insight.isLoading || insight.isAccessTransition) insightState = { status: 'loading' }
  else if (insight.data) {
    const [top] = mapCategorySpending(insight.data.categorySpending, 1)
    insightState = top ? { status: 'loaded', data: { name: top.name, amount: top.amount, currency: top.currency } } : { status: 'hidden' }
  } else if (insight.error) insightState = { status: 'error' }
  else insightState = { status: 'hidden' }

  const fallback = insightState.status === 'loaded' ? insightState.data : null
  let insightsState: InsightsState
  if (insights.isLoading) insightsState = { status: 'loading' }
  else if (insights.data) insightsState = { status: 'loaded', data: { fallback, insights: insights.data.insights } }
  else if (insights.error) insightsState = { status: 'error' }
  else insightsState = { status: 'hidden' }

  const sections: HomeSections = {
    history: historyState,
    freshness,
    setup,
    bankAlert: bankAlerts.banner,
    month: monthRows,
    cashflow: sectionOf(cashflow, (data) => ({
      ...cashflowScale(data.cashflow),
      summary: savingsSummary(
        monthTotalsOf(data.cashflow.find((row) => isCurrentCashflowMonth(row.date, today))),
        monthTotalsOf(cashflowComparison.data?.cashflow[0]),
        comparisonRange,
      ),
    })),
    loans: loansState,
    latest: latestState,
    insights: insightsState,
    insight: insightState,
    accountMarks,
    portfolioMarks,
  }

  return (
    <NetWorthScreen
      onDismissBankAlert={bankAlerts.dismiss}
      onDismissSetup={setupDismissal.dismiss}
      onLogout={signOut}
      onNavigate={(href) => router.push(href as Href)}
      onRefresh={async () => {
        await Promise.all([
          query.refetch(),
          history.refetch(),
          accounts.refetch(),
          budgets.refetch(),
          ...budgetMonths.map((monthQuery) => monthQuery.refetch()),
          cashflow.refetch(),
          cashflowComparison.refetch(),
          loans.refetch(),
          latest.refetch(),
          reviewSummary.refetch(),
          insights.refetch(),
          bankAlerts.refetch(),
        ])
      }}
      onRetryBudgets={() => void budgets.refetch()}
      onRetryCashflow={() => {
        void cashflow.refetch()
        void cashflowComparison.refetch()
      }}
      onRetryHistory={() => void history.refetch()}
      onRetryLatest={() => void latest.refetch()}
      onRetryLoans={() => void loans.refetch()}
      onViewHistory={() => router.push('/net-worth/history' as unknown as Href)}
      layout={dashboardLayout.layout}
      onCustomize={() => router.push('/home/customize' as Href)}
      sections={sections}
      state={state}
      today={today}
    />
  )
}
