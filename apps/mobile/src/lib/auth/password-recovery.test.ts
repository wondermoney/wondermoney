import {
  createPasswordRecoveryAdapter,
  isPlausibleResetToken,
  RESET_PASSWORD_REDIRECT_URL,
  type PasswordRecoveryClientPort,
} from './password-recovery'

type FakePort = {
  -readonly [Key in keyof PasswordRecoveryClientPort]: PasswordRecoveryClientPort[Key]
}

const createPort = (overrides: Partial<{
  requestPasswordReset: jest.Mock
  resetPassword: jest.Mock
  signOut: jest.Mock
}> = {}): FakePort => ({
  requestPasswordReset: overrides.requestPasswordReset ?? jest.fn().mockResolvedValue({ data: {}, error: null }),
  resetPassword: overrides.resetPassword ?? jest.fn().mockResolvedValue({ data: {}, error: null }),
  signOut: overrides.signOut ?? jest.fn().mockResolvedValue({ error: null }),
})

describe('requestReset', () => {
  it('requests a reset at the trusted deep link and reports sent', async () => {
    const requestPasswordReset = jest.fn().mockResolvedValue({ data: {}, error: null })
    const adapter = createPasswordRecoveryAdapter(createPort({ requestPasswordReset }))

    await expect(adapter.requestReset('a@b.co')).resolves.toEqual({ status: 'sent' })
    expect(requestPasswordReset).toHaveBeenCalledWith({ email: 'a@b.co', redirectTo: RESET_PASSWORD_REDIRECT_URL })
  })

  it('maps a 429 to rate-limited and anything else to unavailable', async () => {
    const rateLimited = createPasswordRecoveryAdapter(createPort({
      requestPasswordReset: jest.fn().mockResolvedValue({ data: null, error: { status: 429 } }),
    }))
    await expect(rateLimited.requestReset('a@b.co')).resolves.toEqual({ status: 'rate-limited' })

    const other = createPasswordRecoveryAdapter(createPort({
      requestPasswordReset: jest.fn().mockResolvedValue({ data: null, error: { status: 500 } }),
    }))
    await expect(other.requestReset('a@b.co')).resolves.toEqual({ status: 'unavailable' })
  })

  it('returns unavailable when the call throws', async () => {
    const adapter = createPasswordRecoveryAdapter(createPort({
      requestPasswordReset: jest.fn().mockRejectedValue(new Error('network')),
    }))
    await expect(adapter.requestReset('a@b.co')).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('confirmReset', () => {
  it('resets the password, then clears cached identity', async () => {
    const resetPassword = jest.fn().mockResolvedValue({ data: {}, error: null })
    const signOut = jest.fn().mockResolvedValue({ error: null })
    const adapter = createPasswordRecoveryAdapter(createPort({ resetPassword, signOut }))

    await expect(adapter.confirmReset('opaque-token', 'newpass123')).resolves.toEqual({ status: 'accepted' })
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: 'newpass123', token: 'opaque-token' })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('never fails the reset when clearing cached identity fails', async () => {
    const adapter = createPasswordRecoveryAdapter(createPort({
      signOut: jest.fn().mockRejectedValue(new Error('keychain locked')),
    }))

    await expect(adapter.confirmReset('opaque-token', 'newpass123')).resolves.toEqual({ status: 'accepted' })
  })

  it('refuses an implausible token before forwarding it', async () => {
    const resetPassword = jest.fn()
    const adapter = createPasswordRecoveryAdapter(createPort({ resetPassword }))

    await expect(adapter.confirmReset('   ', 'newpass123')).resolves.toEqual({ status: 'link-expired' })
    await expect(adapter.confirmReset('a'.repeat(2049), 'newpass123')).resolves.toEqual({ status: 'link-expired' })
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('maps an expired/invalid token to link-expired', async () => {
    for (const code of ['INVALID_TOKEN', 'TOKEN_EXPIRED', 'INVALID_RESET_TOKEN']) {
      const adapter = createPasswordRecoveryAdapter(createPort({
        resetPassword: jest.fn().mockResolvedValue({ data: null, error: { status: 400, error: { code } } }),
      }))
      await expect(adapter.confirmReset('opaque-token', 'newpass123')).resolves.toEqual({ status: 'link-expired' })
    }
  })

  it('maps weak passwords and other failures', async () => {
    const weak = createPasswordRecoveryAdapter(createPort({
      resetPassword: jest.fn().mockResolvedValue({ data: null, error: { status: 400, code: 'PASSWORD_TOO_SHORT' } }),
    }))
    await expect(weak.confirmReset('opaque-token', 'short')).resolves.toEqual({ status: 'weak-password' })

    const unavailable = createPasswordRecoveryAdapter(createPort({
      resetPassword: jest.fn().mockResolvedValue({ data: null, error: { status: 500 } }),
    }))
    await expect(unavailable.confirmReset('opaque-token', 'newpass123')).resolves.toEqual({ status: 'unavailable' })
  })

  it('returns unavailable when the call throws', async () => {
    const adapter = createPasswordRecoveryAdapter(createPort({
      resetPassword: jest.fn().mockRejectedValue(new Error('network')),
    }))
    await expect(adapter.confirmReset('opaque-token', 'newpass123')).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('clearCachedIdentity', () => {
  it('signs out locally and swallows failures', async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null })
    await createPasswordRecoveryAdapter(createPort({ signOut })).clearCachedIdentity()
    expect(signOut).toHaveBeenCalledTimes(1)

    const failing = createPasswordRecoveryAdapter(createPort({ signOut: jest.fn().mockRejectedValue(new Error('x')) }))
    await expect(failing.clearCachedIdentity()).resolves.toBeUndefined()
  })
})

describe('isPlausibleResetToken', () => {
  it('accepts non-empty, bounded, whitespace-free tokens only', () => {
    expect(isPlausibleResetToken('abc.def')).toBe(true)
    expect(isPlausibleResetToken('')).toBe(false)
    expect(isPlausibleResetToken('a b')).toBe(false)
    expect(isPlausibleResetToken('a'.repeat(2049))).toBe(false)
  })
})
