/**
 * The device's passkey prompt, through `react-native-passkeys` (an Expo module: Apple's
 * AuthenticationServices on iOS, Credential Manager on Android). It takes and returns WebAuthn
 * JSON, the shapes better-auth's passkey endpoints hand out and accept, so the auth adapter
 * passes them straight through.
 *
 * The module is loaded on first use, not on import: a build without it (Expo Go, an old dev
 * client, the web) then reports passkeys as unsupported instead of failing to start.
 */

/** WebAuthn JSON: options from the server, a credential back from the device. */
export type WebAuthnJson = Record<string, unknown>

export type PasskeyAuthenticator = Readonly<{
  /** Whether this device can create and use passkeys (iOS 15+, Android 9+). */
  isSupported: () => boolean
  /** Registration: `PublicKeyCredentialCreationOptionsJSON` in, `RegistrationResponseJSON` out. */
  create: (options: WebAuthnJson) => Promise<WebAuthnJson | null>
  /** Authentication: `PublicKeyCredentialRequestOptionsJSON` in, `AuthenticationResponseJSON` out. */
  get: (options: WebAuthnJson) => Promise<WebAuthnJson | null>
}>

type PasskeysModule = Readonly<{
  isSupported: () => boolean
  create: (request: never) => Promise<unknown>
  get: (request: never) => Promise<unknown>
}>

let loaded: PasskeysModule | null | undefined

function passkeysModule(): PasskeysModule | null {
  if (loaded !== undefined) return loaded
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('react-native-passkeys') as PasskeysModule
  } catch {
    loaded = null
  }
  return loaded
}

let supported: boolean | undefined

/** The live authenticator. Tests inject a fake through the auth adapter instead. */
export const nativePasskeyAuthenticator: PasskeyAuthenticator = {
  isSupported: () => {
    if (supported === undefined) {
      try {
        supported = passkeysModule()?.isSupported() === true
      } catch {
        supported = false
      }
    }
    return supported
  },
  create: async (options) => {
    const module = passkeysModule()
    if (!module) throw new Error('NotSupported')
    return (await module.create(options as never)) as WebAuthnJson | null
  },
  get: async (options) => {
    const module = passkeysModule()
    if (!module) throw new Error('NotSupported')
    return (await module.get(options as never)) as WebAuthnJson | null
  },
}

/**
 * True when the person closed the passkey prompt, which is not an error to show. iOS rejects
 * with the Expo error code `ERR_USER_CANCELLED`; Android with the message `UserCancelled`.
 * "No passkey on this device" (`NoCredentials`) reads the same: the person can pick another way.
 */
export function isPasskeyCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code === 'ERR_USER_CANCELLED') return true
  return typeof message === 'string' && /\b(?:UserCancelled|NoCredentials)\b/.test(message)
}
