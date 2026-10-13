export type AuthSessionPort<Session> = {
  getSession: () => Promise<{
    data: { session: Session | null }
    error: unknown | null
  }>
  onAuthStateChange: (
    callback: (event: string, session: Session | null) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } }
  startAutoRefresh: () => Promise<void>
  stopAutoRefresh: () => Promise<void>
}

export type AppStatePort = {
  currentState: string | null
  addEventListener: (
    event: 'change',
    callback: (state: string) => void,
  ) => { remove: () => void }
}

export type SessionLifecycleState<Session> =
  | { status: 'loading' }
  | { status: 'ready'; session: Session | null }
  | { status: 'recoverable-error' }
  | { status: 'disposed' }

type SessionLifecycleDependencies<Session> = {
  auth: AuthSessionPort<Session>
  appState: AppStatePort
}

export function createSessionLifecycle<Session>({
  auth,
  appState,
}: SessionLifecycleDependencies<Session>) {
  let state: SessionLifecycleState<Session> = { status: 'loading' }
  let disposed = false
  let authVersion = 0
  let desiredRefresh = false
  let refreshRunning = false
  let refreshQueue = Promise.resolve()
  let startPromise: Promise<void> | null = null
  let disposePromise: Promise<void> | null = null
  let authSubscription: { unsubscribe: () => void } | null = null
  let appStateSubscription: { remove: () => void } | null = null
  const stateListeners = new Set<(next: SessionLifecycleState<Session>) => void>()

  const setState = (next: SessionLifecycleState<Session>) => {
    state = next
    stateListeners.forEach((listener) => {
      try {
        listener(next)
      } catch {
        // Consumer failures must not interrupt auth cleanup or refresh ownership.
      }
    })
  }

  const reconcileRefresh = async () => {
    const shouldRun = !disposed && desiredRefresh

    if (shouldRun && !refreshRunning) {
      try {
        await auth.startAutoRefresh()
        refreshRunning = true
      } catch {
        desiredRefresh = false
        refreshRunning = false
        await auth.stopAutoRefresh().catch(() => undefined)
        throw new Error('Session refresh unavailable')
      }
    } else if (!shouldRun && refreshRunning) {
      await auth.stopAutoRefresh()
      refreshRunning = false
    }

    if ((!disposed && desiredRefresh) !== refreshRunning) {
      await reconcileRefresh()
    }
  }

  const scheduleRefresh = (nextAppState: string | null) => {
    desiredRefresh = !disposed && nextAppState === 'active'
    const operation = refreshQueue.then(reconcileRefresh)
    refreshQueue = operation.catch(() => undefined)
    return operation
  }

  const handleAppState = (nextAppState: string) => {
    void scheduleRefresh(nextAppState).catch(() => {
      if (!disposed) setState({ status: 'recoverable-error' })
    })
  }

  const cleanSubscriptions = () => {
    authSubscription?.unsubscribe()
    authSubscription = null
    appStateSubscription?.remove()
    appStateSubscription = null
  }

  const startOnce = async () => {
    if (disposed) return

    const bootstrapVersion = authVersion

    try {
      authSubscription = auth.onAuthStateChange((event, session) => {
        if (disposed || event === 'INITIAL_SESSION') return
        authVersion += 1
        setState({ status: 'ready', session })
      }).data.subscription

      appStateSubscription = appState.addEventListener('change', handleAppState)
      await scheduleRefresh(appState.currentState)

      const result = await auth.getSession()
      if (disposed || authVersion !== bootstrapVersion) return

      setState(
        result.error
          ? { status: 'recoverable-error' }
          : { status: 'ready', session: result.data.session },
      )
    } catch {
      if (disposed || authVersion !== bootstrapVersion) return
      cleanSubscriptions()
      await scheduleRefresh('inactive').catch(() => undefined)
      if (disposed || authVersion !== bootstrapVersion) return
      setState({ status: 'recoverable-error' })
    }
  }

  const start = () => {
    startPromise ??= startOnce()
    return startPromise
  }

  const disposeOnce = async () => {
    if (disposed) return
    disposed = true
    cleanSubscriptions()
    setState({ status: 'disposed' })
    stateListeners.clear()
    await scheduleRefresh('inactive').catch(() => undefined)
  }

  const dispose = () => {
    disposePromise ??= disposeOnce()
    return disposePromise
  }

  const subscribe = (listener: (next: SessionLifecycleState<Session>) => void) => {
    stateListeners.add(listener)
    return () => stateListeners.delete(listener)
  }

  return {
    get state() {
      return state
    },
    start,
    dispose,
    subscribe,
    whenIdle: () => refreshQueue,
  }
}
