import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createBudgetDetailEndpoint, isValidBudgetId } from './budgets-contract'
import { budgetDetailKey } from './query-keys'
import { useBudgetQueryState } from './use-budget-query-state'

export function useBudgetDetail(budgetId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetDetail requires an authenticated runtime')
  const valid = budgetId !== null && isValidBudgetId(budgetId)
  const query = useBudgetQueryState(useQuery({
    queryKey: budgetDetailKey(runtime.epochId, budgetId ?? 0),
    queryFn: () => runtime.apiClient.read(createBudgetDetailEndpoint(budgetId!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
  return { ...query, isInvalidRoute: !valid }
}
