import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { deleteAccountEndpoint } from './account-deletion-contract'

/**
 * Outcomes surfaced to the Security screen. `demo` and `access` are authoritative
 * server restrictions that leave the account intact; `unknown` covers ambiguous
 * post-dispatch/network failures where no false success may be claimed.
 */
export type DeleteAccountFailure = 'unknown' | 'demo' | 'access' | 'mfa' | 'cancelled'

export function classifyDeleteAccountFailure(error: unknown): DeleteAccountFailure {
  if (!(error instanceof ApiError)) return 'unknown'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (
    error.code === 'auth-session'
    || (error.code === 'http' && error.status === 403)
    || (error.code === 'http' && error.status === 401)
  ) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'unknown' : 'cancelled'
  return 'unknown'
}

/**
 * Generation-scoped account deletion. The guarded write is never automatically
 * replayed; a `dispatched` latch additionally prevents duplicate deletion calls from
 * repeated taps. The latch is only released for outcomes that are proven to have left
 * the account intact (`demo`/`access`/`mfa`/pre-dispatch `cancelled`), so an ambiguous
 * failure cannot be blindly retried into a second deletion attempt.
 */
export function useDeleteAccount() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDeleteAccount requires an authenticated runtime')
  const dispatched = useRef(false)

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async () => {
      if (dispatched.current) throw new Error('Account deletion has already been requested.')
      dispatched.current = true
      try {
        await runtime.apiClient.write(deleteAccountEndpoint, { commit: () => undefined })
      } catch (error) {
        if (classifyDeleteAccountFailure(error) !== 'unknown') dispatched.current = false
        throw error
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
