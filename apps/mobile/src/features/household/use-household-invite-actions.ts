import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createResendHouseholdInviteEndpoint, createRevokeHouseholdInviteEndpoint } from './household-contract'
import { householdKey } from './query-keys'

/** Resend and revoke both act on the single pending invite — grouped like MFA's start/confirm. */
export function useHouseholdInviteActions() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useHouseholdInviteActions requires an authenticated runtime')
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: householdKey(runtime.epochId), exact: true })
  }

  const onError = (error: unknown) => {
    if (!(error instanceof ApiError)) return
    if (error.code === 'mfa-required') blockAccess('mfa-required')
  }

  const resend = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (householdInviteKey: number) => runtime.apiClient.write(createResendHouseholdInviteEndpoint(householdInviteKey), {
      commit: invalidate,
    }),
    onError,
  })

  const revoke = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (householdInviteKey: number) => runtime.apiClient.write(createRevokeHouseholdInviteEndpoint(householdInviteKey), {
      commit: invalidate,
    }),
    onError,
  })

  return { resend, revoke }
}
