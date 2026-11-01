import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createStartBankConnectionEndpoint } from './start-connection-contract'

export type StartBankConnectionFailure = 'access' | 'mfa' | 'not-found' | 'unavailable' | 'general'

export function classifyStartBankConnectionFailure(error: unknown): StartBankConnectionFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'mfa-required') return 'mfa'
  if (
    error.code === 'auth-session'
    || (error.code === 'http' && (error.status === 401 || error.status === 403))
  ) return 'access'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unavailable'
  return 'general'
}

/**
 * Starts an Enable Banking authorization. The underlying call is a
 * GET (`GET /v1/banking/bank/:bankId/start`) but it is a mutation in every
 * way that matters: it creates a new pending authorization server-side each
 * call, so it is dispatched through useMutation (no caching, no retry, no
 * concurrent dispatch) rather than a useQuery, even though it goes through
 * `apiClient.read` at the transport level. The resolved `{ redirectUrl }` is
 * a bearer-style, single-use consent URL — callers must never log it.
 */
export function useStartBankConnection() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useStartBankConnection requires an authenticated runtime')
  const inFlight = useRef(false)

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (bankId: string) => {
      if (inFlight.current) throw new Error('A bank connection is already starting.')
      inFlight.current = true
      try {
        return await runtime.apiClient.read(createStartBankConnectionEndpoint(bankId))
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
