import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { type AuthEpochId, useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createOnboardingBootstrapEndpoint } from './onboarding-contract'
import { onboardingBootstrapKey } from './query-keys'

const unauthenticatedEpochId = -1 as AuthEpochId

/**
 * Server-authoritative onboarding bootstrap loader. Read with
 * `retry:false` and no focus/reconnect refetch: the bootstrap changes only
 * when the user completes the journey, so background revalidation is noise.
 * Entitlement / MFA errors route through `blockAccess`; invalid-response and
 * 404 suppress the data so the gate can render a safe "could not load" state
 * instead of presenting a stale answer.
 *
 * The route gate and `runtime` becoming non-null are not the same render
 * (see use-offline-account-options.ts) — render-time access below falls back
 * to a sentinel epoch and a disabled query instead of throwing on that frame.
 */
export function useOnboardingBootstrap() {
  const { runtime, blockAccess } = useProductRuntime()
  const handledError = useRef<unknown>(null)
  const query = useQuery({
    queryKey: onboardingBootstrapKey(runtime?.epochId ?? unauthenticatedEpochId),
    queryFn: () => {
      if (!runtime) throw new Error('useOnboardingBootstrap requires an authenticated runtime')
      return runtime.apiClient.read(createOnboardingBootstrapEndpoint())
    },
    enabled: !!runtime,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (query.error === handledError.current) return
    handledError.current = query.error
    if (!(query.error instanceof ApiError)) return
    if (query.error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess, query.error])

  const error = query.error instanceof ApiError ? query.error : null
  const isNotFound = error?.code === 'http' && error.status === 404
  const isAccessTransition = error?.code === 'mfa-required'
  const suppressData = error?.code === 'invalid-response' || isNotFound || isAccessTransition
  return {
    ...query,
    data: suppressData ? undefined : query.data,
    isNotFound,
    isAccessTransition,
    isInitialFailure: query.isError && (query.data === undefined || suppressData),
    isRefreshFailure: query.isError && query.data !== undefined && !suppressData,
    isRefreshing: query.isFetching && query.data !== undefined,
  }
}
