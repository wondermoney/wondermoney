import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createRulePresetInstallEndpoint, createRulePresetPreviewEndpoint, createRulePresetsEndpoint } from './rule-presets-contract'
import { rulesKey } from './use-rules'

export type RulePresetLocale = Readonly<{ language: string; region?: string | null }>

/** Under the rules key, so refreshing the rules refreshes the presets' status too. */
const presetsKey = (epochId: number) => [...rulesKey(epochId), 'presets'] as const

export function useRulePresets(locale: RulePresetLocale) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useRulePresets requires an authenticated runtime')
  return useQuery({
    queryKey: [...presetsKey(runtime.epochId), locale.language, locale.region ?? null],
    queryFn: () => runtime.apiClient.read(createRulePresetsEndpoint(locale)),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/** Everything a preset would add, rule by rule. Always current: it is what the person confirms. */
export function useRulePresetPreview(code: string | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useRulePresetPreview requires an authenticated runtime')
  return useQuery({
    queryKey: [...presetsKey(runtime.epochId), 'preview', code],
    queryFn: () => runtime.apiClient.read(createRulePresetPreviewEndpoint(code as string)),
    enabled: code !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

export function useInstallRulePreset() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useInstallRulePreset requires an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    mutationFn: (code: string) => runtime.apiClient.write(createRulePresetInstallEndpoint(code), {
      commit: () => { void queryClient.invalidateQueries({ queryKey: rulesKey(runtime.epochId) }) },
    }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
