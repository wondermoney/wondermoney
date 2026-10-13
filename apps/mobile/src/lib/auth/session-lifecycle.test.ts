import {
  createSessionLifecycle,
  type AppStatePort,
  type AuthSessionPort,
} from './session-lifecycle'

type Session = { opaqueId: string }

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

const createHarness = () => {
  const authListeners: ((event: string, session: Session | null) => void)[] = []
  const appStateListeners: ((state: string) => void)[] = []
  const unsubscribe = jest.fn()
  const removeAppStateListener = jest.fn()

  const auth: AuthSessionPort<Session> = {
    getSession: jest.fn(),
    onAuthStateChange: jest.fn((callback) => {
      authListeners.push(callback)
      return { data: { subscription: { unsubscribe } } }
    }),
    startAutoRefresh: jest.fn().mockResolvedValue(undefined),
    stopAutoRefresh: jest.fn().mockResolvedValue(undefined),
  }

  const appState: AppStatePort = {
    currentState: 'inactive',
    addEventListener: jest.fn((_event, callback) => {
      appStateListeners.push(callback)
      return { remove: removeAppStateListener }
    }),
  }

  return {
    auth,
    appState,
    authListeners,
    appStateListeners,
    unsubscribe,
    removeAppStateListener,
  }
}

describe('session lifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('bootstraps from loading to a ready session and installs listeners once', async () => {
    const harness = createHarness()
    const session = { opaqueId: 'session-a' }
    jest.mocked(harness.auth.getSession).mockResolvedValue({ data: { session }, error: null })

    const lifecycle = createSessionLifecycle(harness)
    expect(lifecycle.state).toEqual({ status: 'loading' })

    const first = lifecycle.start()
    const second = lifecycle.start()
    await Promise.all([first, second])

    expect(lifecycle.state).toEqual({ status: 'ready', session })
    expect(harness.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
    expect(harness.appState.addEventListener).toHaveBeenCalledTimes(1)
    expect(harness.auth.getSession).toHaveBeenCalledTimes(1)
    expect(harness.auth.stopAutoRefresh).not.toHaveBeenCalled()
  })

  it('represents a resolved getSession error as recoverable without logging or purging', async () => {
    const harness = createHarness()
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.mocked(harness.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: new Error('sensitive native message'),
    })

    const lifecycle = createSessionLifecycle(harness)
    await lifecycle.start()

    expect(lifecycle.state).toEqual({ status: 'recoverable-error' })
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('sanitizes a rejected getSession bootstrap as recoverable', async () => {
    const harness = createHarness()
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.mocked(harness.auth.getSession).mockRejectedValue(new Error('sensitive rejection'))

    const lifecycle = createSessionLifecycle(harness)
    await lifecycle.start()

    expect(lifecycle.state).toEqual({ status: 'recoverable-error' })
    expect(error).not.toHaveBeenCalled()
  })

  it('updates from auth events and follows current and changed AppState', async () => {
    const harness = createHarness()
    harness.appState.currentState = 'active'
    jest.mocked(harness.auth.getSession).mockResolvedValue({ data: { session: null }, error: null })
    const lifecycle = createSessionLifecycle(harness)

    await lifecycle.start()
    await lifecycle.whenIdle()
    expect(harness.auth.startAutoRefresh).toHaveBeenCalledTimes(1)

    const session = { opaqueId: 'session-b' }
    harness.authListeners[0]?.('SIGNED_IN', session)
    expect(lifecycle.state).toEqual({ status: 'ready', session })

    harness.appStateListeners[0]?.('background')
    await lifecycle.whenIdle()
    expect(harness.auth.stopAutoRefresh).toHaveBeenCalledTimes(1)
    harness.appStateListeners[0]?.('active')
    await lifecycle.whenIdle()
    expect(harness.auth.startAutoRefresh).toHaveBeenCalledTimes(2)
  })

  it('sanitizes refresh ownership failures as recoverable', async () => {
    const harness = createHarness()
    harness.appState.currentState = 'active'
    jest.mocked(harness.auth.getSession).mockResolvedValue({ data: { session: null }, error: null })
    jest.mocked(harness.auth.startAutoRefresh).mockRejectedValue(new Error('refresh secret'))
    const lifecycle = createSessionLifecycle(harness)

    await lifecycle.start()

    expect(lifecycle.state).toEqual({ status: 'recoverable-error' })
    expect(harness.auth.stopAutoRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps bootstrap errors recoverable when INITIAL_SESSION emits null', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{
      data: { session: Session | null }
      error: unknown | null
    }>()
    jest.mocked(harness.auth.getSession).mockReturnValue(deferred.promise)
    const lifecycle = createSessionLifecycle(harness)
    const start = lifecycle.start()

    harness.authListeners[0]?.('INITIAL_SESSION', null)
    deferred.resolve({ data: { session: null }, error: new Error('bootstrap failed') })
    await start

    expect(lifecycle.state).toEqual({ status: 'recoverable-error' })
  })

  it('notifies subscribers when auth state changes', async () => {
    const harness = createHarness()
    jest.mocked(harness.auth.getSession).mockResolvedValue({ data: { session: null }, error: null })
    const lifecycle = createSessionLifecycle(harness)
    const observed: string[] = []
    const unsubscribeState = lifecycle.subscribe((next) => observed.push(next.status))

    await lifecycle.start()
    harness.authListeners[0]?.('SIGNED_IN', { opaqueId: 'observable' })
    unsubscribeState()
    harness.authListeners[0]?.('SIGNED_OUT', null)

    expect(observed).toEqual(['ready', 'ready'])
  })

  it('serializes rapid active/background refresh transitions', async () => {
    const harness = createHarness()
    const startRefresh = createDeferred<void>()
    const order: string[] = []
    jest.mocked(harness.auth.getSession).mockResolvedValue({ data: { session: null }, error: null })
    jest.mocked(harness.auth.startAutoRefresh).mockImplementation(async () => {
      order.push('start:begin')
      await startRefresh.promise
      order.push('start:end')
    })
    jest.mocked(harness.auth.stopAutoRefresh).mockImplementation(async () => {
      order.push('stop')
    })
    const lifecycle = createSessionLifecycle(harness)
    await lifecycle.start()

    harness.appStateListeners[0]?.('active')
    await Promise.resolve()
    harness.appStateListeners[0]?.('background')
    startRefresh.resolve()
    await lifecycle.dispose()

    expect(order).toEqual(['start:begin', 'start:end', 'stop'])
  })

  it('does not let a late bootstrap overwrite a newer auth event', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{
      data: { session: Session | null }
      error: unknown | null
    }>()
    jest.mocked(harness.auth.getSession).mockReturnValue(deferred.promise)
    const lifecycle = createSessionLifecycle(harness)
    const start = lifecycle.start()

    const current = { opaqueId: 'newer-session' }
    harness.authListeners[0]?.('TOKEN_REFRESHED', current)
    deferred.resolve({ data: { session: { opaqueId: 'stale-session' } }, error: null })
    await start

    expect(lifecycle.state).toEqual({ status: 'ready', session: current })
  })

  it('does not let a rejected bootstrap overwrite a newer auth event', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{
      data: { session: Session | null }
      error: unknown | null
    }>()
    jest.mocked(harness.auth.getSession).mockReturnValue(deferred.promise)
    const lifecycle = createSessionLifecycle(harness)
    const start = lifecycle.start()

    const current = { opaqueId: 'newer-session' }
    harness.authListeners[0]?.('TOKEN_REFRESHED', current)
    deferred.reject(new Error('stale bootstrap rejection'))
    await start

    expect(lifecycle.state).toEqual({ status: 'ready', session: current })
    expect(harness.unsubscribe).not.toHaveBeenCalled()
  })

  it('completes active disposal when a state subscriber throws', async () => {
    const harness = createHarness()
    harness.appState.currentState = 'active'
    jest.mocked(harness.auth.getSession).mockResolvedValue({ data: { session: null }, error: null })
    const lifecycle = createSessionLifecycle(harness)
    await lifecycle.start()
    lifecycle.subscribe(() => {
      throw new Error('consumer failure')
    })

    await expect(lifecycle.dispose()).resolves.toBeUndefined()

    expect(lifecycle.state).toEqual({ status: 'disposed' })
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
    expect(harness.removeAppStateListener).toHaveBeenCalledTimes(1)
    expect(harness.auth.stopAutoRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps disposed state when refresh cleanup settles after disposal', async () => {
    const harness = createHarness()
    harness.appState.currentState = 'active'
    const stopStarted = createDeferred<void>()
    const stopRefresh = createDeferred<void>()
    jest.mocked(harness.auth.getSession).mockRejectedValue(new Error('bootstrap failure'))
    jest.mocked(harness.auth.stopAutoRefresh).mockImplementation(() => {
      stopStarted.resolve()
      return stopRefresh.promise
    })
    const lifecycle = createSessionLifecycle(harness)
    const start = lifecycle.start()

    await stopStarted.promise
    const dispose = lifecycle.dispose()
    stopRefresh.resolve()
    await Promise.all([start, dispose])

    expect(lifecycle.state).toEqual({ status: 'disposed' })
  })

  it('disposes subscriptions idempotently and ignores late bootstrap and callbacks', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{
      data: { session: Session | null }
      error: unknown | null
    }>()
    jest.mocked(harness.auth.getSession).mockReturnValue(deferred.promise)
    const lifecycle = createSessionLifecycle(harness)
    const start = lifecycle.start()

    const firstDispose = lifecycle.dispose()
    const secondDispose = lifecycle.dispose()
    harness.authListeners[0]?.('SIGNED_IN', { opaqueId: 'ignored' })
    harness.appStateListeners[0]?.('active')
    deferred.resolve({ data: { session: { opaqueId: 'late' } }, error: null })
    await Promise.all([start, firstDispose, secondDispose])

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
    expect(harness.removeAppStateListener).toHaveBeenCalledTimes(1)
    expect(harness.auth.stopAutoRefresh).not.toHaveBeenCalled()
    expect(harness.auth.startAutoRefresh).not.toHaveBeenCalled()
    expect(lifecycle.state).toEqual({ status: 'disposed' })
  })
})
