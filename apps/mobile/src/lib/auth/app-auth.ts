import type { AuthRecoveryPort } from './auth-recovery'
import type { NativeIdentityProviderId } from './native-identity'
import type { SignupLocale } from './resolve-signup-locale'
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
 * The small application-owned auth interface. `mfa-pending` is the state
 * between a credentials sign-in that returned `twoFactorRedirect` and a
 * successful TOTP step-up; better-auth does not issue a session until the
 * second factor is verified.
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

/**
 * Single sign-on through the server's identity provider, in the system browser sheet. The
 * provider's refusal reasons are shown in that sheet (the web app's sign-in error page); the
 * app only learns that no session came back, which a cancelled sheet also is.
 */
export type BrowserSignInOutcome =
  | { status: 'accepted' }
  | { status: 'mfa-pending' }
  | { status: 'unavailable' }

/** The API's provider id for single sign-on (`/sign-in/social` `provider`). */
export const OIDC_PROVIDER_ID = 'oidc'

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

/**
 * `invalid-code` covers a mistyped code and a backup code that was already used (better-auth
 * removes a used backup code, so both answer `INVALID_BACKUP_CODE`). `challenge-expired` is a
 * pending sign-in that can no longer be completed (too many wrong codes, or its two-factor cookie
 * expired): the only way on is to sign in again. `rate-limited` is a temporarily locked account
 * or the API's limiter: waiting is the only fix.
 */
export type MfaVerifyOutcome =
  | { status: 'verified' }
  | { status: 'invalid-code' }
  | { status: 'challenge-expired' }
  | { status: 'rate-limited' }
  | { status: 'unavailable' }

export type MfaUnenrollOutcome =
  | { status: 'unenrolled' }
  | { status: 'unavailable' }

export type ChangePasswordOutcome =
  | { status: 'updated' }
  | { status: 'invalid-current-password' }
  | { status: 'weak-password' }
  | { status: 'unavailable' }

/**
 * Deliberately two-valued: better-auth answers the same way whether or not the address
 * belongs to an account, and a rate-limit or server refusal is not actionable beyond
 * "try again later".
 */
export type SendVerificationEmailOutcome =
  | { status: 'sent' }
  | { status: 'unavailable' }

export type MfaFactorSummary = { id: string; status: 'verified' | 'unverified' }

export type MfaListFactorsOutcome =
  | { status: 'available'; totpFactors: MfaFactorSummary[] }
  | { status: 'unavailable' }

export const TOTP_FACTOR_ID = 'totp'

/**
 * A passkey sign-in. `cancelled` is the person closing the device's prompt (or having no passkey
 * on it), which is not an error. There is no `mfa-pending`: a passkey with user verification is
 * both factors, so the server issues a full session (apps/api services/auth/passkey.ts).
 */
export type PasskeySignInOutcome =
  | { status: 'accepted' }
  | { status: 'cancelled' }
  | { status: 'unavailable' }

export type PasskeySummary = Readonly<{
  id: string
  name: string | null
  /** The authenticator model, for a label when the passkey has no name. */
  aaguid: string | null
  createdAt: string | null
  /** Set by the server on every sign-in with the passkey; null until the first. */
  lastUsedAt: string | null
}>

export type PasskeyListOutcome =
  | { status: 'available'; passkeys: PasskeySummary[] }
  | { status: 'unavailable' }

export type PasskeyAddOutcome =
  | { status: 'added' }
  | { status: 'cancelled' }
  /** The server wants a recent sign-in before a passkey is added (`SESSION_NOT_FRESH`). */
  | { status: 'session-not-fresh' }
  | { status: 'unavailable' }

export type PasskeyDeleteOutcome =
  | { status: 'deleted' }
  | { status: 'unavailable' }

export type AppAuthAdapter = AuthSessionPort<AuthSession>
  & AuthRecoveryPort<AuthSession>
  & Readonly<{
    /** Derives the application-owned auth state, including `mfa-pending`. */
    getState: () => Promise<AppAuthState>
    signInWithPassword: (email: string, password: string) => Promise<SignInOutcome>
    /**
     * Native Sign in with Apple / Google. Exchanges a provider ID token
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
    /**
     * "Sign in with <name>": better-auth's browser OAuth flow, which the Expo client runs in an
     * auth session and finishes on the `wondermoney://auth/complete` deep link, storing the
     * session cookie it carries (or the pending two-factor cookie).
     */
    signInWithBrowser: (provider: typeof OIDC_PROVIDER_ID) => Promise<BrowserSignInOutcome>
    /**
     * "Sign in with a passkey": better-auth's passkey ceremony with the device's prompt in place
     * of the browser's. Only offered where `isPasskeyAvailable` says the phone will cooperate.
     */
    signInWithPasskey: () => Promise<PasskeySignInOutcome>
    /** The signed-in user's passkeys. */
    listPasskeys: () => Promise<PasskeyListOutcome>
    /** Creates a passkey on this device for the signed-in user. */
    addPasskey: () => Promise<PasskeyAddOutcome>
    /** Removes one of the signed-in user's passkeys from the server (the device keeps its copy). */
    deletePasskey: (id: string) => Promise<PasskeyDeleteOutcome>
    /**
     * Email/password sign-up. `locale` is the app language: the API mails the verification link,
     * which goes out before the account exists, in it.
     */
    signUp: (email: string, password: string, locale?: SignupLocale) => Promise<SignUpOutcome>
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
    /**
     * Completes a pending two-factor sign-in with one of the backup codes shown at enrolment
     * (`twoFactor.verifyBackupCode`). Each code works once. The code is never logged.
     */
    mfaVerifyBackupCode: (code: string) => Promise<MfaVerifyOutcome>
    mfaUnenroll: (factorId: string) => Promise<MfaUnenrollOutcome>
    mfaListFactors: () => Promise<MfaListFactorsOutcome>
    /**
     * Re-verifies the current password via a fresh sign-in before applying the
     * new one, matching web's confirm-then-update flow. Neither password is logged.
     */
    changePassword: (email: string, currentPassword: string, newPassword: string) => Promise<ChangePasswordOutcome>
    /**
     * Asks better-auth to email a fresh verification link to `email`. No callback URL is
     * passed: the server points the link at the web app.
     */
    sendVerificationEmail: (email: string) => Promise<SendVerificationEmailOutcome>
  }>
