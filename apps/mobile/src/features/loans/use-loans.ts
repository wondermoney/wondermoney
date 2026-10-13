import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { loansEndpoint } from './loans-contract'
import { loansKey } from './query-keys'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

export function useLoans() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useLoans requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: loansKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(loansEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}
