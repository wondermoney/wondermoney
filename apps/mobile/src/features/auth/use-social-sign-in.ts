import { useEffect, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { NativeIdentityProviderId, NativeIdentityProviders } from '@/lib/auth/native-identity'
import { nativeIdentityProviders } from '@/lib/auth/native-identity-providers'

export type SocialSignInFailure = 'unavailable'

/**
 * Apple first, always. App Store Guideline 4.8 requires Sign in with Apple to be at
 * least as prominent as any other third-party sign-in we offer, and this order is what
 * the buttons render in.
 */
const PROVIDER_ORDER: readonly NativeIdentityProviderId[] = ['apple', 'google']

/**
 * Drives native Apple/Google sign-in: asks the provider's SDK for an ID token
 * bound to a single-use nonce, then hands both to the auth server for a direct token exchange.
 * A successful exchange publishes a session, which the product runtime picks up and
 * activates exactly like a password sign-in.
 *
 * A user backing out of the native sheet is not a failure and shows no error. Tokens
 * and nonces are never logged, and provider error text is never surfaced. The server records the
 * sign-up or sign-in (`signup`, `login`), so the app sends no analytics event for it.
 */
export function useSocialSignIn(providers: NativeIdentityProviders = nativeIdentityProviders) {
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
    } catch {
      setFailure('unavailable')
    } finally {
      setPending(null)
    }
  }

  return { available, pending, failure, submit }
}
