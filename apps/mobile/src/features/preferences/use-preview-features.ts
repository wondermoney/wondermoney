import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import {
  preferencesEndpoint,
  updatePreferencesEndpoint,
  type UserPreferencesDto,
  type UserPreferencesPatch,
} from './preview-features-contract'

const previewFeaturesKey = (epochId: number) => ['preview-features', epochId] as const

/**
 * The signed-in user's preview-features preference.
 *
 * Off while the preference is loading or if it cannot be read, so a preview
 * entry point never flashes for someone who does not have the flag. The PATCH
 * returns the authoritative document, which is committed straight into the
 * epoch-scoped cache; a stale response cannot repopulate a retired session.
 */
export function usePreviewFeatures() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Preview features require an authenticated runtime')
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: previewFeaturesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(preferencesEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (patch: UserPreferencesPatch) => runtime.apiClient.write(updatePreferencesEndpoint, {
      body: patch,
      commit: (state: UserPreferencesDto) => {
        queryClient.setQueryData(previewFeaturesKey(runtime.epochId), state)
      },
    }),
  })

  return {
    enabled: query.data?.previewFeatures ?? false,
    isLoading: query.isLoading,
    isLoadError: query.isError,
    isSaving: mutation.isPending,
    saveError: mutation.isError,
    setEnabled: (next: boolean) => mutation.mutate({ previewFeatures: next }),
  }
}
