import { useEffect, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { NativeIdentityProviderId, NativeIdentityProviders } from '@/lib/auth/native-identity'
import { nativeIdentityProviders } from '@/lib/auth/native-identity-providers'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

export type SocialSignInFailure = 'unavailable'

/**
 * Which funnel the block was rendered in. Supabase's token exchange is one
 * operation for both — a first-time Apple/Google user is signed up and signed in
 * by the same call — so the only honest way to tell `sign_up_completed` from
 * `sign_in_completed` (RAD-518) is which screen the user pressed the button on.
 */
export type SocialSignInFlow = 'sign_in' | 'sign_up'

/**
 * Apple first, always. App Store Guideline 4.8 requires Sign in with Apple to be at
 * least as prominent as any other third-party sign-in we offer, and this order is what
 * the buttons render in.
 */
const PROVIDER_ORDER: readonly NativeIdentityProviderId[] = ['apple', 'google']

/**
 * Drives native Apple/Google sign-in (RAD-420): asks the provider's SDK for an ID token
 * bound to a single-use nonce, then hands both to Supabase for a direct token exchange.
 * A successful exchange publishes a session, which the product runtime picks up and
 * activates exactly like a password sign-in.
 *
 * A user backing out of the native sheet is not a failure and shows no error. Tokens
 * and nonces are never logged, and provider error text is never surfaced.
 */
export function useSocialSignIn(
  providers: NativeIdentityProviders = nativeIdentityProviders,
  flow: SocialSignInFlow = 'sign_in',
) {
  const { signInWithIdToken } = useProductRuntime()
  const [available, setAvailable] = useState<readonly NativeIdentityProviderId[]>([])
  const [pending, setPending] = useState<NativeIdentityProviderId | null>(null)
  const [failure, setFailure] = useState<SocialSignInFailure | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all(PROVIDER_ORDER.map(async (provider) => {
      const supported = await providers[provider].isAvailable().catch(() => false)
      return supported ? provider : null
    })).then((resolved) => {
      if (cancelled) return
      setAvailable(resolved.filter((provider): provider is NativeIdentityProviderId => provider !== null))
    })
    return () => { cancelled = true }
  }, [providers])

  const submit = async (provider: NativeIdentityProviderId) => {
    if (pending) return
    setPending(provider)
    setFailure(null)
    try {
      const identity = await providers[provider].requestIdentity()
      if (identity.status === 'cancelled') return
      if (identity.status !== 'obtained') {
        setFailure('unavailable')
        return
      }
      const outcome = await signInWithIdToken(provider, identity.idToken, identity.nonce)
      if (outcome.status !== 'accepted') {
        // `mfa-pending` is deliberately collapsed into `unavailable` here: a
        // native provider exchange that lands on a TOTP step-up is not claimed
        // as a supported flow until the API gate is green. No session is
        // established either way, so nothing is activated.
        setFailure('unavailable')
        return
      }
      // RAD-518 — the provider name is the whole payload. The ID token, the
      // nonce and anything the provider returned about the person stay here.
      if (flow === 'sign_up') captureAnalyticsEvent('sign_up_completed', { provider })
      else captureAnalyticsEvent('sign_in_completed', { provider })
    } catch {
      setFailure('unavailable')
    } finally {
      setPending(null)
    }
  }

  return { available, pending, failure, submit }
}
