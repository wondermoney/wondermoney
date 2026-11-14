import {
  createAppAuthAdapter,
  type BetterAuthClientPort,
  type BetterAuthSessionData,
} from './app-auth-adapter'

type FakePort = {
  -readonly [Key in keyof BetterAuthClientPort]: BetterAuthClientPort[Key]
}

const sessionData = (id: string, token = `token-${id}`): BetterAuthSessionData => ({
  session: { token },
  user: { id },
})

const createPort = (overrides: Partial<{
  getSession: jest.Mock
  getCookie: jest.Mock
  signInEmail: jest.Mock
  signInSocial: jest.Mock
  signUpEmail: jest.Mock
  signOut: jest.Mock
  changePassword: jest.Mock
  sendVerificationEmail: jest.Mock
  twoFactorEnable: jest.Mock
  twoFactorDisable: jest.Mock
  twoFactorVerifyTotp: jest.Mock
  twoFactorVerifyBackupCode: jest.Mock
}> = {}) => {
  const port: FakePort = {
    getSession: overrides.getSession ?? jest.fn().mockResolvedValue({ data: null, error: null }),
    getCookie: overrides.getCookie ?? jest.fn().mockResolvedValue(''),
    signIn: {
      email: overrides.signInEmail ?? jest.fn(),
      social: overrides.signInSocial ?? jest.fn(),
    },
    signUp: { email: overrides.signUpEmail ?? jest.fn() },
    signOut: overrides.signOut ?? jest.fn().mockResolvedValue({ data: {}, error: null }),
    changePassword: overrides.changePassword ?? jest.fn(),
    sendVerificationEmail: overrides.sendVerificationEmail ?? jest.fn(),
    twoFactor: {
      enable: overrides.twoFactorEnable ?? jest.fn(),
      disable: overrides.twoFactorDisable ?? jest.fn().mockResolvedValue({ data: { status: true }, error: null }),
      verifyTotp: overrides.twoFactorVerifyTotp ?? jest.fn(),
      verifyBackupCode: overrides.twoFactorVerifyBackupCode ?? jest.fn(),
    },
  }
  return port
}

const errorLike = (status: number, code?: string) => ({ status, code, error: { code } })

describe('app auth adapter — bearer snapshot', () => {
  it('uses the session-cookie value as the opaque bearer token', async () => {
    const port = createPort({
      getSession: jest.fn().mockResolvedValue({ data: sessionData('u1', 'raw'), error: null }),
      getCookie: jest.fn().mockResolvedValue('better-auth.session_token=signed.value'),
    })
    const adapter = createAppAuthAdapter(port)

    await expect(adapter.getSession()).resolves.toEqual({
      data: { session: { user: { id: 'u1' }, accessToken: 'signed.value' } },
      error: null,
    })
  })

  it('falls back to the raw session token when the cookie is unreadable', async () => {
    const port = createPort({
      getSession: jest.fn().mockResolvedValue({ data: sessionData('u1', 'raw'), error: null }),
      getCookie: jest.fn().mockRejectedValue(new Error('keychain locked')),
    })
    const adapter = createAppAuthAdapter(port)

    await expect(adapter.getSession()).resolves.toMatchObject({
      data: { session: { accessToken: 'raw' } },
    })
  })
})

describe('app auth adapter — password sign-in and pending MFA', () => {
  it('maps a successful password sign-in to accepted', async () => {
    const signInEmail = jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const adapter = createAppAuthAdapter(createPort({ signInEmail }))

    await expect(adapter.signInWithPassword('a@b.co', 'secret')).resolves.toEqual({ status: 'accepted' })
    expect(signInEmail).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret' })
  })

  it('maps a two-factor redirect to mfa-pending and reports it from getState', async () => {
    const signInEmail = jest.fn().mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    const adapter = createAppAuthAdapter(createPort({ signInEmail }))

    await expect(adapter.signInWithPassword('a@b.co', 'secret')).resolves.toEqual({ status: 'mfa-pending' })
    await expect(adapter.getState()).resolves.toEqual({ status: 'mfa-pending' })
  })

  it('never authorizes product activation while a step-up is pending', async () => {
    const signInEmail = jest.fn().mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    const getSession = jest.fn().mockResolvedValue({ data: null, error: null })
    const adapter = createAppAuthAdapter(createPort({ signInEmail, getSession }))

    await adapter.signInWithPassword('a@b.co', 'secret')

    // better-auth issues no session before the second factor, so there is
    // nothing for the lifecycle to activate even if it asks.
    await expect(adapter.getSession()).resolves.toEqual({ data: { session: null }, error: null })
  })

  it('classifies invalid credentials without leaking the error', async () => {
    const signInEmail = jest.fn().mockResolvedValue({
      data: null,
      error: errorLike(401, 'INVALID_EMAIL_OR_PASSWORD'),
    })
    const adapter = createAppAuthAdapter(createPort({ signInEmail }))

    await expect(adapter.signInWithPassword('a@b.co', 'bad')).resolves.toEqual({ status: 'invalid-credentials' })
  })

  it('treats a thrown sign-in as unavailable (transient, session preserved)', async () => {
    const signInEmail = jest.fn().mockRejectedValue(new Error('network down'))
    const adapter = createAppAuthAdapter(createPort({ signInEmail }))

    await expect(adapter.signInWithPassword('a@b.co', 'secret')).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('app auth adapter — native ID token', () => {
  it('exchanges an ID token and nonce and stays lossy on failure', async () => {
    const signInSocial = jest.fn()
      .mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null })
      .mockResolvedValueOnce({ data: null, error: errorLike(400, 'INVALID_TOKEN') })
    const adapter = createAppAuthAdapter(createPort({ signInSocial }))

    await expect(adapter.signInWithIdToken('apple', 'id-token', 'nonce')).resolves.toEqual({ status: 'accepted' })
    expect(signInSocial).toHaveBeenCalledWith({
      provider: 'apple',
      idToken: { token: 'id-token', nonce: 'nonce' },
      disableRedirect: true,
    })

    const rejected = await adapter.signInWithIdToken('google', 'id-token', 'nonce')
    expect(rejected).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(rejected)).not.toContain('id-token')
  })

  it('reports a social two-factor redirect as mfa-pending without a session', async () => {
    const signInSocial = jest.fn().mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    const adapter = createAppAuthAdapter(createPort({ signInSocial }))

    await expect(adapter.signInWithIdToken('google', 'id-token', 'nonce')).resolves.toEqual({ status: 'mfa-pending' })
  })
})

describe('app auth adapter — single sign-on in the browser', () => {
  const browserRedirect = () => jest.fn().mockResolvedValue({ data: { redirect: true, url: 'https://sso.example.com/authorize' }, error: null })

  it('runs the provider\'s browser flow back to the app and accepts the session it brought', async () => {
    const signInSocial = browserRedirect()
    const getSession = jest.fn().mockResolvedValue({ data: sessionData('u1'), error: null })
    const adapter = createAppAuthAdapter(createPort({ getSession, signInSocial }))

    await expect(adapter.signInWithBrowser('oidc')).resolves.toEqual({ status: 'accepted' })
    expect(signInSocial).toHaveBeenCalledWith({ provider: 'oidc', callbackURL: '/auth/complete' })
    await expect(adapter.getState()).resolves.toMatchObject({ status: 'authenticated' })
  })

  it('reports a two-factor account as mfa-pending from the pending cookie, with no session', async () => {
    const adapter = createAppAuthAdapter(createPort({
      getCookie: jest.fn().mockResolvedValue('better-auth.two_factor=pending.signature'),
      signInSocial: browserRedirect(),
    }))

    await expect(adapter.signInWithBrowser('oidc')).resolves.toEqual({ status: 'mfa-pending' })
    await expect(adapter.getState()).resolves.toEqual({ status: 'mfa-pending' })
  })

  it('reports a refused, cancelled or failed sign-in as unavailable', async () => {
    const refused = createAppAuthAdapter(createPort({ signInSocial: browserRedirect() }))
    await expect(refused.signInWithBrowser('oidc')).resolves.toEqual({ status: 'unavailable' })

    const failed = createAppAuthAdapter(createPort({ signInSocial: jest.fn().mockResolvedValue({ data: null, error: errorLike(404, 'PROVIDER_NOT_FOUND') }) }))
    await expect(failed.signInWithBrowser('oidc')).resolves.toEqual({ status: 'unavailable' })

    const thrown = createAppAuthAdapter(createPort({ signInSocial: jest.fn().mockRejectedValue(new Error('browser unavailable')) }))
    await expect(thrown.signInWithBrowser('oidc')).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('app auth adapter — TOTP lifecycle', () => {
  it('enrolls a TOTP factor, extracting the manual-entry secret from the otpauth URI', async () => {
    const twoFactorEnable = jest.fn().mockResolvedValue({
      data: {
        method: 'totp',
        totpURI: 'otpauth://totp/WonderMoney:me?secret=JBSWY3DPEHPK3PXP&issuer=WonderMoney',
        backupCodes: ['abc', 'def'],
      },
      error: null,
    })
    const adapter = createAppAuthAdapter(createPort({ twoFactorEnable }))

    await expect(adapter.mfaEnrollTotp()).resolves.toEqual({
      status: 'enrolled',
      factorId: 'totp',
      totp: {
        qrCode: 'otpauth://totp/WonderMoney:me?secret=JBSWY3DPEHPK3PXP&issuer=WonderMoney',
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/WonderMoney:me?secret=JBSWY3DPEHPK3PXP&issuer=WonderMoney',
      },
      backupCodes: ['abc', 'def'],
    })
    expect(twoFactorEnable).toHaveBeenCalledWith({ method: 'totp' })
  })

  it('verifies a TOTP code, clears the pending flag, and refreshes the session', async () => {
    const signInEmail = jest.fn().mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    const twoFactorVerifyTotp = jest.fn().mockResolvedValue({ data: {}, error: null })
    const getSession = jest.fn().mockResolvedValue({ data: sessionData('u1'), error: null })
    const adapter = createAppAuthAdapter(createPort({ signInEmail, twoFactorVerifyTotp, getSession }))

    await adapter.signInWithPassword('a@b.co', 'secret')
    await expect(adapter.mfaVerify('totp', 'totp', '123456')).resolves.toEqual({ status: 'verified' })
    await expect(adapter.getState()).resolves.toMatchObject({ status: 'authenticated' })
    expect(twoFactorVerifyTotp).toHaveBeenCalledWith({ code: '123456' })
  })

  it('distinguishes an invalid code from an unavailable service', async () => {
    const twoFactorVerifyTotp = jest.fn()
      .mockResolvedValueOnce({ data: null, error: errorLike(400, 'INVALID_CODE') })
      .mockResolvedValueOnce({ data: null, error: errorLike(500, 'UNEXPECTED') })
      .mockRejectedValueOnce(new Error('network'))
    const adapter = createAppAuthAdapter(createPort({ twoFactorVerifyTotp }))

    await expect(adapter.mfaVerify('totp', 'totp', '000000')).resolves.toEqual({ status: 'invalid-code' })
    await expect(adapter.mfaVerify('totp', 'totp', '000000')).resolves.toEqual({ status: 'unavailable' })
    await expect(adapter.mfaVerify('totp', 'totp', '000000')).resolves.toEqual({ status: 'unavailable' })
  })

  it('signs in with a backup code, clears the pending flag, and refreshes the session', async () => {
    const signInEmail = jest.fn().mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    const twoFactorVerifyBackupCode = jest.fn().mockResolvedValue({ data: {}, error: null })
    const getSession = jest.fn().mockResolvedValue({ data: sessionData('u1'), error: null })
    const adapter = createAppAuthAdapter(createPort({ signInEmail, twoFactorVerifyBackupCode, getSession }))

    await adapter.signInWithPassword('a@b.co', 'secret')
    await expect(adapter.mfaVerifyBackupCode('abcde-12345')).resolves.toEqual({ status: 'verified' })
    await expect(adapter.getState()).resolves.toMatchObject({ status: 'authenticated' })
    // No trustDevice: the next sign-in asks for a second factor again.
    expect(twoFactorVerifyBackupCode).toHaveBeenCalledWith({ code: 'abcde-12345' })
  })

  it('classifies better-auth\'s backup-code refusals', async () => {
    const twoFactorVerifyBackupCode = jest.fn()
      .mockResolvedValueOnce({ data: null, error: errorLike(401, 'INVALID_BACKUP_CODE') })
      .mockResolvedValueOnce({ data: null, error: errorLike(400, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') })
      .mockResolvedValueOnce({ data: null, error: errorLike(401, 'INVALID_TWO_FACTOR_COOKIE') })
      .mockResolvedValueOnce({ data: null, error: errorLike(429, 'ACCOUNT_TEMPORARILY_LOCKED') })
      .mockResolvedValueOnce({ data: null, error: errorLike(429) })
      .mockResolvedValueOnce({ data: null, error: errorLike(409) })
      .mockRejectedValueOnce(new Error('network'))
    const signInEmail = jest.fn().mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    const adapter = createAppAuthAdapter(createPort({ signInEmail, twoFactorVerifyBackupCode }))
    await adapter.signInWithPassword('a@b.co', 'secret')

    await expect(adapter.mfaVerifyBackupCode('used0-codes')).resolves.toEqual({ status: 'invalid-code' })
    await expect(adapter.mfaVerifyBackupCode('x')).resolves.toEqual({ status: 'challenge-expired' })
    await expect(adapter.mfaVerifyBackupCode('x')).resolves.toEqual({ status: 'challenge-expired' })
    await expect(adapter.mfaVerifyBackupCode('x')).resolves.toEqual({ status: 'rate-limited' })
    await expect(adapter.mfaVerifyBackupCode('x')).resolves.toEqual({ status: 'rate-limited' })
    await expect(adapter.mfaVerifyBackupCode('x')).resolves.toEqual({ status: 'unavailable' })
    await expect(adapter.mfaVerifyBackupCode('x')).resolves.toEqual({ status: 'unavailable' })
    // A refused code leaves the sign-in pending.
    await expect(adapter.getState()).resolves.toEqual({ status: 'mfa-pending' })
  })

  it('lists a verified factor only when the user has two-factor enabled', async () => {
    const getSession = jest.fn().mockResolvedValue({
      data: { session: { token: 't' }, user: { id: 'u1', twoFactorEnabled: true } },
      error: null,
    })
    const adapter = createAppAuthAdapter(createPort({ getSession }))

    await expect(adapter.mfaListFactors()).resolves.toEqual({
      status: 'available',
      totpFactors: [{ id: 'totp', status: 'verified' }],
    })
  })

  it('disables two-factor authentication', async () => {
    const twoFactorDisable = jest.fn().mockResolvedValue({ data: { status: true }, error: null })
    const adapter = createAppAuthAdapter(createPort({ twoFactorDisable }))

    await expect(adapter.mfaUnenroll('totp')).resolves.toEqual({ status: 'unenrolled' })
    expect(twoFactorDisable).toHaveBeenCalledWith({})
  })
})

describe('app auth adapter — password change and classification', () => {
  it('maps change-password outcomes', async () => {
    const changePassword = jest.fn()
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: errorLike(400, 'INVALID_PASSWORD') })
      .mockResolvedValueOnce({ data: null, error: errorLike(400, 'PASSWORD_TOO_SHORT') })
    const getSession = jest.fn().mockResolvedValue({ data: sessionData('u1'), error: null })
    const adapter = createAppAuthAdapter(createPort({ changePassword, getSession }))

    await expect(adapter.changePassword('a@b.co', 'old', 'new-secret')).resolves.toEqual({ status: 'updated' })
    expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'old', newPassword: 'new-secret', revokeOtherSessions: true })
    await expect(adapter.changePassword('a@b.co', 'wrong', 'new-secret')).resolves.toEqual({ status: 'invalid-current-password' })
    await expect(adapter.changePassword('a@b.co', 'old', 'short')).resolves.toEqual({ status: 'weak-password' })
  })

  it('maps send-verification-email outcomes and passes only the email', async () => {
    const sendVerificationEmail = jest.fn()
      .mockResolvedValueOnce({ data: { status: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: errorLike(429) })
      .mockRejectedValueOnce(new Error('offline'))
    const adapter = createAppAuthAdapter(createPort({ sendVerificationEmail }))

    await expect(adapter.sendVerificationEmail('a@b.co')).resolves.toEqual({ status: 'sent' })
    expect(sendVerificationEmail).toHaveBeenCalledWith({ email: 'a@b.co' })
    await expect(adapter.sendVerificationEmail('a@b.co')).resolves.toEqual({ status: 'unavailable' })
    await expect(adapter.sendVerificationEmail('a@b.co')).resolves.toEqual({ status: 'unavailable' })
  })

  it('treats only 401/403 as an invalid session, everything else as transient', () => {
    const adapter = createAppAuthAdapter(createPort())

    expect(adapter.classifyAuthError(errorLike(401, 'SESSION_EXPIRED'))).toBe('invalid-session')
    expect(adapter.classifyAuthError(errorLike(403))).toBe('invalid-session')
    expect(adapter.classifyAuthError(errorLike(503))).toBe('transient')
    expect(adapter.classifyAuthError(new Error('network'))).toBe('transient')
    expect(adapter.classifyAuthError(undefined)).toBe('transient')
  })

  it('clears the pending flag on sign-out', async () => {
    const signInEmail = jest.fn().mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    const getSession = jest.fn().mockResolvedValue({ data: null, error: null })
    const adapter = createAppAuthAdapter(createPort({ signInEmail, getSession }))

    await adapter.signInWithPassword('a@b.co', 'secret')
    await adapter.signOutLocal()
    await expect(adapter.getState()).resolves.toEqual({ status: 'signed-out' })
  })
})

/**
 * Mirrors better-auth's `$store`: `listen` is a nanostores `subscribe`, which
 * calls the listener once, synchronously, before any signal fires.
 */
const createSignalStore = () => {
  const listeners: (() => void)[] = []
  return {
    notify: (_signal: string) => { listeners.forEach((listener) => listener()) },
    listen: (_signal: string, listener: () => void) => {
      listeners.push(listener)
      listener()
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('app auth adapter — session signal', () => {
  it('ignores the synchronous call nanostores makes on subscribe', async () => {
    const getSession = jest.fn().mockResolvedValue({ data: sessionData('a'), error: null })
    const port = createPort({ getSession })
    port.$store = createSignalStore()
    const callback = jest.fn()

    createAppAuthAdapter(port).onAuthStateChange(callback)
    await flush()

    expect(getSession).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })

  it('reports a session change when the signal fires', async () => {
    const getSession = jest.fn().mockResolvedValue({ data: sessionData('a'), error: null })
    const store = createSignalStore()
    const port = createPort({ getSession })
    port.$store = store
    const callback = jest.fn()

    createAppAuthAdapter(port).onAuthStateChange(callback)
    store.notify('$sessionSignal')
    await flush()

    expect(callback).toHaveBeenCalledWith('SESSION_CHANGED', { user: { id: 'a' }, accessToken: 'token-a' })
  })

  it('never reports a failed session lookup as signed out', async () => {
    const getSession = jest.fn().mockResolvedValue({ data: null, error: { status: 0 } })
    const store = createSignalStore()
    const port = createPort({ getSession })
    port.$store = store
    const callback = jest.fn()

    createAppAuthAdapter(port).onAuthStateChange(callback)
    store.notify('$sessionSignal')
    await flush()

    expect(getSession).toHaveBeenCalledTimes(1)
    expect(callback).not.toHaveBeenCalled()
  })

  it('still reports a confirmed sign-out (no session, no error)', async () => {
    const getSession = jest.fn().mockResolvedValue({ data: null, error: null })
    const store = createSignalStore()
    const port = createPort({ getSession })
    port.$store = store
    const callback = jest.fn()

    createAppAuthAdapter(port).onAuthStateChange(callback)
    store.notify('$sessionSignal')
    await flush()

    expect(callback).toHaveBeenCalledWith('SESSION_CHANGED', null)
  })
})

const PASSWORD = 'pw12345678'

describe('app auth adapter — email sign-up', () => {
  it.each([
    ['pt', 'pt'],
    ['es', 'es'],
    ['en', 'en'],
  ] as const)('sends a %s sign-up its language as Accept-Language, with the name better-auth requires', async (locale, header) => {
    const signUpEmail = jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const adapter = createAppAuthAdapter(createPort({ signUpEmail }))

    await expect(adapter.signUp('ana.silva@example.com', PASSWORD, locale)).resolves.toEqual({ status: 'accepted' })

    expect(signUpEmail).toHaveBeenCalledWith({
      email: 'ana.silva@example.com',
      password: PASSWORD,
      name: 'ana.silva',
      fetchOptions: { headers: { 'Accept-Language': header } },
    })
  })

  it('names no callback page, so the verification link keeps its usual landing', async () => {
    const signUpEmail = jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const adapter = createAppAuthAdapter(createPort({ signUpEmail }))

    await adapter.signUp('ana@example.com', PASSWORD, 'pt')

    expect(signUpEmail.mock.calls[0][0]).not.toHaveProperty('callbackURL')
  })

  it('sends no language when it has none, and the API falls back to English', async () => {
    const signUpEmail = jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const adapter = createAppAuthAdapter(createPort({ signUpEmail }))

    await adapter.signUp('ana@example.com', PASSWORD)

    expect(signUpEmail).toHaveBeenCalledWith({ email: 'ana@example.com', password: PASSWORD, name: 'ana' })
  })

  it.each([
    ['USER_ALREADY_EXISTS', 'email-taken'],
    ['PASSWORD_TOO_SHORT', 'weak-password'],
    ['VALIDATION_ERROR', 'unavailable'],
  ])('classifies %s as %s', async (code, status) => {
    const signUpEmail = jest.fn().mockResolvedValue({ data: null, error: errorLike(400, code) })
    const adapter = createAppAuthAdapter(createPort({ signUpEmail }))

    await expect(adapter.signUp('ana@example.com', PASSWORD, 'es')).resolves.toEqual({ status })
  })
})

describe('app auth adapter — passkeys', () => {
  const authenticateOptions = { challenge: 'challenge-1', rpId: 'money.example.com', allowCredentials: [] }
  const assertion = {
    id: 'cred-1',
    rawId: 'cred-1',
    type: 'public-key',
    response: { authenticatorData: 'ad', clientDataJSON: 'cd', signature: 'sig', userHandle: 'uh' },
    clientExtensionResults: { prf: {} },
  }

  const fakeAuthenticator = (overrides: Partial<{ isSupported: jest.Mock; create: jest.Mock; get: jest.Mock }> = {}) => ({
    isSupported: overrides.isSupported ?? jest.fn(() => true),
    create: overrides.create ?? jest.fn(),
    get: overrides.get ?? jest.fn().mockResolvedValue(assertion),
  })

  /** better-auth's `$fetch`, answering by path. */
  const fakeFetch = (answers: Record<string, unknown>) => jest.fn(async (path: string) => {
    const answer = answers[path]
    if (answer === undefined) throw new Error(`unexpected ${path}`)
    return answer as { data: unknown; error: unknown }
  })

  it('signs in: the server\'s options to the device, its assertion back, then the new session', async () => {
    const $fetch = fakeFetch({
      '/passkey/generate-authenticate-options': { data: authenticateOptions, error: null },
      '/passkey/verify-authentication': { data: { session: { token: 't' } }, error: null },
    })
    const getSession = jest.fn().mockResolvedValue({ data: sessionData('u1'), error: null })
    const port = createPort({ getSession })
    port.$fetch = $fetch
    const authenticator = fakeAuthenticator()
    const adapter = createAppAuthAdapter(port, authenticator)

    await expect(adapter.signInWithPasskey()).resolves.toEqual({ status: 'accepted' })

    expect(authenticator.get).toHaveBeenCalledWith(authenticateOptions)
    expect($fetch).toHaveBeenNthCalledWith(1, '/passkey/generate-authenticate-options', { method: 'GET', throw: false })
    // The extension results stay on the device, as better-auth's own client does it.
    expect($fetch).toHaveBeenNthCalledWith(2, '/passkey/verify-authentication', {
      method: 'POST',
      body: { response: { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: assertion.response } },
      throw: false,
    })
    expect(getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } })
    await expect(adapter.getState()).resolves.toMatchObject({ status: 'authenticated' })
  })

  it('reports a closed prompt as cancelled and sends nothing to verify', async () => {
    const $fetch = fakeFetch({ '/passkey/generate-authenticate-options': { data: authenticateOptions, error: null } })
    const port = createPort()
    port.$fetch = $fetch
    const cancelled = Object.assign(new Error('User cancelled the passkey interaction'), { code: 'ERR_USER_CANCELLED' })
    const adapter = createAppAuthAdapter(port, fakeAuthenticator({ get: jest.fn().mockRejectedValue(cancelled) }))

    await expect(adapter.signInWithPasskey()).resolves.toEqual({ status: 'cancelled' })
    expect($fetch).toHaveBeenCalledTimes(1)

    const silent = createAppAuthAdapter(port, fakeAuthenticator({ get: jest.fn().mockResolvedValue(null) }))
    await expect(silent.signInWithPasskey()).resolves.toEqual({ status: 'cancelled' })
  })

  it('reports a refused assertion, a device error or a failed options request as unavailable', async () => {
    const refused = createPort()
    refused.$fetch = fakeFetch({
      '/passkey/generate-authenticate-options': { data: authenticateOptions, error: null },
      '/passkey/verify-authentication': { data: null, error: errorLike(401, 'PASSKEY_NOT_FOUND') },
    })
    await expect(createAppAuthAdapter(refused, fakeAuthenticator()).signInWithPasskey()).resolves.toEqual({ status: 'unavailable' })

    const notConfigured = createPort()
    notConfigured.$fetch = fakeFetch({ '/passkey/generate-authenticate-options': { data: authenticateOptions, error: null } })
    const deviceError = fakeAuthenticator({ get: jest.fn().mockRejectedValue(new Error('NotConfigured')) })
    await expect(createAppAuthAdapter(notConfigured, deviceError).signInWithPasskey()).resolves.toEqual({ status: 'unavailable' })

    const noOptions = createPort()
    noOptions.$fetch = fakeFetch({ '/passkey/generate-authenticate-options': { data: null, error: errorLike(500) } })
    await expect(createAppAuthAdapter(noOptions, fakeAuthenticator()).signInWithPasskey()).resolves.toEqual({ status: 'unavailable' })
  })

  it('does nothing on a device without passkeys, or without an authenticator at all', async () => {
    const port = createPort()
    const $fetch = jest.fn()
    port.$fetch = $fetch
    await expect(createAppAuthAdapter(port, fakeAuthenticator({ isSupported: jest.fn(() => false) })).signInWithPasskey()).resolves.toEqual({ status: 'unavailable' })
    await expect(createAppAuthAdapter(port).addPasskey()).resolves.toEqual({ status: 'unavailable' })
    expect($fetch).not.toHaveBeenCalled()
  })

  it('adds a passkey on this device and leaves its name to the list\'s label', async () => {
    const registerOptions = { challenge: 'c', rp: { id: 'money.example.com', name: 'WonderMoney' }, user: { id: 'dXNlcg', name: 'ana' } }
    const credential = {
      id: 'new-cred',
      response: { attestationObject: 'ao', clientDataJSON: 'cd', getPublicKey: () => 'pk' },
      clientExtensionResults: {},
    }
    const $fetch = fakeFetch({
      '/passkey/generate-register-options': { data: registerOptions, error: null },
      '/passkey/verify-registration': { data: { id: 'pk-1' }, error: null },
    })
    const port = createPort()
    port.$fetch = $fetch
    const authenticator = fakeAuthenticator({ create: jest.fn().mockResolvedValue(credential) })

    await expect(createAppAuthAdapter(port, authenticator).addPasskey()).resolves.toEqual({ status: 'added' })
    expect(authenticator.create).toHaveBeenCalledWith(registerOptions)
    expect($fetch).toHaveBeenLastCalledWith('/passkey/verify-registration', {
      method: 'POST',
      body: { response: { id: 'new-cred', response: { attestationObject: 'ao', clientDataJSON: 'cd' } } },
      throw: false,
    })
  })

  it('says when the server wants a recent sign-in before adding a passkey', async () => {
    const port = createPort()
    port.$fetch = fakeFetch({ '/passkey/generate-register-options': { data: null, error: errorLike(403, 'SESSION_NOT_FRESH') } })
    const authenticator = fakeAuthenticator()

    await expect(createAppAuthAdapter(port, authenticator).addPasskey()).resolves.toEqual({ status: 'session-not-fresh' })
    expect(authenticator.create).not.toHaveBeenCalled()
  })

  it('lists the user\'s passkeys, keeping only what the screen shows', async () => {
    const port = createPort()
    port.$fetch = fakeFetch({
      '/passkey/list-user-passkeys': {
        data: [
          { id: 'pk-1', name: 'Laptop', aaguid: 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4', createdAt: '2026-11-01T10:00:00.000Z', lastUsedAt: null, publicKey: 'secret-ish' },
          { id: 'pk-2', name: null, createdAt: '2026-11-02T10:00:00.000Z', lastUsedAt: '2026-11-03T10:00:00.000Z' },
          { name: 'no id' },
        ],
        error: null,
      },
    })

    await expect(createAppAuthAdapter(port).listPasskeys()).resolves.toEqual({
      status: 'available',
      passkeys: [
        { id: 'pk-1', name: 'Laptop', aaguid: 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4', createdAt: '2026-11-01T10:00:00.000Z', lastUsedAt: null },
        { id: 'pk-2', name: null, aaguid: null, createdAt: '2026-11-02T10:00:00.000Z', lastUsedAt: '2026-11-03T10:00:00.000Z' },
      ],
    })
  })

  it('deletes a passkey by id', async () => {
    const port = createPort()
    const $fetch = fakeFetch({ '/passkey/delete-passkey': { data: { status: true }, error: null } })
    port.$fetch = $fetch

    await expect(createAppAuthAdapter(port).deletePasskey('pk-1')).resolves.toEqual({ status: 'deleted' })
    expect($fetch).toHaveBeenCalledWith('/passkey/delete-passkey', { method: 'POST', body: { id: 'pk-1' }, throw: false })

    port.$fetch = fakeFetch({ '/passkey/delete-passkey': { data: null, error: errorLike(404, 'PASSKEY_NOT_FOUND') } })
    await expect(createAppAuthAdapter(port).deletePasskey('pk-1')).resolves.toEqual({ status: 'unavailable' })
  })
})
