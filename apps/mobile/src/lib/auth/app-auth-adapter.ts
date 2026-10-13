import {
  TOTP_FACTOR_ID,
  type AppAuthAdapter,
  type AppAuthState,
  type AuthSession,
  type ChangePasswordOutcome,
  type IdTokenSignInOutcome,
  type MfaChallengeOutcome,
  type MfaListFactorsOutcome,
  type MfaTotpEnrollOutcome,
  type MfaUnenrollOutcome,
  type MfaVerifyOutcome,
  type SignInOutcome,
  type SignUpOutcome,
} from './app-auth'
import type { AuthErrorClassification } from './auth-recovery'
import type { NativeIdentityProviderId } from './native-identity'
import { extractSessionTokenFromCookieHeader } from './session-token'

/**
 * The subset of the better-auth client this adapter depends on. Declaring it
 * structurally (rather than importing the vendor type at runtime) lets tests
 * inject a fake and keeps the vendor package out of the adapter's module graph.
 * The runtime passes the real `ApiAuthClient`, narrowed via `asClientPort`.
 */
export type BetterAuthUser = { id: string; twoFactorEnabled?: boolean } & Record<string, unknown>
export type BetterAuthSessionData = {
  session: { token: string } & Record<string, unknown>
  user: BetterAuthUser
}

export type AuthResult<Value> = Readonly<{
  data: Value | null
  error: unknown | null
}>

export type BetterAuthClientPort = Readonly<{
  getSession: (input?: { query?: { disableCookieCache?: boolean } }) => Promise<AuthResult<BetterAuthSessionData>>
  signIn: Readonly<{
    email: (input: { email: string; password: string }) => Promise<AuthResult<Record<string, unknown>>>
    social: (input: {
      provider: NativeIdentityProviderId
      idToken: { token: string; nonce?: string }
      disableRedirect: boolean
    }) => Promise<AuthResult<Record<string, unknown>>>
  }>
  signUp: Readonly<{
    email: (input: { email: string; password: string; name?: string }) => Promise<AuthResult<Record<string, unknown>>>
  }>
  signOut: () => Promise<AuthResult<unknown>>
  changePassword: (input: {
    currentPassword: string
    newPassword: string
    revokeOtherSessions?: boolean
  }) => Promise<AuthResult<unknown>>
  twoFactor: Readonly<{
    enable: (input: { password?: string; method?: 'totp' | 'otp' }) => Promise<
      AuthResult<{ method: string; totpURI?: string; backupCodes?: string[] }>
    >
    disable: (input: { password?: string }) => Promise<AuthResult<{ status: boolean }>>
    verifyTotp: (input: { code: string; trustDevice?: boolean }) => Promise<AuthResult<unknown>>
    verifyBackupCode: (input: { code: string; trustDevice?: boolean }) => Promise<AuthResult<unknown>>
  }>
  $store?: Readonly<{
    notify: (signal: string) => void
    listen: (signal: string, listener: () => void) => void
  }>
  /**
   * The Expo client plugin's cookie reader. Present on the real client; absent
   * on fakes that do not exercise the bearer snapshot. When present, its
   * session-cookie value is the opaque bearer token `/v1/*` authenticates with.
   */
  getCookie?: () => Promise<string>
}>

const INVALID_SESSION_STATUSES = new Set([401, 403])

/** better-auth codes whose only honest classification is "user's fault, retry input". */
const INVALID_CREDENTIALS_CODES = new Set(['INVALID_EMAIL_OR_PASSWORD', 'INVALID_EMAIL', 'USER_NOT_FOUND'])
const EMAIL_TAKEN_CODES = new Set(['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'])
const WEAK_PASSWORD_CODES = new Set(['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG'])
const INVALID_CODE_CODES = new Set(['INVALID_CODE', 'INVALID_BACKUP_CODE', 'OTP_HAS_EXPIRED'])

type ErrorLike = { status?: unknown; code?: unknown; error?: unknown }

const asErrorLike = (error: unknown): ErrorLike => (
  typeof error === 'object' && error !== null ? error as ErrorLike : {}
)

const errorStatus = (error: unknown): number | null => {
  const status = asErrorLike(error).status
  return typeof status === 'number' ? status : null
}

const errorCode = (error: unknown): string | null => {
  const direct = asErrorLike(error).code
  if (typeof direct === 'string') return direct
  const body = asErrorLike(error).error
  if (typeof body === 'object' && body !== null) {
    const nested = (body as { code?: unknown }).code
    if (typeof nested === 'string') return nested
  }
  return null
}

/**
 * The TOTP secret lives inside the otpauth URI better-auth returns. The manual
 * entry field in the security UI needs it separately; it is never logged.
 */
const secretFromTotpUri = (uri: string): string => {
  try {
    return new URL(uri).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

/**
 * Maps a better-auth session onto the application's session shape. The bearer
 * credential is the session-cookie value the bearer plugin verifies; the raw
 * `session.token` is only a fallback for a client without the cookie plugin.
 */
const toAuthSession = async (
  client: BetterAuthClientPort,
  data: BetterAuthSessionData,
): Promise<AuthSession> => {
  let bearer = data.session.token
  if (client.getCookie) {
    try {
      bearer = extractSessionTokenFromCookieHeader(await client.getCookie()) ?? bearer
    } catch {
      // A cookie read failure is recoverable: keep the session token.
    }
  }
  return {
    user: { id: data.user.id },
    accessToken: bearer,
  }
}

export function createAppAuthAdapter(client: BetterAuthClientPort): AppAuthAdapter {
  // better-auth issues no session until the second factor is verified, so the
  // pending state cannot be re-derived from `getSession`; it is recorded here
  // when a sign-in returns `twoFactorRedirect` and cleared on step-up success.
  let mfaPending = false
  let refreshTimer: ReturnType<typeof setInterval> | null = null

  const sessionResult = async (): Promise<AuthResult<AuthSession>> => {
    try {
      const { data, error } = await client.getSession()
      if (error || !data) return { data: null, error: error ?? null }
      return { data: await toAuthSession(client, data), error: null }
    } catch (error: unknown) {
      return { data: null, error }
    }
  }

  const clearAutoRefresh = () => {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  return {
    getSession: async () => {
      const result = await sessionResult()
      return { data: { session: result.data }, error: result.error }
    },

    onAuthStateChange: (callback) => {
      const store = client.$store
      if (!store) {
        return { data: { subscription: { unsubscribe: () => undefined } } }
      }
      const listener = () => {
        void sessionResult()
          .then(({ data }) => callback('SESSION_CHANGED', data))
          .catch(() => undefined)
      }
      store.listen('$sessionSignal', listener)
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              // better-auth's store has no per-listener removal; the lifecycle
              // only ever holds one subscription for its lifetime, and a stale
              // callback after dispose is harmless (the lifecycle guards on
              // `disposed` before setting state).
            },
          },
        },
      }
    },

    startAutoRefresh: async () => {
      clearAutoRefresh()
      // The lifecycle owns when refresh runs (active/inactive); this timer just
      // keeps the cookie/session fresh while the app is foregrounded.
      refreshTimer = setInterval(() => {
        void client.getSession({ query: { disableCookieCache: true } }).catch(() => undefined)
      }, 10 * 60 * 1000)
    },

    stopAutoRefresh: async () => {
      clearAutoRefresh()
    },

    refreshSession: async () => {
      try {
        const { data, error } = await client.getSession({ query: { disableCookieCache: true } })
        if (error || !data) return { data: { session: null }, error: error ?? null }
        return { data: { session: await toAuthSession(client, data) }, error: null }
      } catch (error: unknown) {
        return { data: { session: null }, error }
      }
    },

    getAuthenticatorAssuranceLevel: async () => {
      try {
        const { data, error } = await client.getSession()
        if (error || !data) {
          return { data: { currentLevel: null, nextLevel: null }, error: error ?? null }
        }
        // better-auth only issues a session after any required TOTP step-up, so
        // an existing session is already aal2-equivalent.
        return { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }
      } catch (error: unknown) {
        return { data: { currentLevel: null, nextLevel: null }, error }
      }
    },

    classifyAuthError: (error: unknown): AuthErrorClassification => {
      const status = errorStatus(error)
      return status !== null && INVALID_SESSION_STATUSES.has(status) ? 'invalid-session' : 'transient'
    },

    getState: async (): Promise<AppAuthState> => {
      if (mfaPending) return { status: 'mfa-pending' }
      const { data, error } = await sessionResult()
      if (error) return { status: 'recoverable-error' }
      return data ? { status: 'authenticated', session: data } : { status: 'signed-out' }
    },

    signInWithPassword: async (email, password): Promise<SignInOutcome> => {
      try {
        const { data, error } = await client.signIn.email({ email, password })
        if (error) {
          const code = errorCode(error)
          if (code !== null && INVALID_CREDENTIALS_CODES.has(code)) return { status: 'invalid-credentials' }
          if (errorStatus(error) === 401) return { status: 'invalid-credentials' }
          return { status: 'unavailable' }
        }
        if (data?.twoFactorRedirect === true) {
          mfaPending = true
          return { status: 'mfa-pending' }
        }
        if (data) {
          mfaPending = false
          return { status: 'accepted' }
        }
        return { status: 'unavailable' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    signInWithIdToken: async (provider, token, nonce): Promise<IdTokenSignInOutcome> => {
      try {
        const { data, error } = await client.signIn.social({
          provider,
          idToken: { token, nonce },
          disableRedirect: true,
        })
        if (error || !data) return { status: 'unavailable' }
        if (data.twoFactorRedirect === true) {
          mfaPending = true
          return { status: 'mfa-pending' }
        }
        mfaPending = false
        return { status: 'accepted' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    signUp: async (email, password): Promise<SignUpOutcome> => {
      try {
        const { data, error } = await client.signUp.email({ email, password })
        if (error) {
          const code = errorCode(error)
          if (code !== null && EMAIL_TAKEN_CODES.has(code)) return { status: 'email-taken' }
          if (code !== null && WEAK_PASSWORD_CODES.has(code)) return { status: 'weak-password' }
          return { status: 'unavailable' }
        }
        return data ? { status: 'accepted' } : { status: 'unavailable' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    signOutLocal: async () => {
      try {
        const { error } = await client.signOut()
        mfaPending = false
        clearAutoRefresh()
        return { error: error ?? null }
      } catch {
        mfaPending = false
        clearAutoRefresh()
        return { error: new Error('sign-out-unavailable') }
      }
    },

    mfaEnrollTotp: async (): Promise<MfaTotpEnrollOutcome> => {
      try {
        const { data, error } = await client.twoFactor.enable({ method: 'totp' })
        if (error || !data || data.method !== 'totp' || typeof data.totpURI !== 'string') {
          return { status: 'unavailable' }
        }
        return {
          status: 'enrolled',
          factorId: TOTP_FACTOR_ID,
          totp: {
            qrCode: data.totpURI,
            secret: secretFromTotpUri(data.totpURI),
            uri: data.totpURI,
          },
          backupCodes: data.backupCodes ?? [],
        }
      } catch {
        return { status: 'unavailable' }
      }
    },

    mfaChallenge: async (): Promise<MfaChallengeOutcome> => ({
      status: 'challenged',
      challengeId: TOTP_FACTOR_ID,
    }),

    mfaVerify: async (_factorId, _challengeId, code): Promise<MfaVerifyOutcome> => {
      try {
        const { error } = await client.twoFactor.verifyTotp({ code })
        if (error) {
          const status = errorCode(error)
          return status !== null && INVALID_CODE_CODES.has(status)
            ? { status: 'invalid-code' }
            : { status: 'unavailable' }
        }
        mfaPending = false
        // `verifyTotp` rotates the session (enrollment) or creates it (sign-in),
        // so re-read it now: the bearer snapshot picks up the new opaque token.
        await client.getSession({ query: { disableCookieCache: true } }).catch(() => undefined)
        return { status: 'verified' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    mfaUnenroll: async (): Promise<MfaUnenrollOutcome> => {
      try {
        const { error } = await client.twoFactor.disable({})
        return error ? { status: 'unavailable' } : { status: 'unenrolled' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    mfaListFactors: async (): Promise<MfaListFactorsOutcome> => {
      if (mfaPending) {
        return { status: 'available', totpFactors: [{ id: TOTP_FACTOR_ID, status: 'verified' }] }
      }
      try {
        const { data, error } = await client.getSession()
        if (error || !data) return { status: 'unavailable' }
        return {
          status: 'available',
          totpFactors: data.user.twoFactorEnabled === true
            ? [{ id: TOTP_FACTOR_ID, status: 'verified' }]
            : [],
        }
      } catch {
        return { status: 'unavailable' }
      }
    },

    changePassword: async (_email, currentPassword, newPassword): Promise<ChangePasswordOutcome> => {
      try {
        const { error } = await client.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        })
        if (error) {
          const code = errorCode(error)
          if (code === 'INVALID_PASSWORD') return { status: 'invalid-current-password' }
          if (code !== null && WEAK_PASSWORD_CODES.has(code)) return { status: 'weak-password' }
          return { status: 'unavailable' }
        }
        await client.getSession({ query: { disableCookieCache: true } }).catch(() => undefined)
        return { status: 'updated' }
      } catch {
        return { status: 'unavailable' }
      }
    },
  }
}
