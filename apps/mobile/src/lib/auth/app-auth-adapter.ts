import {
  TOTP_FACTOR_ID,
  type AppAuthAdapter,
  type AppAuthState,
  type AuthSession,
  type BrowserSignInOutcome,
  type ChangePasswordOutcome,
  type IdTokenSignInOutcome,
  type MfaChallengeOutcome,
  type MfaListFactorsOutcome,
  type MfaTotpEnrollOutcome,
  type MfaUnenrollOutcome,
  type MfaVerifyOutcome,
  type PasskeyAddOutcome,
  type PasskeyDeleteOutcome,
  type PasskeyListOutcome,
  type PasskeySignInOutcome,
  type PasskeySummary,
  type SendVerificationEmailOutcome,
  type SignInOutcome,
  type SignUpOutcome,
} from './app-auth'
import type { AuthErrorClassification } from './auth-recovery'
import type { NativeIdentityProviderId } from './native-identity'
import { isPasskeyCancellation, type PasskeyAuthenticator, type WebAuthnJson } from './native-passkeys'
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
    } | {
      provider: string
      /** An app path; the Expo client turns it into the `wondermoney://` deep link. */
      callbackURL: string
    }) => Promise<AuthResult<Record<string, unknown>>>
  }>
  signUp: Readonly<{
    email: (input: {
      email: string
      password: string
      name: string
      fetchOptions?: { headers?: Record<string, string> }
    }) => Promise<AuthResult<Record<string, unknown>>>
  }>
  signOut: () => Promise<AuthResult<unknown>>
  sendVerificationEmail: (input: { email: string }) => Promise<AuthResult<unknown>>
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
   * better-auth's raw request, through the client's plugins (the Expo plugin sends and stores
   * the cookies, the passkey challenge cookie among them). Used for the passkey endpoints, whose
   * client plugin drives the browser's WebAuthn and so can't run here.
   */
  $fetch?: (path: string, options: {
    method: 'GET' | 'POST'
    body?: Record<string, unknown>
    query?: Record<string, string>
    throw: false
  }) => Promise<AuthResult<unknown>>
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

const UNSUPPORTED_PASSKEYS: PasskeyAuthenticator = {
  isSupported: () => false,
  create: async () => null,
  get: async () => null,
}

/**
 * What the device returned, as the server's verify endpoints take it: the client extension
 * results stay on the device (as better-auth's own client does) and so does the module's
 * `getPublicKey` helper.
 */
const credentialBody = (credential: WebAuthnJson): WebAuthnJson => {
  const { clientExtensionResults: _extensions, ...rest } = credential
  const response = rest.response
  if (typeof response === 'object' && response !== null) {
    const { getPublicKey: _getPublicKey, ...fields } = response as Record<string, unknown>
    return { ...rest, response: fields }
  }
  return rest
}

const asText = (value: unknown): string | null => {
  if (typeof value === 'string' && value) return value
  if (value instanceof Date) return value.toISOString()
  return null
}

const toPasskeySummary = (row: unknown): PasskeySummary | null => {
  if (typeof row !== 'object' || row === null) return null
  const record = row as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null
  return {
    id: record.id,
    name: asText(record.name),
    aaguid: asText(record.aaguid),
    createdAt: asText(record.createdAt),
    lastUsedAt: asText(record.lastUsedAt),
  }
}

/**
 * `passkeys` is the device's prompt (`nativePasskeyAuthenticator` in the app); without it every
 * passkey call answers `unavailable`.
 */
export function createAppAuthAdapter(
  client: BetterAuthClientPort,
  passkeys: PasskeyAuthenticator = UNSUPPORTED_PASSKEYS,
): AppAuthAdapter {
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
      // better-auth's `$store.listen` is a nanostores `subscribe`, which calls the
      // listener once, synchronously, with the current value. That call is not a
      // session change: the lifecycle's own bootstrap `getSession` owns the
      // initial state (and maps a failure to a retryable error). Reacting to it
      // here raced the bootstrap and, because any auth event supersedes the
      // bootstrap result, decided the cold-start state from this path instead.
      let subscribed = false
      const listener = () => {
        if (!subscribed) return
        void sessionResult()
          .then(({ data, error }) => {
            // A failed lookup (offline, server down, keychain read failure) says
            // nothing about the session. Reporting it as `null` signed the user
            // out on any transient error; keep the current state instead and let
            // a real signal or the next request decide.
            if (error) return
            callback('SESSION_CHANGED', data)
          })
          .catch(() => undefined)
      }
      store.listen('$sessionSignal', listener)
      subscribed = true
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

    signInWithBrowser: async (provider): Promise<BrowserSignInOutcome> => {
      try {
        // Resolves once the browser sheet closes: on the deep link back, on a refusal page the
        // person dismissed, or on cancel. The Expo client has stored whatever cookie came back.
        const { error } = await client.signIn.social({ provider, callbackURL: '/auth/complete' })
        if (error) return { status: 'unavailable' }
        const { data } = await client.getSession({ query: { disableCookieCache: true } })
        if (data) {
          mfaPending = false
          return { status: 'accepted' }
        }
        // A two-factor account: twoFactorOAuthGuard swapped the session for the pending
        // two-factor cookie, which `twoFactor.verifyTotp` completes.
        const cookie = client.getCookie ? await client.getCookie() : ''
        if (/(?:^|[;\s.])two_factor=/.test(cookie)) {
          mfaPending = true
          return { status: 'mfa-pending' }
        }
        return { status: 'unavailable' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    signInWithPasskey: async (): Promise<PasskeySignInOutcome> => {
      const request = client.$fetch
      if (!request || !passkeys.isSupported()) return { status: 'unavailable' }
      try {
        const options = await request('/passkey/generate-authenticate-options', { method: 'GET', throw: false })
        if (options.error || typeof options.data !== 'object' || options.data === null) return { status: 'unavailable' }
        let assertion: WebAuthnJson | null
        try {
          assertion = await passkeys.get(options.data as WebAuthnJson)
        } catch (error: unknown) {
          return isPasskeyCancellation(error) ? { status: 'cancelled' } : { status: 'unavailable' }
        }
        if (!assertion) return { status: 'cancelled' }
        const verified = await request('/passkey/verify-authentication', {
          method: 'POST',
          body: { response: credentialBody(assertion) },
          throw: false,
        })
        if (verified.error || !verified.data) return { status: 'unavailable' }
        // The Expo plugin stored the session cookie the verification set; re-read the session so
        // the bearer snapshot and the cached session pick it up, as after any other sign-in.
        const { data } = await client.getSession({ query: { disableCookieCache: true } })
        if (!data) return { status: 'unavailable' }
        mfaPending = false
        return { status: 'accepted' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    listPasskeys: async (): Promise<PasskeyListOutcome> => {
      const request = client.$fetch
      if (!request) return { status: 'unavailable' }
      try {
        const { data, error } = await request('/passkey/list-user-passkeys', { method: 'GET', throw: false })
        if (error || !Array.isArray(data)) return { status: 'unavailable' }
        return {
          status: 'available',
          passkeys: data.map(toPasskeySummary).filter((passkey): passkey is PasskeySummary => passkey !== null),
        }
      } catch {
        return { status: 'unavailable' }
      }
    },

    addPasskey: async (): Promise<PasskeyAddOutcome> => {
      const request = client.$fetch
      if (!request || !passkeys.isSupported()) return { status: 'unavailable' }
      try {
        const options = await request('/passkey/generate-register-options', { method: 'GET', throw: false })
        if (options.error) {
          return errorCode(options.error) === 'SESSION_NOT_FRESH' ? { status: 'session-not-fresh' } : { status: 'unavailable' }
        }
        if (typeof options.data !== 'object' || options.data === null) return { status: 'unavailable' }
        let credential: WebAuthnJson | null
        try {
          credential = await passkeys.create(options.data as WebAuthnJson)
        } catch (error: unknown) {
          return isPasskeyCancellation(error) ? { status: 'cancelled' } : { status: 'unavailable' }
        }
        if (!credential) return { status: 'cancelled' }
        // No name: the list labels it by its password manager, as the web app does.
        const verified = await request('/passkey/verify-registration', {
          method: 'POST',
          body: { response: credentialBody(credential) },
          throw: false,
        })
        if (verified.error) {
          return errorCode(verified.error) === 'SESSION_NOT_FRESH' ? { status: 'session-not-fresh' } : { status: 'unavailable' }
        }
        return verified.data ? { status: 'added' } : { status: 'unavailable' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    deletePasskey: async (id): Promise<PasskeyDeleteOutcome> => {
      const request = client.$fetch
      if (!request) return { status: 'unavailable' }
      try {
        const { error } = await request('/passkey/delete-passkey', { method: 'POST', body: { id }, throw: false })
        return error ? { status: 'unavailable' } : { status: 'deleted' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    signUp: async (email, password, locale): Promise<SignUpOutcome> => {
      try {
        // better-auth requires a name; like the web form, the address's local part stands in.
        // The app sends no callback page, so the API reads the sign-up's language from
        // Accept-Language: its verification email goes out before the account exists.
        const { data, error } = await client.signUp.email({
          email,
          password,
          name: email.split('@')[0] || email,
          ...(locale ? { fetchOptions: { headers: { 'Accept-Language': locale } } } : {}),
        })
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

    sendVerificationEmail: async (email): Promise<SendVerificationEmailOutcome> => {
      try {
        const { error } = await client.sendVerificationEmail({ email })
        return error ? { status: 'unavailable' } : { status: 'sent' }
      } catch {
        return { status: 'unavailable' }
      }
    },
  }
}
