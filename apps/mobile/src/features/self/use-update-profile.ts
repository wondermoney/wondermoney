import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { profileKey } from './query-keys'
import { profileNamePayloadSchema, updateProfileNameEndpoint, type ProfileNamePayload } from './profile-update-contract'

export type ProfileUpdateFailure = 'validation' | 'demo' | 'access' | 'mfa' | 'cancelled' | 'unknown'

export function classifyProfileUpdateFailure(error: unknown): ProfileUpdateFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'validation' : 'unknown'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (error.code === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500) return 'validation'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'unknown' : 'cancelled'
  return 'unknown'
}

/**
 * Guarded, single-flight profile-name update. On a confirmed 200 the epoch-scoped
 * profile query is invalidated so the read reflects the new name; the invalidation is
 * awaited before the mutation resolves so the route navigates back to fresh data.
 */
export function useUpdateProfile() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useUpdateProfile requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (value: ProfileNamePayload) => {
      if (inFlight.current) throw new Error('A profile update is already pending.')
      const payload = profileNamePayloadSchema.parse(value)
      inFlight.current = true
      let refresh: Promise<void> | undefined
      try {
        await runtime.apiClient.write(updateProfileNameEndpoint(runtime.principalId), {
          body: payload,
          commit: () => { refresh = queryClient.invalidateQueries({ queryKey: profileKey(runtime.epochId), exact: true }) },
        })
        await refresh
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
