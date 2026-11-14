import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import {
  preferencesEndpoint,
  updatePreferencesEndpoint,
  type UserPreferencesDto,
  type UserPreferencesPatch,
} from './preview-features-contract'

export const userPreferencesQueryKey = (epochId: number) => ['user-preferences', epochId] as const

/**
 * The signed-in user's preferences document, shared by every preference on this
 * screen (preview features, the home layout). One epoch-scoped cache entry, so
 * a PATCH from one section updates what the others read.
 */
export function useUserPreferences() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('User preferences require an authenticated runtime')

  return useQuery({
    queryKey: userPreferencesQueryKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(preferencesEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * PATCH a partial preferences document. The response is the authoritative
 * document and is committed straight into the epoch-scoped cache; a stale
 * response cannot repopulate a retired session.
 */
export function useUpdateUserPreferences() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('User preferences require an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (patch: UserPreferencesPatch) => runtime.apiClient.write(updatePreferencesEndpoint, {
      body: patch,
      commit: (state: UserPreferencesDto) => {
        queryClient.setQueryData(userPreferencesQueryKey(runtime.epochId), state)
      },
    }),
  })
}
