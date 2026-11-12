import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { preferencesEndpoint } from './preview-features-contract'
import { useUpdateUserPreferences, useUserPreferences, userPreferencesQueryKey } from './use-user-preferences'

/**
 * The signed-in user's AI-hidden preference, for the Preferences switch.
 *
 * Off while the preference loads or if it cannot be read, so the switch never
 * claims a choice the person did not make. The PATCH returns the authoritative
 * document, committed into the shared epoch-scoped cache.
 */
export function useAiHidden() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('AI preferences require an authenticated runtime')

  const query = useUserPreferences()
  const mutation = useUpdateUserPreferences()

  return {
    hidden: query.data?.aiHidden ?? false,
    isLoading: query.isLoading,
    isLoadError: query.isError,
    isSaving: mutation.isPending,
    saveError: mutation.isError,
    setHidden: (next: boolean) => mutation.mutate({ aiHidden: next }),
  }
}

/**
 * Just the boolean, for entry points that must disappear when the person hid AI
 * (the receipt-scan action). Reads the same cache entry as the switch, and stays
 * false without an authenticated runtime so a screen can render before sign-in.
 */
export function useAiHiddenPreference(): boolean {
  return useAiHiddenPreferenceState().hidden
}

/**
 * The boolean plus whether the preference has been read (`known`). A surface that must never
 * flash for a person who hid AI (pending proposals) waits for `known`; a failed read counts as
 * known and not hidden, as everywhere else.
 */
export function useAiHiddenPreferenceState(): { hidden: boolean; known: boolean } {
  const { runtime } = useProductRuntime()
  const query = useQuery({
    enabled: Boolean(runtime),
    queryFn: () => {
      if (!runtime) throw new Error('AI preferences require an authenticated runtime')
      return runtime.apiClient.read(preferencesEndpoint)
    },
    queryKey: userPreferencesQueryKey(runtime?.epochId ?? 0),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return { hidden: query.data?.aiHidden ?? false, known: query.data !== undefined || query.isError }
}
