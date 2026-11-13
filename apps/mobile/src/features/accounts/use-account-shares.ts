import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  accountSharesWriteSchema,
  createAccountSharesEndpoint,
  createUpdateAccountSharesEndpoint,
  type AccountSharesWrite,
} from './account-sharing-contract'
import { isValidAccountId } from './accounts-contract'
import { accountKey, accountSharesKey, accountsKey } from './query-keys'

/** Why a sharing change was not saved (`accountEdit.sharing.failures.*`). */
export type AccountSharingFailure = 'demo' | 'read-only' | 'account-read-only' | 'manager-required' | 'access' | 'cancelled' | 'not-found' | 'invalid' | 'network-ambiguous' | 'general'

export function classifyAccountSharingFailure(error: unknown): AccountSharingFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'account-read-only') return 'account-read-only'
  if (error.code === 'account-share-manager-required') return 'manager-required'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  // 400: a member left or was removed since the list loaded.
  if (error.code === 'invalid-response' || (error.code === 'http' && error.status === 400)) return 'invalid'
  return 'general'
}

/** `GET /v1/account/:id/shares`: every household member and their access to the account. */
export function useAccountShares(accountId: number | null) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAccountShares requires an authenticated runtime')
  const validId = accountId !== null && isValidAccountId(accountId)
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: accountSharesKey(runtime.epochId, validId ? accountId : 0),
    queryFn: () => runtime.apiClient.read(createAccountSharesEndpoint(accountId!)),
    enabled: validId,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (query.error === handledError.current) return
    handledError.current = query.error
    if (query.error instanceof ApiError && query.error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess, query.error])

  const error = query.error instanceof ApiError ? query.error : null
  return {
    ...query,
    data: error?.code === 'invalid-response' ? undefined : query.data,
    /**
     * An API from before per-member sharing has no such route. The account itself loaded, so a
     * 404 here means the server is older, and the screen keeps the private switch.
     */
    isUnsupported: error?.code === 'http' && error.status === 404,
  }
}

/** `PUT /v1/account/:id/shares`. The answer is the new sharing; the accounts are read again. */
export function useAccountSharesMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAccountSharesMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ accountId, value }: { accountId: number; value: AccountSharesWrite }) => {
      const body = accountSharesWriteSchema.parse(value)
      return runtime.apiClient.write(createUpdateAccountSharesEndpoint(accountId), {
        body,
        commit: (shares) => {
          queryClient.setQueryData(accountSharesKey(runtime.epochId, accountId), shares)
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId), exact: true }),
            queryClient.invalidateQueries({ queryKey: accountKey(runtime.epochId, accountId), exact: true }),
          ])
        },
      })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
