import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { type AuthEpochId, useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  accountCurrenciesEndpoint,
  accountFinancialInstitutionsEndpoint,
} from './offline-account-contract'
import { accountCurrenciesKey, accountInstitutionsKey } from './query-keys'

const unauthenticatedEpochId = -1 as AuthEpochId

/**
 * The router gates every screen that calls this hook behind an authenticated
 * route state, but that gate and `runtime` becoming non-null are not the same
 * render: a screen can mount for one frame while `runtime` is still settling
 * (most visible immediately after sign-in, the fastest authenticated
 * navigation in the app). Rather than throwing on that frame — which took the
 * whole app down, see RAD-193 submission testing — the queries stay disabled
 * and `isLoading` stays true until `runtime` arrives, the same "render
 * nothing while resolving" contract `onboarding-gate.hook.ts` already uses.
 */
export function useOfflineAccountOptions() {
  const { runtime, blockAccess } = useProductRuntime()
  const handledError = useRef<unknown>(null)
  const currencies = useQuery({
    queryKey: accountCurrenciesKey(runtime?.epochId ?? unauthenticatedEpochId),
    queryFn: () => {
      if (!runtime) throw new Error('useOfflineAccountOptions requires an authenticated runtime')
      return runtime.apiClient.read(accountCurrenciesEndpoint)
    },
    enabled: !!runtime,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const institutions = useQuery({
    queryKey: accountInstitutionsKey(runtime?.epochId ?? unauthenticatedEpochId),
    queryFn: () => {
      if (!runtime) throw new Error('useOfflineAccountOptions requires an authenticated runtime')
      return runtime.apiClient.read(accountFinancialInstitutionsEndpoint)
    },
    enabled: !!runtime,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const error = currencies.error ?? institutions.error

  useEffect(() => {
    if (error === handledError.current) return
    handledError.current = error
    if (!(error instanceof ApiError)) return
    if (error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess, error])

  const errorCode = error instanceof ApiError ? error.code : null
  const isAccessTransition = errorCode === 'mfa-required'
  return {
    currencies,
    institutions,
    error,
    isAccessTransition,
    isLoading: !runtime || currencies.isLoading || institutions.isLoading,
    refetch: async () => { await Promise.all([currencies.refetch(), institutions.refetch()]) },
  }
}
