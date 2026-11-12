import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { createCashflowEndpoint, type DateScope } from '@/features/account-insights/insights-contract'
import { cashflowKey } from '@/features/account-insights/query-keys'
import { useInsightQuery } from '@/features/account-insights/use-insight-query'
import { createBudgetMonthEndpoint } from '@/features/budgets/budgets-contract'
import { budgetMonthKey } from '@/features/budgets/query-keys'
import { portfoliosEndpoint } from '@/features/portfolios/portfolios-contract'
import { portfoliosKey } from '@/features/portfolios/query-keys'
import { conservativePortfolioQueryOptions } from '@/features/portfolios/query-state'
import { ApiError } from '@/lib/api/errors'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import { cashflowFromDate, monthComparisonRange } from './home-model'

/** Months the cash-flow list shows, as web's home does. */
export const CASHFLOW_MONTHS = 6

/**
 * Every budget's month through the same request and query key the budget
 * month screen uses, so Home and that screen share one cache entry and agree
 * to the cent. One query per budget: one failed month costs one row.
 */
/** Each budget's month, in the month the budget list puts it in (its current one, which its start day decides). */
export function useHomeBudgetMonths(months: readonly Readonly<{ budgetId: number; year: number; month: number }>[]) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useHomeBudgetMonths requires an authenticated runtime')
  const queries = useQueries({
    queries: months.map(({ budgetId, year, month }) => ({
      queryKey: budgetMonthKey(runtime.epochId, budgetId, year, month),
      queryFn: () => runtime.apiClient.read(createBudgetMonthEndpoint(budgetId, year, month)),
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })),
  })

  const handled = useRef(new Set<unknown>())
  const errors = queries.map((query) => query.error)
  useEffect(() => {
    for (const error of errors) {
      if (!error || handled.current.has(error)) continue
      handled.current.add(error)
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    }
  })

  return queries.map((query) => {
    const suppress = query.error instanceof ApiError && (query.error.code === 'invalid-response' || query.error.code === 'mfa-required')
    return {
      data: suppress ? undefined : query.data,
      isLoading: query.isLoading,
      error: query.error,
      refetch: query.refetch,
    }
  })
}

/** Net cash flow per month over the last six months, the endpoint web's home reads. */
export function useHomeCashflow(today: Date) {
  const scope = useMemo<DateScope>(() => ({
    fromDate: cashflowFromDate(today, CASHFLOW_MONTHS).toISOString(),
    // Month-to-date: a future-dated row must not make this month's figures
    // claim more than has happened.
    toDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString(),
  }), [today])
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useHomeCashflow requires an authenticated runtime')
  return useInsightQuery(createCashflowEndpoint(scope), cashflowKey(runtime.epochId, scope))
}

/** The same days of last month, for this month's change figures. */
export function useHomeCashflowComparison(today: Date) {
  const range = useMemo(() => monthComparisonRange(today), [today])
  const scope = useMemo<DateScope>(() => ({
    fromDate: range.from.toISOString(),
    toDate: range.to.toISOString(),
  }), [range])
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useHomeCashflowComparison requires an authenticated runtime')
  return useInsightQuery(createCashflowEndpoint(scope), cashflowKey(runtime.epochId, scope))
}

/** The household's portfolios list, for the setup checklist's "Track your investments" step. */
export function useHomePortfolios() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useHomePortfolios requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: portfoliosKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(portfoliosEndpoint),
    ...conservativePortfolioQueryOptions,
  }))
}
