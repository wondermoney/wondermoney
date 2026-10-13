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
