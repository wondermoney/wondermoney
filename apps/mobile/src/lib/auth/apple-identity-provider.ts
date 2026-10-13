import * as AppleAuthentication from 'expo-apple-authentication'

import {
  isCancellationError,
  type NativeIdentityOutcome,
  type NativeIdentityProvider,
} from './native-identity'
import { createSignInNonce, createSignInState, type SignInNonce } from './sign-in-nonce'

/** The subset of `expo-apple-authentication` this adapter uses, so tests can fake it. */
export type ApplePort = Readonly<{
  isAvailableAsync: () => Promise<boolean>
  signInAsync: (
    options: AppleAuthentication.AppleAuthenticationSignInOptions,
  ) => Promise<AppleAuthentication.AppleAuthenticationCredential>
}>

export type AppleIdentityProviderDependencies = Readonly<{
  apple?: ApplePort
  createNonce?: () => Promise<SignInNonce>
  createState?: () => Promise<string>
}>

const CANCELLATION_CODES = ['ERR_REQUEST_CANCELED'] as const

/**
 * Native Sign in with Apple (iOS only; `isAvailable` is false everywhere else because
 * the optional native module reports unavailable off-platform).
 *
 * The hashed half of the nonce goes to Apple — Apple copies it into the identity
 * token's `nonce` claim untouched — and only the raw half travels on to Supabase.
 * A per-attempt `state` is sent alongside and checked against the value Apple echoes
 * back, so a credential produced by any other request is discarded. The identity token
 * itself is returned to the caller and never logged here.
 */
export function createAppleIdentityProvider({
  apple = AppleAuthentication,
  createNonce = createSignInNonce,
  createState = createSignInState,
}: AppleIdentityProviderDependencies = {}): NativeIdentityProvider {
  return {
    isAvailable: async () => {
      try {
        return await apple.isAvailableAsync()
      } catch {
        return false
      }
    },
    requestIdentity: async (): Promise<NativeIdentityOutcome> => {
      try {
        const [nonce, state] = await Promise.all([createNonce(), createState()])
        const credential = await apple.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: nonce.hashed,
          state,
        })
        if (credential.state !== state) return { status: 'unavailable' }
        return credential.identityToken
          ? { status: 'obtained', idToken: credential.identityToken, nonce: nonce.raw }
          : { status: 'unavailable' }
      } catch (error) {
        return isCancellationError(error, CANCELLATION_CODES)
          ? { status: 'cancelled' }
          : { status: 'unavailable' }
      }
    },
  }
}
