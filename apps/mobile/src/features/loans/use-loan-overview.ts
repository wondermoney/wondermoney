import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import { loanOverviewEndpoint } from './loans-contract'
import { loanOverviewKey } from './query-keys'

/** The Loans page's totals (web `useLoanOverview`). Read alongside the list, never instead of it. */
export function useLoanOverview() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useLoanOverview requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: loanOverviewKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(loanOverviewEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}
