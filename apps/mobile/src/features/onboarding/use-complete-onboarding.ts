import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { createCompleteOnboardingEndpoint, type OnboardingStateDto } from './onboarding-contract'
import { onboardingBootstrapKey } from './query-keys'

/**
 * Generation-safe idempotent completion mutation. The server is
 * authoritative: a repeated call with the current version is a no-op success
 * and never double-records. `commit(parsed)` runs only while the session
 * generation is current, so a stale response from a retired session can
 * never repopulate the bootstrap cache.
 *
 * Outcomes surfaced to the screen: `access` covers MFA / auth
 * (route through `blockAccess`); `stale` is a 400 from a client that posted
 * a version the server no longer considers current (caller should refetch);
 * `network` is the ambiguous "we don't know" bucket and must not be
 * interpreted as completion.
 */
export type CompleteOnboardingFailure = 'access' | 'cancelled' | 'network' | 'stale' | 'unknown'

export function classifyCompleteOnboardingFailure(error: unknown): CompleteOnboardingFailure {
  if (!(error instanceof ApiError)) return 'unknown'
  if (error.code === 'mfa-required' || error.code === 'auth-session') return 'access'
  if (error.code === 'http' && error.status === 400) return 'stale'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'http' || error.code === 'network') return 'network'
  return 'unknown'
}

export function useCompleteOnboarding() {
  const { runtime, blockAccess } = useProductRuntime()
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (input: { version: number }) => {
      // The screens that call this hook are gated on an authenticated route
      // state, but that gate and `runtime` becoming non-null are not the same
      // render (see use-offline-account-options.ts) — this throw is a
      // defensive invariant on the mutation call itself, not a render-time
      // one, so it cannot take the whole app down on that transient frame.
      if (!runtime) throw new Error('useCompleteOnboarding requires an authenticated runtime')
      const commit = (parsed: unknown) => {
        const onboarding = (parsed as { onboarding: OnboardingStateDto } | undefined)?.onboarding
        if (!onboarding) return
        queryClient.setQueryData(onboardingBootstrapKey(runtime.epochId), { onboarding })
      }
      return runtime.apiClient.write(
        createCompleteOnboardingEndpoint(),
        { body: input, commit },
      )
    },
    // Every terminal onboarding path (skip, connect-bank, create-account)
    // funnels through this one mutation, so the activation event is captured here
    // rather than repeated at three call sites. The server is idempotent, but a
    // repeated call is still a real completion request from a real user, which is
    // what the funnel step measures. No properties: the ADR approves none.
    onSuccess: () => captureAnalyticsEvent('onboarding_completed'),
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
