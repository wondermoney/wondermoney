import {
  SessionOperationCancelledError,
  createSessionOperationScope,
  createTransitionAuthenticatedContext,
  executeGuardedWrite,
  type AuthenticatedContextTransitionReason,
} from './session-operation-scope'

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('session operation scope', () => {
  it('captures an initially current lease and rotates generation before aborting it', () => {
    const scope = createSessionOperationScope()
    const oldLease = scope.capture()
    let generationObservedOnAbort: number | undefined

    expect(scope.isCurrent(oldLease)).toBe(true)
    oldLease.signal.addEventListener('abort', () => {
      generationObservedOnAbort = scope.capture().generation
    })

    scope.invalidate()
    const freshLease = scope.capture()

    expect(generationObservedOnAbort).toBe(oldLease.generation + 1)
    expect(oldLease.signal.aborted).toBe(true)
    expect(scope.isCurrent(oldLease)).toBe(false)
    expect(freshLease.generation).toBe(oldLease.generation + 1)
    expect(freshLease.signal).not.toBe(oldLease.signal)
    expect(freshLease.signal.aborted).toBe(false)
    expect(scope.isCurrent(freshLease)).toBe(true)
  })
})

describe('guarded session writes', () => {
  it('passes the exact captured signal and commits once', async () => {
    const scope = createSessionOperationScope()
    const lease = scope.capture()
    const operation = jest.fn(async (signal: AbortSignal) => {
      expect(signal).toBe(lease.signal)
      return 'saved'
    })
    const commit = jest.fn()

    await expect(executeGuardedWrite(scope, operation, commit)).resolves.toBe('saved')

    expect(operation).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('saved')
  })

  it('rejects an initially stale or aborted lease before starting transport', async () => {
    const controller = new AbortController()
    controller.abort()
    const operation = jest.fn(async () => 'saved')

    await expect(executeGuardedWrite({
      capture: () => ({ generation: 0, signal: controller.signal }),
      isCurrent: () => false,
      invalidate: () => undefined,
    }, operation, jest.fn())).rejects.toBeInstanceOf(SessionOperationCancelledError)
    expect(operation).not.toHaveBeenCalled()
  })

  it('suppresses commit when invalidated while transport is pending, even if transport resolves late', async () => {
    const scope = createSessionOperationScope()
    const pending = deferred<string>()
    const commit = jest.fn()
    const result = executeGuardedWrite(scope, () => pending.promise, commit)

    scope.invalidate()
    pending.resolve('late success')

    await expect(result).rejects.toMatchObject({ code: 'session-operation-cancelled' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('classifies post-invalidation rejection without retaining sensitive transport details', async () => {
    const scope = createSessionOperationScope()
    const pending = deferred<string>()
    const result = executeGuardedWrite(scope, () => pending.promise, jest.fn())
    const sensitiveError = {
      message: 'Bearer secret-token',
      body: { accessToken: 'secret-token' },
      platformErrorName: 'not-an-abort-error',
    }

    scope.invalidate()
    pending.reject(sensitiveError)

    const cancellation: unknown = await result.catch((error: unknown) => error)

    expect(cancellation).toBeInstanceOf(SessionOperationCancelledError)
    expect(cancellation).toMatchObject({
      code: 'session-operation-cancelled',
      name: 'SessionOperationCancelledError',
      message: 'Session operation was cancelled',
    })
    expect(cancellation).not.toHaveProperty('cause')
    expect(cancellation).not.toHaveProperty('originalError')
    expect(Object.keys(cancellation as object).sort()).toEqual(['code', 'name'])
    expect(JSON.stringify(cancellation)).not.toContain('secret-token')
    const ownPropertyValues = Object.getOwnPropertyNames(cancellation as object)
      .map((key) => String((cancellation as Record<string, unknown>)[key]))
      .join(' ')
    expect(ownPropertyValues).not.toContain('secret-token')
  })

  it('allows an operation captured from the new generation to succeed', async () => {
    const scope = createSessionOperationScope()
    scope.invalidate()
    const commit = jest.fn()

    await expect(executeGuardedWrite(scope, async () => 42, commit)).resolves.toBe(42)
    expect(commit).toHaveBeenCalledWith(42)
  })
})

describe('authenticated context transition', () => {
  const reasons: AuthenticatedContextTransitionReason[] = [
    'session-revoked',
    'logout',
    'account-deletion',
    'tenant-change',
    'mfa-required',
  ]

  it.each(reasons)('orders the %s transition after observer unmount confirmation', async (reason) => {
    const events: string[] = []
    const unmounted = deferred<void>()
    const scope = createSessionOperationScope()
    const transitionAuthenticatedContext = createTransitionAuthenticatedContext({
      scope: {
        ...scope,
        invalidate: () => {
          events.push('invalidate')
          scope.invalidate()
        },
      },
      deactivateAuthenticatedSubtree: (receivedReason) => {
        events.push(`deactivate:${receivedReason}`)
        return unmounted.promise
      },
      queryClient: {
        cancelQueries: async () => {
          events.push('cancel')
        },
        clear: () => events.push('clear'),
      },
    })

    const transition = transitionAuthenticatedContext(reason)
    expect(events).toEqual(['invalidate', `deactivate:${reason}`])

    unmounted.resolve()
    await transition

    expect(events).toEqual(['invalidate', `deactivate:${reason}`, 'cancel', 'clear'])
  })

  it('returns one promise to concurrent callers and uses the first reason for that flight', async () => {
    const unmounted = deferred<void>()
    const invalidate = jest.fn()
    const deactivateAuthenticatedSubtree = jest.fn(() => unmounted.promise)
    const cancelQueries = jest.fn(async () => undefined)
    const clear = jest.fn()
    const transitionAuthenticatedContext = createTransitionAuthenticatedContext({
      scope: { capture: jest.fn() as never, isCurrent: jest.fn() as never, invalidate },
      deactivateAuthenticatedSubtree,
      queryClient: { cancelQueries, clear },
    })

    const first = transitionAuthenticatedContext('logout')
    const concurrent = transitionAuthenticatedContext('tenant-change')
    expect(concurrent).toBe(first)

    unmounted.resolve()
    await first

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(deactivateAuthenticatedSubtree).toHaveBeenCalledTimes(1)
    expect(deactivateAuthenticatedSubtree).toHaveBeenCalledWith('logout')
    expect(cancelQueries).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('publishes the in-flight promise before side effects so synchronous reentrancy cannot duplicate them', async () => {
    const unmounted = deferred<void>()
    let reentrant: Promise<void> | undefined
    let transitionAuthenticatedContext!: ReturnType<typeof createTransitionAuthenticatedContext>
    const invalidate = jest.fn(() => {
      reentrant = transitionAuthenticatedContext('tenant-change')
    })
    const deactivateAuthenticatedSubtree = jest.fn(() => unmounted.promise)
    transitionAuthenticatedContext = createTransitionAuthenticatedContext({
      scope: { capture: jest.fn() as never, isCurrent: jest.fn() as never, invalidate },
      deactivateAuthenticatedSubtree,
      queryClient: { cancelQueries: async () => undefined, clear: jest.fn() },
    })

    const first = transitionAuthenticatedContext('logout')

    expect(reentrant).toBe(first)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(deactivateAuthenticatedSubtree).toHaveBeenCalledTimes(1)
    expect(deactivateAuthenticatedSubtree).toHaveBeenCalledWith('logout')

    unmounted.resolve()
    await first
  })

  it('propagates synchronous deactivation rejection and permits a later retry', async () => {
    const failure = new Error('deactivate failed')
    const invalidate = jest.fn()
    const deactivateAuthenticatedSubtree = jest.fn()
      .mockImplementationOnce(() => { throw failure })
      .mockResolvedValueOnce(undefined)
    const cancelQueries = jest.fn(async () => undefined)
    const clear = jest.fn()
    const transitionAuthenticatedContext = createTransitionAuthenticatedContext({
      scope: { capture: jest.fn() as never, isCurrent: jest.fn() as never, invalidate },
      deactivateAuthenticatedSubtree,
      queryClient: { cancelQueries, clear },
    })

    await expect(transitionAuthenticatedContext('tenant-change')).rejects.toBe(failure)
    await expect(transitionAuthenticatedContext('logout')).resolves.toBeUndefined()

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(deactivateAuthenticatedSubtree.mock.calls.map(([reason]) => reason)).toEqual([
      'tenant-change',
      'logout',
    ])
    expect(cancelQueries).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('propagates purge rejection after clearing and permits a later retry', async () => {
    const failure = new Error('cancel failed')
    const clear = jest.fn()
    const cancelQueries = jest.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const deactivateAuthenticatedSubtree = jest.fn(async () => undefined)
    const transitionAuthenticatedContext = createTransitionAuthenticatedContext({
      scope: createSessionOperationScope(),
      deactivateAuthenticatedSubtree,
      queryClient: { cancelQueries, clear },
    })

    await expect(transitionAuthenticatedContext('logout')).rejects.toBe(failure)
    await expect(transitionAuthenticatedContext('logout')).resolves.toBeUndefined()
    expect(deactivateAuthenticatedSubtree).toHaveBeenCalledTimes(2)
    expect(cancelQueries).toHaveBeenCalledTimes(2)
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it('runs sequential tenant-change and logout as two fully ordered transitions', async () => {
    const events: string[] = []
    const transitionAuthenticatedContext = createTransitionAuthenticatedContext({
      scope: {
        capture: jest.fn() as never,
        isCurrent: jest.fn() as never,
        invalidate: () => events.push('invalidate'),
      },
      deactivateAuthenticatedSubtree: async (reason) => {
        events.push(`deactivate:${reason}`)
        await Promise.resolve()
        events.push(`unmounted:${reason}`)
      },
      queryClient: {
        cancelQueries: async () => { events.push('cancel') },
        clear: () => events.push('clear'),
      },
    })

    await transitionAuthenticatedContext('tenant-change')
    await transitionAuthenticatedContext('logout')

    expect(events).toEqual([
      'invalidate',
      'deactivate:tenant-change',
      'unmounted:tenant-change',
      'cancel',
      'clear',
      'invalidate',
      'deactivate:logout',
      'unmounted:logout',
      'cancel',
      'clear',
    ])
  })

  it('lets an account-deletion commit join the in-flight transition without replaying the write', async () => {
    const scope = createSessionOperationScope()
    const operation = jest.fn(async () => ({ deleted: true }))
    const deactivateAuthenticatedSubtree = jest.fn(async () => undefined)
    const transitionAuthenticatedContext = createTransitionAuthenticatedContext({
      scope,
      deactivateAuthenticatedSubtree,
      queryClient: { cancelQueries: async () => undefined, clear: jest.fn() },
    })

    await executeGuardedWrite(scope, operation, () => {
      void transitionAuthenticatedContext('account-deletion')
    })
    await transitionAuthenticatedContext('account-deletion')

    expect(operation).toHaveBeenCalledTimes(1)
    expect(deactivateAuthenticatedSubtree).toHaveBeenCalledTimes(1)
    expect(deactivateAuthenticatedSubtree).toHaveBeenCalledWith('account-deletion')
  })
})
