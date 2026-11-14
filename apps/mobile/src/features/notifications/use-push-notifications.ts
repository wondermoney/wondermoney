import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { expoPushDevice } from '@/lib/push/push-device'
import { securePushTokenStore } from '@/lib/push/push-token-store'

import { pushPreferencesEndpoint, sendTestPushEndpoint, type PushCategory, type PushPreferencesDto } from './push-contract'
import { disablePushCategory, enablePushCategory, type EnablePushOutcome, type PushDeps } from './push-registration'
import { pushPreferencesKey } from './query-keys'

/** The push switches, read only when the server has push on. */
export function usePushPreferences(enabled: boolean) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Push preferences require an authenticated runtime')
  return useQuery({
    enabled,
    queryKey: pushPreferencesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(pushPreferencesEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

export type PushToggleResult = EnablePushOutcome | { status: 'disabled'; preferences: PushPreferencesDto }

export function useTogglePushCategory(deps: Omit<PushDeps, 'api'> = { device: expoPushDevice, store: securePushTokenStore }) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Push preferences require an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async ({ category, next }: { category: PushCategory; next: boolean }): Promise<PushToggleResult> => {
      const api = runtime.apiClient
      if (!next) return { status: 'disabled', preferences: await disablePushCategory({ api }, category) }
      return enablePushCategory({ ...deps, api }, category)
    },
    onSuccess: (result) => {
      if (result.status === 'enabled' || result.status === 'disabled') {
        queryClient.setQueryData(pushPreferencesKey(runtime.epochId), result.preferences)
      }
    },
  })
}

export function useSendTestPush() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Push preferences require an authenticated runtime')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: () => runtime.apiClient.write(sendTestPushEndpoint, { commit: () => undefined }),
  })
}
