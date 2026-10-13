import { type Href, useRouter } from 'expo-router'

import { mapCategorySpending } from '@/features/account-insights/insights-view-model'
import { useTopSpendingCategory } from '@/features/account-insights/use-top-spending-category'
import { useBudgets } from '@/features/budgets/use-budgets'
import { mapBudgets } from '@/features/budgets/budgets-view-model'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { selectCurrentBudgetHealth } from './net-worth-budget-health-view-model'
import { NetWorthScreen, type BudgetHealthState, type InsightState, type NetWorthData, type NetWorthViewState } from './net-worth-screen'
import { useNetWorth } from './use-net-worth'
import { mapNetWorthSummary } from './net-worth-view-model'

function resolveBudgetHealth(budgets: ReturnType<typeof useBudgets>): BudgetHealthState {
  if (budgets.isLoading || budgets.isAccessTransition) return { status: 'loading' }
  if (budgets.data) {
    const current = selectCurrentBudgetHealth(mapBudgets(budgets.data), new Date())
    return current ? { status: 'loaded', data: current } : { status: 'hidden' }
  }
  if (budgets.error) return { status: 'error' }
  return { status: 'hidden' }
}

function resolveInsight(insight: ReturnType<typeof useTopSpendingCategory>): InsightState {
  if (insight.isLoading || insight.isAccessTransition) return { status: 'loading' }
  if (insight.data) {
    const [top] = mapCategorySpending(insight.data.categorySpending, 1)
    return top ? { status: 'loaded', data: { name: top.name, amount: top.amount, currency: top.currency } } : { status: 'hidden' }
  }
  if (insight.error) return { status: 'error' }
  return { status: 'hidden' }
}

export function NetWorthRoute() {
  const query = useNetWorth()
  const budgets = useBudgets()
  const insight = useTopSpendingCategory()
  const router = useRouter()
  const { signOut } = useProductRuntime()
  let state: NetWorthViewState

  if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const mapped = mapNetWorthSummary(query.data)
    const data: NetWorthData = {
      primaryCurrency: mapped.currencyCode,
      total: mapped.totalNetWorth,
      accounts: mapped.assets.accounts,
      portfolio: mapped.assets.portfolios,
      liabilities: mapped.liabilities.loans,
      completeness: mapped.completeness,
      unsupportedLoanCount: mapped.unsupportedCurrencies.loans,
      unsupportedPortfolioCount: mapped.unsupportedCurrencies.portfolios,
      sources: mapped.rows.map((row, index) => ({
        id: `${row.type}-${index}`,
        label: row.name,
        value: row.balance,
        currency: mapped.currencyCode,
        kind: row.type === 'accounts' ? 'account' : row.type === 'portfolios' ? 'portfolio' : 'loan',
      })),
    }
    state = query.isRefreshFailure
      ? { status: 'refresh-error', data, refreshing: query.isRefreshing }
      : { status: 'loaded', data, refreshing: query.isRefreshing }
  } else if (query.error instanceof ApiError && query.error.code === 'invalid-response') {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  return (
    <NetWorthScreen
      state={state}
      budgetHealth={resolveBudgetHealth(budgets)}
      insight={resolveInsight(insight)}
      onRefresh={async () => { await query.refetch() }}
      onLogout={signOut}
      onViewHistory={() => router.push('/net-worth/history' as unknown as Href)}
    />
  )
}
