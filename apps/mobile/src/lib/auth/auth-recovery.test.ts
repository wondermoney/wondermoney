import {
  createAuthRecoveryCoordinator,
  type AuthRecoveryPort,
} from './auth-recovery'

type Session = { accessToken: string }

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const sessionResult = (accessToken: string | null) => ({
  data: { session: accessToken ? { accessToken } : null },
  error: null,
})

const createHarness = () => {
  const auth: AuthRecoveryPort<Session> = {
    getSession: jest.fn().mockResolvedValue(sessionResult('token-a')),
    refreshSession: jest.fn().mockResolvedValue(sessionResult('token-b')),
    getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    }),
    classifyAuthError: jest.fn((error) =>
      (error as { status?: number })?.status === 401 ||
      (error as { status?: number })?.status === 403
        ? 'invalid-session'
        : 'transient',
    ),
  }
  const transitionAuthenticatedContext = jest.fn().mockResolvedValue(undefined)
  const coordinator = createAuthRecoveryCoordinator({
    auth,
    transitionAuthenticatedContext,
  })
  return { auth, coordinator, transitionAuthenticatedContext }
}

describe('auth recovery coordinator', () => {
  it('takes an initial token snapshot and advances on external token rotation', async () => {
    const { auth, coordinator } = createHarness()
    await expect(coordinator.getTokenSnapshot()).resolves.toEqual({
      status: 'available',
      snapshot: { accessToken: 'token-a', tokenGeneration: 0 },
    })
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult('external-token'))
    await expect(coordinator.getTokenSnapshot()).resolves.toEqual({
      status: 'available',
      snapshot: { accessToken: 'external-token', tokenGeneration: 1 },
    })
  })

  it('single-flights same-generation refresh and advances after same-token success', async () => {
    const { auth, coordinator } = createHarness()
    const initial = await coordinator.getTokenSnapshot()
    if (initial.status !== 'available') throw new Error('test setup failed')
    const refresh = deferred<ReturnType<typeof sessionResult>>()
    jest.mocked(auth.refreshSession).mockReturnValue(refresh.promise)

    const first = coordinator.refreshAfterUnauthorized(initial.snapshot)
    const second = coordinator.refreshAfterUnauthorized(initial.snapshot)
    await Promise.resolve()
    await Promise.resolve()
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)

    refresh.resolve(sessionResult('token-a'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'available', snapshot: { accessToken: 'token-a', tokenGeneration: 1 } },
      { status: 'available', snapshot: { accessToken: 'token-a', tokenGeneration: 1 } },
    ])
  })

  it('allows a transient failed refresh to retry without changing token state', async () => {
    const { auth, coordinator } = createHarness()
    const initial = await coordinator.getTokenSnapshot()
    if (initial.status !== 'available') throw new Error('test setup failed')
    jest.mocked(auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: { status: 503, message: 'refresh secret' },
    })

    await expect(coordinator.refreshAfterUnauthorized(initial.snapshot)).resolves.toEqual({
      status: 'unavailable',
    })
    jest.mocked(auth.refreshSession).mockResolvedValue(sessionResult('token-final'))
    await expect(coordinator.refreshAfterUnauthorized(initial.snapshot)).resolves.toEqual({
      status: 'available',
      snapshot: { accessToken: 'token-final', tokenGeneration: 1 },
    })
    expect(auth.refreshSession).toHaveBeenCalledTimes(2)
  })

  it('reuses a newer snapshot for an old-generation 401', async () => {
    const { auth, coordinator } = createHarness()
    const old = await coordinator.getTokenSnapshot()
    if (old.status !== 'available') throw new Error('test setup failed')
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult('rotated'))

    await expect(coordinator.refreshAfterUnauthorized(old.snapshot)).resolves.toEqual({
      status: 'available',
      snapshot: { accessToken: 'rotated', tokenGeneration: 1 },
    })
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('prevents an older refresh from overwriting a newer generation', async () => {
    const { auth, coordinator } = createHarness()
    const old = await coordinator.getTokenSnapshot()
    if (old.status !== 'available') throw new Error('test setup failed')
    const oldRefresh = deferred<ReturnType<typeof sessionResult>>()
    const newRefresh = deferred<ReturnType<typeof sessionResult>>()
    jest.mocked(auth.refreshSession)
      .mockReturnValueOnce(oldRefresh.promise)
      .mockReturnValueOnce(newRefresh.promise)

    const oldFlight = coordinator.refreshAfterUnauthorized(old.snapshot)
    await Promise.resolve()
    await Promise.resolve()
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult('token-external'))
    const newer = await coordinator.getTokenSnapshot()
    if (newer.status !== 'available') throw new Error('test setup failed')
    const newFlight = coordinator.refreshAfterUnauthorized(newer.snapshot)
    await Promise.resolve()
    await Promise.resolve()

    newRefresh.resolve(sessionResult('token-newest'))
    await expect(newFlight).resolves.toEqual({
      status: 'available',
      snapshot: { accessToken: 'token-newest', tokenGeneration: 2 },
    })
    oldRefresh.resolve(sessionResult('token-stale'))
    await expect(oldFlight).resolves.toEqual({
      status: 'available',
      snapshot: { accessToken: 'token-newest', tokenGeneration: 2 },
    })
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult('token-newest'))
    await expect(coordinator.getTokenSnapshot()).resolves.toEqual({
      status: 'available',
      snapshot: { accessToken: 'token-newest', tokenGeneration: 2 },
    })
  })

  it('revocation during refresh prevents a late token commit', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    const initial = await coordinator.getTokenSnapshot()
    if (initial.status !== 'available') throw new Error('test setup failed')
    const refresh = deferred<ReturnType<typeof sessionResult>>()
    jest.mocked(auth.refreshSession).mockReturnValue(refresh.promise)
    const flight = coordinator.refreshAfterUnauthorized(initial.snapshot)
    await Promise.resolve()
    await Promise.resolve()

    jest.mocked(auth.getSession).mockResolvedValue(sessionResult(null))
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    refresh.resolve(sessionResult('late-token'))
    await expect(flight).resolves.toEqual({ status: 'unavailable' })
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult('late-token'))
    await expect(coordinator.getTokenSnapshot()).resolves.toEqual({ status: 'unavailable' })
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ data: { session: null }, error: null }],
    [{ data: { session: null }, error: { status: 401, message: 'token secret' } }],
  ])('revokes immediately when refresh has no usable session', async (result) => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    const initial = await coordinator.getTokenSnapshot()
    if (initial.status !== 'available') throw new Error('test setup failed')
    jest.mocked(auth.refreshSession).mockResolvedValue(result)
    await expect(coordinator.refreshAfterUnauthorized(initial.snapshot)).resolves.toEqual({
      status: 'unavailable',
    })
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it('does not let a cached AAL2 session prevent an invalid refresh purge', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    const initial = await coordinator.getTokenSnapshot()
    if (initial.status !== 'available') throw new Error('test setup failed')
    jest.mocked(auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: { status: 401, message: 'provider secret' },
    })

    await coordinator.refreshAfterUnauthorized(initial.snapshot)
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    expect(auth.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it('does not let a cached AAL2 session prevent a null refresh-session purge', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    const initial = await coordinator.getTokenSnapshot()
    if (initial.status !== 'available') throw new Error('test setup failed')
    jest.mocked(auth.refreshSession).mockResolvedValue(sessionResult(null))

    await coordinator.refreshAfterUnauthorized(initial.snapshot)
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it('purges once for a missing session, including concurrent recoveries', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult(null))
    const transition = deferred<void>()
    transitionAuthenticatedContext.mockReturnValue(transition.promise)

    const first = coordinator.recoverTrustedUnauthorized()
    const second = coordinator.recoverTrustedUnauthorized()
    await Promise.resolve()
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
    expect(transitionAuthenticatedContext).toHaveBeenCalledWith('session-revoked')
    transition.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'session-revoked' },
      { status: 'session-revoked' },
    ])
  })

  it('joins revocation when getSession completes after the recovery epoch changed', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    const staleSession = deferred<ReturnType<typeof sessionResult>>()
    jest.mocked(auth.getSession)
      .mockReturnValueOnce(staleSession.promise)
      .mockResolvedValueOnce(sessionResult(null))

    const staleRecovery = coordinator.recoverTrustedUnauthorized()
    await Promise.resolve()
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    staleSession.resolve(sessionResult('stale-token'))

    await expect(staleRecovery).resolves.toEqual({ status: 'session-revoked' })
    expect(auth.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it('joins revocation when AAL completes after the recovery epoch changed', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    const staleAssurance = deferred<{
      data: { currentLevel: string | null; nextLevel: string | null }
      error: unknown | null
    }>()
    jest.mocked(auth.getAuthenticatorAssuranceLevel)
      .mockReturnValueOnce(staleAssurance.promise)
      .mockResolvedValueOnce({
        data: { currentLevel: null, nextLevel: null },
        error: { status: 401, message: 'invalid session' },
      })

    const staleRecovery = coordinator.recoverTrustedUnauthorized()
    await Promise.resolve()
    await Promise.resolve()
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    staleAssurance.resolve({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })

    await expect(staleRecovery).resolves.toEqual({ status: 'session-revoked' })
    expect(auth.getAuthenticatorAssuranceLevel).toHaveBeenCalledTimes(2)
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it('returns a sanitized failure and retries a rejected revoked transition', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult(null))
    transitionAuthenticatedContext
      .mockRejectedValueOnce(new Error('sensitive transition detail'))
      .mockResolvedValueOnce(undefined)

    const failure = await coordinator.recoverTrustedUnauthorized()
    expect(failure).toEqual({ status: 'auth-session' })
    expect(JSON.stringify(failure)).not.toContain('sensitive')
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(2)
  })

  it('shares one concurrent revoked transition even when it rejects', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult(null))
    const transition = deferred<void>()
    transitionAuthenticatedContext.mockReturnValue(transition.promise)

    const first = coordinator.recoverTrustedUnauthorized()
    const second = coordinator.recoverTrustedUnauthorized()
    await Promise.resolve()
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
    transition.reject(new Error('secret'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'auth-session' },
      { status: 'auth-session' },
    ])
  })

  it('does not rehydrate a successfully revoked coordinator from a stale session', async () => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult(null))
    await coordinator.recoverTrustedUnauthorized()
    jest.mocked(auth.getSession).mockResolvedValue(sessionResult('stale-cached-token'))

    await expect(coordinator.getTokenSnapshot()).resolves.toEqual({ status: 'unavailable' })
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    expect(auth.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('purges for definitive structured AAL status %s', async (status) => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    jest.mocked(auth.getAuthenticatorAssuranceLevel).mockResolvedValue({
      data: { currentLevel: null, nextLevel: null },
      error: { status, message: 'sensitive provider detail' },
    })
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'session-revoked',
    })
    expect(transitionAuthenticatedContext).toHaveBeenCalledTimes(1)
  })

  it('preserves state on transient getSession and AAL failures', async () => {
    const first = createHarness()
    jest.mocked(first.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: { status: 503, message: 'session secret' },
    })
    await expect(first.coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'auth-session',
    })
    expect(first.transitionAuthenticatedContext).not.toHaveBeenCalled()

    const second = createHarness()
    jest.mocked(second.auth.getAuthenticatorAssuranceLevel).mockRejectedValue({
      status: 503,
      message: 'aal secret',
    })
    await expect(second.coordinator.recoverTrustedUnauthorized()).resolves.toEqual({
      status: 'auth-session',
    })
    expect(second.transitionAuthenticatedContext).not.toHaveBeenCalled()
  })

  it.each([
    ['aal1', 'aal2', 'mfa-required'],
    ['aal2', 'aal2', 'auth-session'],
    ['aal1', 'aal1', 'auth-session'],
    [null, null, 'auth-session'],
  ] as const)('maps trusted AAL %s -> %s to %s', async (currentLevel, nextLevel, status) => {
    const { auth, coordinator, transitionAuthenticatedContext } = createHarness()
    jest.mocked(auth.getAuthenticatorAssuranceLevel).mockResolvedValue({
      data: { currentLevel, nextLevel },
      error: null,
    })
    await expect(coordinator.recoverTrustedUnauthorized()).resolves.toEqual({ status })
    expect(auth.getAuthenticatorAssuranceLevel).toHaveBeenCalledWith('token-a')
    expect(transitionAuthenticatedContext).not.toHaveBeenCalled()
  })

  it('never exposes provider errors or tokens in recovery results', async () => {
    const { auth, coordinator } = createHarness()
    jest.mocked(auth.getSession).mockRejectedValue({
      status: 503,
      message: 'secret token-a should not escape',
    })
    const result = await coordinator.recoverTrustedUnauthorized()
    expect(result).toEqual({ status: 'auth-session' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('token-a')
  })
})
