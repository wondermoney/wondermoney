import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { budgetInventoryEndpoint } from './budgets-contract'
import { budgetInventoryKey } from './query-keys'
import { useBudgetQueryState } from './use-budget-query-state'

export function useBudgetInventory() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetInventory requires an authenticated runtime')
  return useBudgetQueryState(useQuery({
    queryKey: budgetInventoryKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(budgetInventoryEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}
