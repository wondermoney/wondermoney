import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { useUpdateUserPreferences, useUserPreferences } from './use-user-preferences'

/**
 * The signed-in user's preview-features preference.
 *
 * Off while the preference is loading or if it cannot be read, so a preview
 * entry point never flashes for someone who does not have the flag. The PATCH
 * returns the authoritative document, which `useUpdateUserPreferences` commits
 * into the shared epoch-scoped cache.
 */
export function usePreviewFeatures() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Preview features require an authenticated runtime')

  const query = useUserPreferences()
  const mutation = useUpdateUserPreferences()

  return {
    enabled: query.data?.previewFeatures ?? false,
    isLoading: query.isLoading,
    isLoadError: query.isError,
    isSaving: mutation.isPending,
    saveError: mutation.isError,
    setEnabled: (next: boolean) => mutation.mutate({ previewFeatures: next }),
  }
}
