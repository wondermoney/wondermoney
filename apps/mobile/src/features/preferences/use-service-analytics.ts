import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { serviceAnalyticsEndpoint, type ServiceAnalyticsDto, updateServiceAnalyticsEndpoint } from './service-analytics-contract'

export const serviceAnalyticsQueryKey = (epochId: number) => ['service-analytics', epochId] as const

/**
 * The signed-in person's service analytics choice, for the Preferences switch. Until it is read,
 * or if it cannot be, the section is not shown (`available` false), so the switch never claims a
 * choice the person did not make. The PUT returns the authoritative state.
 */
export function useServiceAnalytics() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Service analytics require an authenticated runtime')
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: serviceAnalyticsQueryKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(serviceAnalyticsEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (enabled: boolean) => runtime.apiClient.write(updateServiceAnalyticsEndpoint, {
      body: { enabled },
      commit: (state: ServiceAnalyticsDto) => {
        queryClient.setQueryData(serviceAnalyticsQueryKey(runtime.epochId), state)
      },
    }),
  })

  return {
    available: query.data?.available ?? false,
    enabled: query.data?.enabled ?? true,
    isSaving: mutation.isPending,
    saveError: mutation.isError,
    setEnabled: (next: boolean) => mutation.mutate(next),
  }
}
