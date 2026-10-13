import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createBudgetMonthEndpoint, isValidBudgetId, isValidBudgetPeriod } from './budgets-contract'
import { budgetMonthKey } from './query-keys'
import { useBudgetQueryState } from './use-budget-query-state'

export function useBudgetMonth(budgetId: number | null, year: number | null, month: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetMonth requires an authenticated runtime')
  const valid = budgetId !== null
    && year !== null
    && month !== null
    && isValidBudgetId(budgetId)
    && isValidBudgetPeriod(year, month)
  const query = useBudgetQueryState(useQuery({
    queryKey: budgetMonthKey(runtime.epochId, budgetId ?? 0, year ?? 0, month ?? 0),
    queryFn: () => runtime.apiClient.read(createBudgetMonthEndpoint(budgetId!, year!, month!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
  return { ...query, isInvalidRoute: !valid }
}
