import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createDisconnectBankConnectionEndpoint, isValidBankConnectionId } from './connection-status-contract'
import { bankConnectionsKey } from './query-keys'

export type BankConnectionDisconnectFailure = 'demo' | 'access' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid' | 'general'

export function classifyBankConnectionDisconnectFailure(error: unknown): BankConnectionDisconnectFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid'
  return 'general'
}

/**
 * Disconnect (unsync) a linked bank connection. Mirrors
 * use-account-delete-mutation.ts: no body, invalidate the read collection
 * on commit, route MFA rejections through blockAccess the same
 * way every other write mutation in this app does.
 */
export function useBankConnectionDisconnectMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useBankConnectionDisconnectMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (connectionId: number) => {
      if (!isValidBankConnectionId(connectionId)) throw new Error('A positive safe connection id is required.')
      return runtime.apiClient.write(createDisconnectBankConnectionEndpoint(connectionId), {
        commit: () => {
          void queryClient.invalidateQueries({ queryKey: bankConnectionsKey(runtime.epochId), exact: true })
        },
      })
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
