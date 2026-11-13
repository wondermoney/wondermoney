import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createBudgetsEndpoint } from './budgets-contract'
import { budgetsKey } from './query-keys'
import { useBudgetQueryState } from './use-budget-query-state'

/** Every budget's current month; `member` (a key or `shared`) counts only that member's part. */
export function useBudgets(member?: string) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgets requires an authenticated runtime')
  return useBudgetQueryState(useQuery({
    queryKey: budgetsKey(runtime.epochId, member),
    queryFn: () => runtime.apiClient.read(createBudgetsEndpoint(member)),
    // Changing the member keeps the list on screen while it refetches, within the same session
    // only: another epoch's budgets are never shown as a placeholder.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === runtime.epochId ? previous : undefined),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}
