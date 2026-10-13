import type { OneTapConfigureParams, OneTapResponse } from 'react-native-nitro-google-signin'

import { googleOAuthClients } from './google-oauth-clients'
import {
  isCancellationError,
  type NativeIdentityOutcome,
  type NativeIdentityProvider,
} from './native-identity'
import { createSignInNonce, type SignInNonce } from './sign-in-nonce'

/** The subset of `react-native-nitro-google-signin` this adapter uses, so tests can fake it. */
export type GooglePort = Readonly<{
  configure: (params: OneTapConfigureParams) => void
  /** Android Play Services guard; resolves immediately on iOS. */
  checkPlayServices: () => Promise<void>
  /** The explicit "Sign in with Google" sheet, which always mints a fresh ID token. */
  presentExplicitSignIn: () => Promise<OneTapResponse>
}>

export type GoogleIdentityProviderDependencies = Readonly<{
  google?: GooglePort
  createNonce?: () => Promise<SignInNonce>
}>

const CANCELLATION_CODES = ['SIGN_IN_CANCELLED'] as const

type GoogleModule = typeof import('react-native-nitro-google-signin')

let loadedModule: GoogleModule | null = null

/**
 * Loaded on first use rather than at import time: the package instantiates its Nitro
 * hybrid object as a module side effect, which throws when the native module is absent
 * (Expo Go, or a dev client built before this dependency landed). Deferring it keeps
 * that failure inside `requestIdentity`, where it degrades to `unavailable`, instead of
 * taking down the whole JS bundle.
 */
const loadGoogleModule = (): GoogleModule => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loadedModule ??= require('react-native-nitro-google-signin') as GoogleModule
  return loadedModule
}

export const nativeGooglePort: GooglePort = {
  configure: (params) => loadGoogleModule().GoogleOneTapSignIn.configure(params),
  checkPlayServices: () => loadGoogleModule().GoogleOneTapSignIn.checkPlayServices(),
  presentExplicitSignIn: () => loadGoogleModule().GoogleOneTapSignIn.presentExplicitSignIn(),
}

/**
 * Native Google sign-in: Credential Manager on Android, Google's Sign-In SDK on iOS.
 *
 * Always uses the explicit sign-in sheet rather than the silent/restore path, because
 * only an interactive request is guaranteed to mint a token carrying *this* attempt's
 * nonce — a restored, cached token would fail Supabase's nonce check.
 *
 * The hashed half of the nonce goes to Google (copied verbatim into the ID token's
 * `nonce` claim); only the raw half travels on to Supabase. Neither the token nor the
 * provider's error text is ever logged.
 */
export function createGoogleIdentityProvider({
  google = nativeGooglePort,
  createNonce = createSignInNonce,
}: GoogleIdentityProviderDependencies = {}): NativeIdentityProvider {
  return {
    isAvailable: async () => true,
    requestIdentity: async (): Promise<NativeIdentityOutcome> => {
      try {
        const nonce = await createNonce()
        google.configure({
          webClientId: googleOAuthClients.webClientId,
          iosClientId: googleOAuthClients.iosClientId,
          nonce: nonce.hashed,
        })
        await google.checkPlayServices()
        const response = await google.presentExplicitSignIn()
        if (response.type === 'cancelled') return { status: 'cancelled' }
        return response.type === 'success' && response.data?.idToken
          ? { status: 'obtained', idToken: response.data.idToken, nonce: nonce.raw }
          : { status: 'unavailable' }
      } catch (error) {
        return isCancellationError(error, CANCELLATION_CODES)
          ? { status: 'cancelled' }
          : { status: 'unavailable' }
      }
    },
  }
}
