import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { accountUpdateWriteSchema, createUpdateAccountEndpoint, type AccountUpdateWrite } from './accounts-contract'
import { accountKey, accountsKey } from './query-keys'

export type AccountWriteFailure = 'demo' | 'access' | 'cancelled' | 'not-found' | 'network-ambiguous' | 'invalid' | 'general'

export function classifyAccountWriteFailure(error: unknown): AccountWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid'
  return 'general'
}

export function useAccountMetadataMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAccountMetadataMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ accountId, value }: { accountId: number; value: AccountUpdateWrite }) => {
      const body = accountUpdateWriteSchema.parse(value)
      return runtime.apiClient.write(createUpdateAccountEndpoint(accountId), {
        body,
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
