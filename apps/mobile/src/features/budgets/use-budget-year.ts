import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createBudgetYearEndpoint, createBudgetYearUntilMonthEndpoint, isValidBudgetId, isValidBudgetPeriod } from './budgets-contract'
import { budgetYearKey, budgetYearToDateKey } from './query-keys'
import { useBudgetQueryState } from './use-budget-query-state'

const isValidYear = (budgetId: number | null, year: number | null): budgetId is number => (
  budgetId !== null && year !== null && isValidBudgetId(budgetId) && Number.isInteger(year)
)

export function useBudgetYear(budgetId: number | null, year: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetYear requires an authenticated runtime')
  const valid = isValidYear(budgetId, year)
  const query = useBudgetQueryState(useQuery({
    queryKey: budgetYearKey(runtime.epochId, budgetId ?? 0, year ?? 0),
    queryFn: () => runtime.apiClient.read(createBudgetYearEndpoint(budgetId!, year!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
  return { ...query, isInvalidRoute: !valid }
}

export function useBudgetYearToDate(budgetId: number | null, year: number | null, month: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetYearToDate requires an authenticated runtime')
  const valid = budgetId !== null && year !== null && month !== null
    && isValidBudgetId(budgetId) && isValidBudgetPeriod(year, month)
  const query = useBudgetQueryState(useQuery({
    queryKey: budgetYearToDateKey(runtime.epochId, budgetId ?? 0, year ?? 0, month ?? 0),
    queryFn: () => runtime.apiClient.read(createBudgetYearUntilMonthEndpoint(budgetId!, year!, month!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
  return { ...query, isInvalidRoute: !valid }
}
