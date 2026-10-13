import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createBudgetAccountsEndpoint, isValidBudgetId } from './budgets-contract'
import { budgetAccountsKey } from './query-keys'
import { useBudgetQueryState } from './use-budget-query-state'

export function useBudgetAccounts(budgetId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetAccounts requires an authenticated runtime')
  const valid = budgetId !== null && isValidBudgetId(budgetId)
  const query = useBudgetQueryState(useQuery({
    queryKey: budgetAccountsKey(runtime.epochId, budgetId ?? 0),
    queryFn: () => runtime.apiClient.read(createBudgetAccountsEndpoint(budgetId!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
  return { ...query, isInvalidRoute: !valid }
}
