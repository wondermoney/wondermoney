import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createDeleteAccountEndpoint, isValidAccountId } from './accounts-contract'
import { accountKey, accountsKey } from './query-keys'

export type AccountDeleteFailure = 'demo' | 'access' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid' | 'general'

export function classifyAccountDeleteFailure(error: unknown): AccountDeleteFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid'
  return 'general'
}

export function useAccountDeleteMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAccountDeleteMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (accountId: number) => {
      if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
      return runtime.apiClient.write(createDeleteAccountEndpoint(accountId), {
        commit: () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId), exact: true }),
            queryClient.invalidateQueries({ queryKey: accountKey(runtime.epochId, accountId), exact: true }),
          ])
        },
      })
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
