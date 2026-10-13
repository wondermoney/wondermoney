export type AuthErrorClassification = 'invalid-session' | 'transient'

export type AuthRecoverySession = {
  accessToken: string
}

export type AuthSessionResult<Session extends AuthRecoverySession> = {
  data: { session: Session | null }
  error: unknown | null
}

export type AuthenticatorAssuranceLevelResult = {
  data: {
    currentLevel: string | null
    nextLevel: string | null
  }
  error: unknown | null
}

export type AuthRecoveryPort<
  Session extends AuthRecoverySession = AuthRecoverySession,
> = {
  getSession: () => Promise<AuthSessionResult<Session>>
  refreshSession: () => Promise<AuthSessionResult<Session>>
  getAuthenticatorAssuranceLevel: (
    accessToken: string,
  ) => Promise<AuthenticatorAssuranceLevelResult>
  classifyAuthError: (error: unknown) => AuthErrorClassification
}

export type TokenSnapshot = {
  accessToken: string
  tokenGeneration: number
}

export type TokenSnapshotResult =
  | { status: 'available'; snapshot: TokenSnapshot }
  | { status: 'unavailable' }

export type TrustedUnauthorizedRecoveryResult =
  | { status: 'session-revoked' }
  | { status: 'mfa-required' }
  | { status: 'auth-session' }

type AuthRecoveryDependencies<Session extends AuthRecoverySession> = {
  auth: AuthRecoveryPort<Session>
  transitionAuthenticatedContext: (
    reason: 'session-revoked',
  ) => Promise<void>
}

export function createAuthRecoveryCoordinator<
  Session extends AuthRecoverySession = AuthRecoverySession,
>({ auth, transitionAuthenticatedContext }: AuthRecoveryDependencies<Session>) {
  let currentAccessToken: string | null = null
  let tokenGeneration = 0
  let hasObservedToken = false
  const refreshFlights = new Map<number, Promise<TokenSnapshotResult>>()
  let authEpoch = 0
  let lifecycle: 'active' | 'revoking' | 'revoked' = 'active'
  let revokedTransition: Promise<TrustedUnauthorizedRecoveryResult> | null = null

  const classify = (error: unknown): AuthErrorClassification => {
    try {
      return auth.classifyAuthError(error)
    } catch {
      return 'transient'
    }
  }

  const observeSession = (session: Session): TokenSnapshot => {
    if (!hasObservedToken) {
      hasObservedToken = true
      currentAccessToken = session.accessToken
    } else if (currentAccessToken !== session.accessToken) {
      currentAccessToken = session.accessToken
      tokenGeneration += 1
    }

    return {
      accessToken: session.accessToken,
      tokenGeneration,
    }
  }

  const unavailable: TokenSnapshotResult = { status: 'unavailable' }

  const isActiveEpoch = (capturedEpoch: number): boolean => (
    lifecycle === 'active' && capturedEpoch === authEpoch
  )

  const currentSnapshot = (): TokenSnapshotResult => (
    lifecycle === 'active' && hasObservedToken && currentAccessToken !== null
      ? {
          status: 'available',
          snapshot: { accessToken: currentAccessToken, tokenGeneration },
        }
      : unavailable
  )

  const getTokenSnapshot = async (): Promise<TokenSnapshotResult> => {
    if (lifecycle !== 'active') return unavailable
    const capturedEpoch = authEpoch
    try {
      const result = await auth.getSession()
      if (!isActiveEpoch(capturedEpoch)) return unavailable
      if (result.error || !result.data.session) return unavailable
      return { status: 'available', snapshot: observeSession(result.data.session) }
    } catch {
      return unavailable
    }
  }

  const transitionRevoked = async (): Promise<TrustedUnauthorizedRecoveryResult> => {
    if (lifecycle === 'revoked') return { status: 'session-revoked' }
    if (revokedTransition) return revokedTransition

    if (lifecycle === 'active') {
      lifecycle = 'revoking'
      authEpoch += 1
      currentAccessToken = null
      hasObservedToken = false
      refreshFlights.clear()
    }

    const transition = (async (): Promise<TrustedUnauthorizedRecoveryResult> => {
      try {
        await transitionAuthenticatedContext('session-revoked')
        lifecycle = 'revoked'
        return { status: 'session-revoked' }
      } catch {
        // This local status is intentionally sanitized; transition errors are never retained.
        return { status: 'auth-session' }
      }
    })()
    revokedTransition = transition
    try {
      return await transition
    } finally {
      if (revokedTransition === transition) revokedTransition = null
    }
  }

  const recoverInvalidOrTransient = (
    error: unknown,
  ): Promise<TrustedUnauthorizedRecoveryResult> | TrustedUnauthorizedRecoveryResult => (
    classify(error) === 'invalid-session'
      ? transitionRevoked()
      : { status: 'auth-session' }
  )

  const runRefresh = async (
    failedSnapshot: TokenSnapshot,
    capturedEpoch: number,
  ): Promise<TokenSnapshotResult> => {
    try {
      const result = await auth.refreshSession()
      if (
        !isActiveEpoch(capturedEpoch)
        || tokenGeneration !== failedSnapshot.tokenGeneration
      ) {
        return currentSnapshot()
      }
      if (result.error) {
        if (classify(result.error) === 'invalid-session') await transitionRevoked()
        return unavailable
      }
      if (!result.data.session) {
        await transitionRevoked()
        return unavailable
      }

      currentAccessToken = result.data.session.accessToken
      hasObservedToken = true
      tokenGeneration += 1
      return {
        status: 'available',
        snapshot: {
          accessToken: result.data.session.accessToken,
          tokenGeneration,
        },
      }
    } catch (error) {
      if (
        !isActiveEpoch(capturedEpoch)
        || tokenGeneration !== failedSnapshot.tokenGeneration
      ) {
        return currentSnapshot()
      }
      if (classify(error) === 'invalid-session') await transitionRevoked()
      return unavailable
    }
  }

  const performRefreshAfterUnauthorized = async (
    failedSnapshot: TokenSnapshot,
  ): Promise<TokenSnapshotResult> => {
    const inspected = await getTokenSnapshot()
    if (lifecycle !== 'active') return unavailable
    if (
      inspected.status === 'available' &&
      (inspected.snapshot.tokenGeneration > failedSnapshot.tokenGeneration ||
        inspected.snapshot.accessToken !== failedSnapshot.accessToken)
    ) {
      return inspected
    }

    if (
      hasObservedToken &&
      currentAccessToken !== null &&
      tokenGeneration > failedSnapshot.tokenGeneration
    ) {
      return {
        status: 'available',
        snapshot: { accessToken: currentAccessToken, tokenGeneration },
      }
    }

    const capturedEpoch = authEpoch
    return runRefresh(failedSnapshot, capturedEpoch)
  }

  const refreshAfterUnauthorized = (
    failedSnapshot: TokenSnapshot,
  ): Promise<TokenSnapshotResult> => {
    if (lifecycle !== 'active') return Promise.resolve(unavailable)
    const existing = refreshFlights.get(failedSnapshot.tokenGeneration)
    if (existing) return existing

    let flight!: Promise<TokenSnapshotResult>
    flight = performRefreshAfterUnauthorized(failedSnapshot).finally(() => {
      if (refreshFlights.get(failedSnapshot.tokenGeneration) === flight) {
        refreshFlights.delete(failedSnapshot.tokenGeneration)
      }
    })
    refreshFlights.set(failedSnapshot.tokenGeneration, flight)
    return flight
  }

  const recoverTrustedUnauthorized = async (): Promise<TrustedUnauthorizedRecoveryResult> => {
    // Successful revocation is terminal for this instance. A new authenticated auth epoch
    // must construct a fresh coordinator rather than reusing cached provider session state.
    if (lifecycle === 'revoked' || lifecycle === 'revoking') return transitionRevoked()
    const capturedEpoch = authEpoch

    let sessionResult: AuthSessionResult<Session>
    try {
      sessionResult = await auth.getSession()
      if (!isActiveEpoch(capturedEpoch)) return transitionRevoked()
    } catch (error) {
      if (!isActiveEpoch(capturedEpoch)) return transitionRevoked()
      return recoverInvalidOrTransient(error)
    }

    if (sessionResult.error) {
      return recoverInvalidOrTransient(sessionResult.error)
    }
    if (!sessionResult.data.session) return transitionRevoked()

    let assuranceResult: AuthenticatorAssuranceLevelResult
    try {
      assuranceResult = await auth.getAuthenticatorAssuranceLevel(
        sessionResult.data.session.accessToken,
      )
      if (!isActiveEpoch(capturedEpoch)) return transitionRevoked()
    } catch (error) {
      if (!isActiveEpoch(capturedEpoch)) return transitionRevoked()
      return recoverInvalidOrTransient(error)
    }

    if (assuranceResult.error) {
      return recoverInvalidOrTransient(assuranceResult.error)
    }

    return assuranceResult.data.currentLevel === 'aal1' &&
      assuranceResult.data.nextLevel === 'aal2'
      ? { status: 'mfa-required' }
      : { status: 'auth-session' }
  }

  return {
    getTokenSnapshot,
    refreshAfterUnauthorized,
    recoverTrustedUnauthorized,
  }
}
