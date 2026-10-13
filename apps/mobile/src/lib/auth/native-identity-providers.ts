import { createAppleIdentityProvider } from './apple-identity-provider'
import { createGoogleIdentityProvider } from './google-identity-provider'
import type { NativeIdentityProviders } from './native-identity'

/**
 * The providers the app actually ships (RAD-420). Constructing them is side-effect
 * free — neither adapter touches its native SDK until `isAvailable`/`requestIdentity`
 * is called.
 */
export const nativeIdentityProviders: NativeIdentityProviders = {
  apple: createAppleIdentityProvider(),
  google: createGoogleIdentityProvider(),
}
