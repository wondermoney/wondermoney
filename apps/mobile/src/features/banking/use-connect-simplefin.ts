import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { accountsKey } from '@/features/accounts/query-keys'
import { ApiError } from '@/lib/api/errors'

import { bankConnectionsKey } from './query-keys'
import { simplefinConnectEndpoint, simplefinConnectRequestSchema } from './simplefin-connect-contract'

export type SimplefinConnectFailureReason =
  | 'token-invalid'
  | 'token-already-claimed'
  | 'server-not-allowed'
  | 'rejected'
  | 'demo'
  | 'access'
  | 'mfa'
  | 'disabled'
  | 'unreachable'
  | 'rate-limited'
  | 'network'
  | 'general'

/** The API's 400 codes for a refused setup token, each with its own translated copy. */
const REJECTION_CODES: Readonly<Record<string, SimplefinConnectFailureReason>> = {
  simplefin_token_invalid: 'token-invalid',
  simplefin_token_already_claimed: 'token-already-claimed',
  simplefin_server_not_allowed: 'server-not-allowed',
}

/**
 * Why a setup token did not connect. A 400 with one of the API's SimpleFIN codes reads as that
 * reason and is shown in the app's own words. Any other 400 is `rejected`, whose server message
 * is shown when it came with one. `network` is ambiguous: the request may have reached the server, and a
 * setup token works only once, so the person checks the list before trying again.
 */
export type SimplefinConnectFailure = Readonly<{ reason: SimplefinConnectFailureReason; serverMessage: null | string }>

export function classifySimplefinConnectFailure(error: unknown): SimplefinConnectFailure {
  const failure = (reason: SimplefinConnectFailureReason, serverMessage: null | string = null) => ({ reason, serverMessage })
  if (!(error instanceof ApiError)) return failure('general')
  if (error.code === 'demo-forbidden') return failure('demo')
  if (error.code === 'mfa-required') return failure('mfa')
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return failure('access')
  if (error.code === 'network' || error.code === 'cancelled') return failure('network')
  if (error.code !== 'http') return failure('general')
  if (error.status === 400) {
    const known = error.serverCode ? REJECTION_CODES[error.serverCode] : undefined
    return known ? failure(known) : failure('rejected', error.serverMessage ?? null)
  }
  if (error.status === 429) return failure('rate-limited')
  if (error.status === 501) return failure('disabled')
  if (error.status === 502 || error.status === 503 || error.status === 504) return failure('unreachable')
  return failure('general')
}

/** The translation key for a failure's own wording (used when there is no server message). */
export function simplefinConnectFailureMessageKey(reason: SimplefinConnectFailureReason): string {
  return `banking.simplefin.failures.${reason}`
}

/**
 * Connects SimpleFIN with a one-time setup token. No retry: a token works once, so a second
 * attempt could only fail. On success the connections list and the accounts are invalidated;
 * the new connection lists as `processing` and the list polls it until its first sync settles.
 *
 * The token travels only in the request body. The caller resets the mutation once it settles,
 * so it does not linger in the mutation's `variables` either.
 */
export function useConnectSimplefin() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useConnectSimplefin requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (setupToken: string) => {
      const body = simplefinConnectRequestSchema.parse({ setupToken })
      return runtime.apiClient.write(simplefinConnectEndpoint, {
        body,
        commit: () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: bankConnectionsKey(runtime.epochId), exact: true }),
            queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId) }),
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
