import {
  purgeSensitiveState,
  type SensitiveStateQueryClient,
} from '../query/purge-sensitive-state'

export type SessionOperationLease = Readonly<{
  generation: number
  signal: AbortSignal
}>

export type SessionOperationScope = Readonly<{
  capture: () => SessionOperationLease
  isCurrent: (lease: SessionOperationLease) => boolean
  invalidate: () => void
}>

export const createSessionOperationScope = (): SessionOperationScope => {
  let generation = 0
  let controller = new AbortController()

  return {
    capture: () => ({ generation, signal: controller.signal }),
    isCurrent: (lease) => (
      lease.generation === generation
      && lease.signal === controller.signal
      && !lease.signal.aborted
    ),
    invalidate: () => {
      const oldController = controller
      generation += 1
      controller = new AbortController()
      oldController.abort()
    },
  }
}

/** A platform-independent cancellation that API clients can map by `code`. */
export class SessionOperationCancelledError extends Error {
  readonly code = 'session-operation-cancelled' as const

  constructor() {
    super('Session operation was cancelled')
    this.name = 'SessionOperationCancelledError'
  }
}

const assertCurrent = (
  scope: SessionOperationScope,
  lease: SessionOperationLease,
) => {
  if (lease.signal.aborted || !scope.isCurrent(lease)) {
    throw new SessionOperationCancelledError()
  }
}

/**
 * Runs one remote write and permits its synchronous success effect only while
 * the captured session generation remains current.
 */
export const executeGuardedWrite = async <Value>(
  scope: SessionOperationScope,
  operation: (signal: AbortSignal) => Promise<Value>,
  commit: (value: Value) => void,
): Promise<Value> => {
  const lease = scope.capture()
  assertCurrent(scope, lease)

  let value: Value
  try {
    value = await operation(lease.signal)
  } catch (error: unknown) {
    assertCurrent(scope, lease)
    throw error
  }

  // Recheck the awaited boundary immediately beside the synchronous effect.
  assertCurrent(scope, lease)
  commit(value)
  return value
}

export type AuthenticatedContextTransitionReason =
  | 'session-revoked'
  | 'logout'
  | 'account-deletion'
  | 'tenant-change'
  | 'mfa-required'

export type TransitionAuthenticatedContext = (
  reason: AuthenticatedContextTransitionReason,
) => Promise<void>

export type AuthenticatedContextTransitionDependencies = Readonly<{
  scope: SessionOperationScope
  /** Must synchronously hide/deactivate the subtree and resolve after observers unmount. */
  deactivateAuthenticatedSubtree: (
    reason: AuthenticatedContextTransitionReason,
  ) => Promise<void>
  queryClient: SensitiveStateQueryClient
}>

/**
 * Creates a per-provider transition boundary. The first reason wins while a
 * transition is in flight; after settlement a fresh context epoch can start
 * another transition.
 */
export const createTransitionAuthenticatedContext = (
  dependencies: AuthenticatedContextTransitionDependencies,
): TransitionAuthenticatedContext => {
  let inFlight: Promise<void> | undefined

  return (reason) => {
    if (inFlight) {
      return inFlight
    }

    let resolveFlight!: () => void
    let rejectFlight!: (error: unknown) => void
    const flight = new Promise<void>((resolve, reject) => {
      resolveFlight = resolve
      rejectFlight = reject
    })

    // Publish before any side effect: invalidate/deactivate may synchronously
    // reenter this boundary and must observe this exact flight.
    inFlight = flight

    const run = async () => {
      try {
        dependencies.scope.invalidate()
        const observersUnmounted = dependencies.deactivateAuthenticatedSubtree(reason)
        await observersUnmounted
        await purgeSensitiveState(dependencies.queryClient)
        resolveFlight()
      } catch (error: unknown) {
        rejectFlight(error)
      } finally {
        if (inFlight === flight) {
          inFlight = undefined
        }
      }
    }

    void run()
    return flight
  }
}
