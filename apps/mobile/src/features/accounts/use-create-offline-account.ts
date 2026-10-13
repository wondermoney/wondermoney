import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { type AuthEpochId, useProductRuntime } from '@/components/providers/product-runtime-provider'
import { netWorthKey } from '@/features/net-worth/query-keys'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import type { AccountsResponseDto } from './accounts-contract'
import { createOfflineAccountEndpoint, offlineAccountPayloadSchema, type OfflineAccountPayload } from './offline-account-contract'
import { accountFamilyKey, accountsKey, offlineAccountCreateGuardKey } from './query-keys'

export type OfflineAccountCreateFailure = 'validation' | 'demo' | 'access' | 'mfa' | 'cancelled' | 'unknown' | 'general'
export type OfflineAccountUnknownGuard = Readonly<{ payload: OfflineAccountPayload }>

/**
 * Which entry point asked for the account. `onboarding` is the activation
 * journey, which only renders while the user has not completed onboarding.
 */
export type OfflineAccountCreateOrigin = 'accounts' | 'onboarding'

/**
 * RAD-518 — `first_account_created` is an activation-funnel event, so it must
 * describe the account that takes someone from zero accounts to one, not every
 * account they ever add.
 *
 * Two honest signals exist, and nothing else: the onboarding journey (which the
 * onboarding gate only shows before activation), and a cached accounts list that
 * the app has actually read back as empty. An absent cache is deliberately *not*
 * treated as "no accounts" — it usually means the list simply was not loaded on
 * this launch, and guessing there would report a fifth account as a first one.
 */
export function isFirstAccountCreation(
  origin: OfflineAccountCreateOrigin,
  snapshot: AccountsResponseDto | undefined,
): boolean {
  if (origin === 'onboarding') return true
  return snapshot !== undefined && snapshot.accounts.length === 0
}

export function classifyOfflineAccountCreateFailure(error: unknown): OfflineAccountCreateFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'validation' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (isPostDispatchCancellation(error)) return 'unknown'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && (error.status === 400 || error.status === 409 || error.status === 422)) return 'validation'
  return 'general'
}

// Screens that call this hook are gated on an authenticated route state, but
// that gate and `runtime` becoming non-null are not the same render (see
// use-offline-account-options.ts for the full explanation) — most visible on
// OnboardingCreateAccountRoute, the fastest post-sign-in navigation in the
// app. Render-time access below falls back to this sentinel instead of
// throwing; the mutation itself still guards and throws defensively if
// somehow invoked before `runtime` is real (it never should be — nothing
// makes the create button interactive that early).
const unauthenticatedEpochId = -1 as AuthEpochId

export function useCreateOfflineAccount(origin: OfflineAccountCreateOrigin = 'accounts') {
  const { runtime, blockAccess } = useProductRuntime()
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  const guardKey = offlineAccountCreateGuardKey(runtime?.epochId ?? unauthenticatedEpochId)
  const guardQuery = useQuery<OfflineAccountUnknownGuard | null>({
    queryKey: guardKey,
    queryFn: () => Promise.resolve(null),
    enabled: false,
    gcTime: Infinity,
  })

  const refreshAuthoritativeAccounts = useCallback(async () => {
    if (!runtime) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId), exact: true, refetchType: 'all' }),
      queryClient.invalidateQueries({ queryKey: accountFamilyKey(runtime.epochId) }),
      queryClient.invalidateQueries({ queryKey: ['account-insights', runtime.epochId] }),
      queryClient.invalidateQueries({ queryKey: netWorthKey(runtime.epochId), exact: true }),
    ])
  }, [queryClient, runtime])

  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (value: OfflineAccountPayload) => {
      if (!runtime) throw new Error('useCreateOfflineAccount requires an authenticated runtime')
      if (inFlight.current) throw new Error('Account creation is already pending.')
      if (queryClient.getQueryData(guardKey)) throw new ApiError('network')
      const payload = Object.freeze(offlineAccountPayloadSchema.parse(value))
      // Read before the write: the commit below invalidates and refetches this
      // very key, so afterwards the list can no longer answer "was it empty?".
      const firstAccount = isFirstAccountCreation(
        origin,
        queryClient.getQueryData<AccountsResponseDto>(accountsKey(runtime.epochId)),
      )
      inFlight.current = true
      let refresh: Promise<void> | undefined
      try {
        try {
          await runtime.apiClient.write(createOfflineAccountEndpoint, {
            body: payload,
            commit: () => { refresh = refreshAuthoritativeAccounts() },
          })
        } catch (error) {
          if (classifyOfflineAccountCreateFailure(error) === 'unknown') {
            const guard = Object.freeze({ payload })
            queryClient.setQueryData(guardKey, guard)
          }
          throw error
        }
        // A confirmed 201 remains success even if the subsequent read cannot refresh.
        // Await the attempt, then let Accounts present its own refresh failure state.
        await refresh?.catch(() => undefined)
        // RAD-518 — how the account was created, and nothing about the account:
        // no name, institution, currency, balance or identifier.
        if (firstAccount) captureAnalyticsEvent('first_account_created', { method: 'manual' })
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })

  const clearUnknownGuard = useCallback(() => {
    queryClient.removeQueries({ queryKey: guardKey, exact: true })
    mutation.reset()
  }, [guardKey, mutation, queryClient])

  return {
    ...mutation,
    unknownGuard: guardQuery.data ?? null,
    clearUnknownGuard,
    reconcile: refreshAuthoritativeAccounts,
  }
}
