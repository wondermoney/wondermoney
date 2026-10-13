import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { budgetsEndpoint } from './budgets-contract'
import { budgetsKey } from './query-keys'
import { useBudgetQueryState } from './use-budget-query-state'

export function useBudgets() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgets requires an authenticated runtime')
  return useBudgetQueryState(useQuery({
    queryKey: budgetsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(budgetsEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}
