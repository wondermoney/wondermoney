import type { AuthRecoveryPort } from './auth-recovery'
import type { NativeIdentityProviderId } from './native-identity'
import type { AuthSessionPort } from './session-lifecycle'

/**
 * The application's own session shape, independent of any auth vendor.
 *
 * `accessToken` is the opaque better-auth session token. It is deliberately *not*
 * a JWT: the client never parses it, signs anything with it, or inspects its
 * claims. It is used verbatim as the `Bearer` credential on `/v1/*` and on the
 * better-auth `/api/auth/*` endpoints.
 */
export type AuthSession = Readonly<{
  user: Readonly<{ id: string }>
  accessToken: string
}>

/**
 * The small application-owned auth interface (replacing the Supabase SDK
 * surface). `mfa-pending` is the state between a credentials sign-in that
 * returned `twoFactorRedirect` and a successful TOTP step-up; better-auth does
 * not issue a session until the second factor is verified.
 */
export type AppAuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'mfa-pending' }
  | { status: 'authenticated'; session: AuthSession }
  | { status: 'recoverable-error' }

export type SignInOutcome =
  | { status: 'accepted' }
  | { status: 'invalid-credentials' }
  /** Password accepted, but the account has TOTP enabled: a step-up is required. */
  | { status: 'mfa-pending' }
  | { status: 'unavailable' }

/**
 * Deliberately two-valued. The verifier's rejection reasons for a native ID token
 * (bad audience, expired token, nonce mismatch) are neither actionable by the
 * user nor safe to surface: the error text can quote the submitted token.
 * Everything that is not a live session is reported as `unavailable`.
 */
export type IdTokenSignInOutcome =
  | { status: 'accepted' }
  | { status: 'mfa-pending' }
  | { status: 'unavailable' }

export type SignUpOutcome =
  | { status: 'accepted' }
  | { status: 'email-taken' }
  | { status: 'weak-password' }
  | { status: 'unavailable' }

export type MfaTotpEnrollOutcome =
  | {
      status: 'enrolled'
      /**
       * better-auth has a single TOTP factor per user, so the id is a constant
       * that keeps the existing factor-oriented caller surface stable.
       */
      factorId: string
      totp: { qrCode: string; secret: string; uri: string }
      /** One-time recovery codes returned by `twoFactor.enable`; never logged. */
      backupCodes: readonly string[]
    }
  | { status: 'unavailable' }

export type MfaChallengeOutcome =
  | { status: 'challenged'; challengeId: string }
  | { status: 'unavailable' }

export type MfaVerifyOutcome =
  | { status: 'verified' }
  | { status: 'invalid-code' }
  | { status: 'unavailable' }

export type MfaUnenrollOutcome =
  | { status: 'unenrolled' }
  | { status: 'unavailable' }

export type ChangePasswordOutcome =
  | { status: 'updated' }
  | { status: 'invalid-current-password' }
  | { status: 'weak-password' }
  | { status: 'unavailable' }

export type MfaFactorSummary = { id: string; status: 'verified' | 'unverified' }

export type MfaListFactorsOutcome =
  | { status: 'available'; totpFactors: MfaFactorSummary[] }
  | { status: 'unavailable' }

export const TOTP_FACTOR_ID = 'totp'

export type AppAuthAdapter = AuthSessionPort<AuthSession>
  & AuthRecoveryPort<AuthSession>
  & Readonly<{
    /** Derives the application-owned auth state, including `mfa-pending`. */
    getState: () => Promise<AppAuthState>
    signInWithPassword: (email: string, password: string) => Promise<SignInOutcome>
    /**
     * Native Sign in with Apple / Google (RAD-420). Exchanges a provider ID token
     * for a better-auth session through `signIn.social({ idToken })` — no browser
     * redirect. `nonce` is the value the verifier compares against the token's
     * `nonce` claim (the same SHA-256 digest the provider embedded); neither value
     * is ever logged.
     */
    signInWithIdToken: (
      provider: NativeIdentityProviderId,
      token: string,
      nonce: string,
    ) => Promise<IdTokenSignInOutcome>
    signUp: (email: string, password: string) => Promise<SignUpOutcome>
    signOutLocal: () => Promise<{ error: unknown | null }>
    /**
     * Enrolls a TOTP factor on the caller's current session. The secret is
     * returned once, for manual entry into an authenticator app; callers must
     * never log it.
     */
    mfaEnrollTotp: () => Promise<MfaTotpEnrollOutcome>
    mfaChallenge: (factorId: string) => Promise<MfaChallengeOutcome>
    /** The code parameter is never logged by this adapter. */
    mfaVerify: (factorId: string, challengeId: string, code: string) => Promise<MfaVerifyOutcome>
    mfaUnenroll: (factorId: string) => Promise<MfaUnenrollOutcome>
    mfaListFactors: () => Promise<MfaListFactorsOutcome>
    /**
     * Re-verifies the current password via a fresh sign-in before applying the
     * new one, matching web's confirm-then-update flow. Neither password is logged.
     */
    changePassword: (email: string, currentPassword: string, newPassword: string) => Promise<ChangePasswordOutcome>
  }>
