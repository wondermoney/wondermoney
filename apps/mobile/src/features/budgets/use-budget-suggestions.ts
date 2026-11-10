import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createBudgetSuggestionsEndpoint, isValidBudgetId, isValidBudgetPeriod } from './budgets-contract'
import { budgetSuggestionsKey } from './query-keys'

/**
 * Suggested amounts from the household's own spending for the month on screen. A failure is not
 * fatal: the editor simply shows no suggestion.
 */
export function useBudgetSuggestions(budgetId: number | null, year: number | null, month: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBudgetSuggestions requires an authenticated runtime')
  const valid = budgetId !== null
    && year !== null
    && month !== null
    && isValidBudgetId(budgetId)
    && isValidBudgetPeriod(year, month)
  return useQuery({
    queryKey: budgetSuggestionsKey(runtime.epochId, budgetId ?? 0, year ?? 0, month ?? 0),
    queryFn: () => runtime.apiClient.read(createBudgetSuggestionsEndpoint(budgetId!, year!, month!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}
