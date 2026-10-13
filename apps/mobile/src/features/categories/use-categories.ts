import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import { categoriesEndpoint } from './categories-contract'

export const categoriesKey = (epochId: number) => ['categories', 'read', epochId] as const

export function useCategories() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useCategories requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: categoriesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(categoriesEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}
