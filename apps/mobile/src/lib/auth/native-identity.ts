/** The identity providers offered natively on device. */
export type NativeIdentityProviderId = 'apple' | 'google'

/**
 * Deliberately lossy: a failed attempt never carries the provider's error text, which
 * can echo request material back at us. `cancelled` is a user action, not a failure,
 * and callers must not show an error for it.
 */
export type NativeIdentityOutcome =
  | { status: 'obtained'; idToken: string; nonce: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' }

export type NativeIdentityProvider = Readonly<{
  /** Whether this device can run the provider's native flow at all. */
  isAvailable: () => Promise<boolean>
  /**
   * Runs the native sign-in sheet and returns a freshly minted ID token bound to a
   * single-use nonce. The token and nonce are never logged.
   */
  requestIdentity: () => Promise<NativeIdentityOutcome>
}>

export type NativeIdentityProviders = Readonly<Record<NativeIdentityProviderId, NativeIdentityProvider>>

/** Matches provider SDK errors that mean "the user backed out", not "this broke". */
export const isCancellationError = (error: unknown, codes: readonly string[]): boolean =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && typeof (error as { code: unknown }).code === 'string'
  && codes.includes((error as { code: string }).code)
