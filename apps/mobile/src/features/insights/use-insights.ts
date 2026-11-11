import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createInsightsEndpoint } from './insights-contract'

/** The home's deterministic insights for the current month (or `month`, `YYYY-MM`). */
export function useInsights(month?: string) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useInsights requires an authenticated runtime')
  return useQuery({
    queryKey: ['insights', runtime.epochId, month ?? 'current'],
    queryFn: () => runtime.apiClient.read(createInsightsEndpoint(month)),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}
