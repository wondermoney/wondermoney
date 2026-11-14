import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { ApiClient, HttpTransport } from '@/lib/api/client'
import { createApiClient } from '@/lib/api/client'
import { createImageAuthorization } from '@/lib/api/image-authorization'
import { createAuthRecoveryCoordinator } from '@/lib/auth/auth-recovery'
import { validateHouseholdInviteToken, type ValidateInviteOutcome } from '@/lib/auth/household-invite-validation'
import { takePendingInviteToken } from '@/lib/auth/invite-token-store'
import { provisionAppUser } from '@/lib/auth/provision-app-user'
import { resolveSignupLocale, type SignupLocale, toSignupLocale } from '@/lib/auth/resolve-signup-locale'
import { securePushTokenStore } from '@/lib/push/push-token-store'
import { unregisterPushDevice } from '@/lib/push/push-sign-out'
import {
  createSessionOperationScope,
  createTransitionAuthenticatedContext,
  type AuthenticatedContextTransitionReason,
  type SessionOperationScope,
} from '@/lib/auth/session-operation-scope'
import type { NativeIdentityProviderId } from '@/lib/auth/native-identity'
import {
  OIDC_PROVIDER_ID,
  type AppAuthAdapter,
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
  type SendVerificationEmailOutcome,
  type SignInOutcome,
  type SignUpOutcome,
} from '@/lib/auth/app-auth'

import { useAppSession } from './app-session-context'
import { useOptionalSessionPreferences } from './session-preferences-provider'

export type AuthEpochId = number & { readonly __authEpoch: unique symbol }
export type ProductRuntime = Readonly<{
  epochId: AuthEpochId
  principalId: string
  apiClient: ApiClient
  /**
   * The `Authorization` header value for an image the API itself serves (the merchant logo
   * proxy), or null without a session. Only `lib/api/api-image-source` reads it, and only for a
   * URL on the API's own origin. Optional so a test runtime can leave it out.
   */
  imageAuthorization?: () => Promise<string | null>
}>

export type ProductRouteState =
  | { status: 'signed-out' }
  | { status: 'activating' }
  | { status: 'authenticated' }
  | { status: 'deactivating' }
  | { status: 'mfa-required' }
  | { status: 'sign-out-failed' }

export type ProductRuntimeContextValue = Readonly<{
  routeState: ProductRouteState
  runtime: ProductRuntime | null
  signInWithPassword: (email: string, password: string) => Promise<SignInOutcome>
  /**
   * Native Apple/Google sign-in. Same admission rules as password sign-in:
   * refused while a terminal transition is in flight, and it re-arms activation so the
   * session the exchange establishes is picked up. The token and nonce are passed
   * straight through to the auth adapter and never logged.
   */
  signInWithIdToken: (
    provider: NativeIdentityProviderId,
    token: string,
    nonce: string,
  ) => Promise<IdTokenSignInOutcome>
  /** "Sign in with <name>" through the server's identity provider; same admission rules. */
  signInWithSso: () => Promise<BrowserSignInOutcome>
  /** "Sign in with a passkey"; same admission rules. A passkey sign-in is a full session. */
  signInWithPasskey: () => Promise<PasskeySignInOutcome>
  signUp: (email: string, password: string) => Promise<SignUpOutcome>
  signOut: () => Promise<void>
  retrySignOut: () => Promise<void>
  blockAccess: (reason: 'mfa-required') => void
  registerAuthenticatedBoundary: () => Readonly<{
    unregisterLayout: () => void
    completePassiveUnmount: () => void
  }>
  acknowledgeDeactivation: () => void
  activationError: 'provision-failed' | null
  clearActivationError: () => void
  /** Thin proxies to the injected auth adapter's MFA operations; usable in any route state. */
  mfaEnrollTotp: () => Promise<MfaTotpEnrollOutcome>
  mfaChallenge: (factorId: string) => Promise<MfaChallengeOutcome>
  mfaVerify: (factorId: string, challengeId: string, code: string) => Promise<MfaVerifyOutcome>
  mfaUnenroll: (factorId: string) => Promise<MfaUnenrollOutcome>
  mfaListFactors: () => Promise<MfaListFactorsOutcome>
  /** Thin proxy to the injected auth adapter's password-change operation; usable in any route state. */
  changePassword: (email: string, currentPassword: string, newPassword: string) => Promise<ChangePasswordOutcome>
  /** Thin proxies to the injected auth adapter's passkey management (Settings, Security). */
  listPasskeys: () => Promise<PasskeyListOutcome>
  addPasskey: () => Promise<PasskeyAddOutcome>
  deletePasskey: (id: string) => Promise<PasskeyDeleteOutcome>
  /** Thin proxy to the injected auth adapter's resend-verification-email operation. */
  sendVerificationEmail: (email: string) => Promise<SendVerificationEmailOutcome>
  /**
   * Public, pre-signup household-invite validation. Calls the raw transport
   * directly — there is no session yet to authenticate an ApiClient with. Usable in any
   * route state, same as the MFA/password proxies above.
   */
  validateHouseholdInvite: (token: string) => Promise<ValidateInviteOutcome>
  /**
   * Resumes from `mfa-required` back to `authenticated` after the caller has already
   * verified an MFA step-up challenge with the same auth adapter (so the underlying
   * better-auth session is already established). Re-fetches the session and re-runs the
   * normal activation pipeline (including app-user provisioning), the same as any
   * other fresh activation. A no-op outside `mfa-required`.
   */
  completeMfaVerification: () => Promise<void>
}>

type TerminalTransitionReason = 'session-revoked' | 'logout' | 'mfa-required'

const ProductRuntimeContext = createContext<ProductRuntimeContextValue | null>(null)

async function cancelThenClearQueryClient(queryClient: QueryClient): Promise<void> {
  try {
    await queryClient.cancelQueries()
  } finally {
    try {
      queryClient.clear()
    } catch {
      // Unmount cleanup is fail-closed and must never create an unhandled rejection.
    }
  }
}

/**
 * The runtime when one is mounted, `null` otherwise. For shell chrome (the top
 * bar's person menu) that renders above every screen, including in tests and
 * states where no runtime provider exists; screens use `useProductRuntime`.
 */
export function useOptionalProductRuntime() {
  return useContext(ProductRuntimeContext)
}

export function useProductRuntime() {
  const value = useContext(ProductRuntimeContext)
  if (!value) throw new Error('useProductRuntime must be used within ProductRuntimeProvider')
  return value
}

export type ProductRuntimeProviderProps = Readonly<{
  auth: AppAuthAdapter
  transport: HttpTransport
  children: ReactNode
  operationScope?: SessionOperationScope
  /** Runs before a sign-out tears the session down, while the API still accepts it (push device removal). */
  beforeSignOut?: (runtime: ProductRuntime) => Promise<void>
  createRuntime?: (input: {
    epochId: AuthEpochId
    principalId: string
    auth: AppAuthAdapter
    transport: HttpTransport
    operationScope: SessionOperationScope
    transition: (reason: AuthenticatedContextTransitionReason) => Promise<void>
  }) => ProductRuntime
}>

export const createDefaultProductRuntime: NonNullable<ProductRuntimeProviderProps['createRuntime']> = (input) => {
  // Revocation starts the provider transition synchronously. It deliberately does not
  // await query cancellation from inside a query that may itself be cancelled.
  const authRecovery = createAuthRecoveryCoordinator({
    auth: input.auth,
    transitionAuthenticatedContext: (reason) => {
      void input.transition(reason)
      return Promise.resolve()
    },
  })
  return {
    epochId: input.epochId,
    principalId: input.principalId,
    apiClient: createApiClient({
      transport: input.transport,
      authRecovery,
      operationScope: input.operationScope,
    }),
    imageAuthorization: createImageAuthorization(() => authRecovery.getTokenSnapshot()),
  }
}

/** Signing out removes this phone's push token from the account first (`lib/push/push-sign-out.ts`). */
const defaultBeforeSignOut = (runtime: ProductRuntime) => unregisterPushDevice({ api: runtime.apiClient, store: securePushTokenStore })

export function ProductRuntimeProvider({
  auth,
  transport,
  children,
  operationScope: injectedScope,
  beforeSignOut = defaultBeforeSignOut,
  createRuntime = createDefaultProductRuntime,
}: ProductRuntimeProviderProps) {
  const { session } = useAppSession<AuthSession>()
  const queryClient = useQueryClient()
  const [scope] = useState(() => injectedScope ?? createSessionOperationScope())
  const [routeState, setRouteState] = useState<ProductRouteState>({ status: 'signed-out' })
  const [runtime, setRuntime] = useState<ProductRuntime | null>(null)
  const [activationError, setActivationError] = useState<'provision-failed' | null>(null)
  const runtimeRef = useRef<ProductRuntime | null>(null)
  const epochCounter = useRef(0)
  const boundaryCount = useRef(0)
  const committedBoundaryCount = useRef(0)
  const deactivationAck = useRef<(() => void) | null>(null)
  const terminalFlight = useRef<Promise<void> | null>(null)
  const terminalLocked = useRef(false)
  const retirementFlight = useRef<Promise<void> | null>(null)
  const activationVersion = useRef(0)
  // The app language a new account is recorded in (`/v1/auth/callback`) and its first email is
  // sent in (`signUp`). Read when they run, so a language change rebuilds neither; the device
  // language stands in only where no preferences are mounted.
  const appLocale = useOptionalSessionPreferences()?.resolvedLocale ?? null
  const signupLocale = useRef<SignupLocale>('en')
  useEffect(() => {
    signupLocale.current = appLocale ? toSignupLocale(appLocale) : resolveSignupLocale()
  }, [appLocale])

  const deactivate = useCallback((reason: AuthenticatedContextTransitionReason) => {
    runtimeRef.current = null
    setRuntime(null)
    setRouteState({ status: 'deactivating' })
    // A committed boundary remains present until its passive unmount cleanup.
    // Its layout cleanup may already have run, so active layout registrations
    // alone cannot safely select the immediate path.
    if (committedBoundaryCount.current === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      deactivationAck.current = resolve
    })
  }, [])

  // The factory stores this callback for event-time use; it does not invoke it during render.
  // eslint-disable-next-line react-hooks/refs
  const transition = useMemo(() => createTransitionAuthenticatedContext({
    scope,
    queryClient,
    deactivateAuthenticatedSubtree: deactivate,
  }), [deactivate, queryClient, scope])

  const beginTerminalTransition = useCallback((reason: TerminalTransitionReason): Promise<void> => {
    if (terminalFlight.current) return terminalFlight.current
    terminalLocked.current = true
    let resolveFlight!: () => void
    const flight = new Promise<void>((resolve) => { resolveFlight = resolve })
    // Publish before transition invalidation/deactivation, which may synchronously
    // reenter through auth/query observers.
    terminalFlight.current = flight
    const run = async () => {
      const signingOut = reason === 'logout' ? runtimeRef.current : null
      if (signingOut) await beforeSignOut(signingOut).catch(() => undefined)
      try {
        await transition(reason)
      } catch {
        setRouteState({ status: 'sign-out-failed' })
        return
      }
      if (reason === 'mfa-required') {
        setRouteState({ status: 'mfa-required' })
        return
      }

      const result = await auth.signOutLocal()
      if (!result.error) {
        setRouteState({ status: 'signed-out' })
        return
      }
      try {
        const checked = await auth.getSession()
        setRouteState(!checked.error && !checked.data.session
          ? { status: 'signed-out' }
          : { status: 'sign-out-failed' })
      } catch {
        setRouteState({ status: 'sign-out-failed' })
      }
    }
    void run().catch(() => {
      setRouteState({ status: 'sign-out-failed' })
    }).finally(() => {
      if (terminalFlight.current === flight) terminalFlight.current = null
      resolveFlight()
    })
    return flight
  }, [auth, beforeSignOut, transition])

  const activate = useCallback(async (nextSession: AuthSession) => {
    const startVersion = activationVersion.current
    const next = createRuntime({
      epochId: (++epochCounter.current) as AuthEpochId,
      principalId: nextSession.user.id,
      auth,
      transport,
      operationScope: scope,
      transition: (reason) => beginTerminalTransition(reason as TerminalTransitionReason),
    })
    const epoch = next.epochId
    // Taken once, right before use: set by the sign-up submit path (see invite-token-store)
    // immediately before calling signUp, so it survives exactly one activation and is never
    // resent on a later, unrelated login.
    const pendingInviteToken = takePendingInviteToken() ?? undefined
    const outcome = await provisionAppUser(next.apiClient, signupLocale.current, pendingInviteToken)
    // A fresher activation state transition may have occurred while this one awaited
    // provisioning — either a newer activate() call (epochCounter bumped), or the
    // session clearing to null and the activation effect setting signed-out directly
    // (activationVersion bumped without a new activate() call). Commit nothing here —
    // including no sign-out on failure — or a stale result could resurrect access after
    // a sign-out/clear, or clobber a fresher run.
    if (startVersion !== activationVersion.current || epoch !== epochCounter.current) return
    if (outcome === 'unavailable') {
      // Transient (offline, server down): the stored session is still valid, so it is
      // kept. Signing out here wiped a good session on a cold start without network.
      // The next launch, or signing in again, retries provisioning.
      runtimeRef.current = null
      setRuntime(null)
      setActivationError('provision-failed')
      setRouteState({ status: 'signed-out' })
      return
    }
    if (outcome === 'failed') {
      await auth.signOutLocal().catch(() => undefined)
      runtimeRef.current = null
      setRuntime(null)
      setActivationError('provision-failed')
      setRouteState({ status: 'signed-out' })
      return
    }
    runtimeRef.current = next
    setRuntime(next)
    setActivationError(null)
    setRouteState({ status: 'authenticated' })
  }, [auth, beginTerminalTransition, createRuntime, scope, transport])

  useEffect(() => () => {
    activationVersion.current += 1
    terminalLocked.current = true
    runtimeRef.current = null
    scope.invalidate()
    void cancelThenClearQueryClient(queryClient).catch(() => undefined)
  }, [queryClient, scope])

  useEffect(() => {
    const version = ++activationVersion.current
    const current = runtimeRef.current
    if (session && current?.principalId === session.user.id) return
    if (terminalLocked.current) return

    const replace = async () => {
      if (current) {
        const retirement = transition('tenant-change')
        retirementFlight.current = retirement
        await retirement.finally(() => {
          if (retirementFlight.current === retirement) retirementFlight.current = null
        })
      } else if (retirementFlight.current) {
        await retirementFlight.current
      }
      if (version !== activationVersion.current) return
      if (!session) {
        setRouteState({ status: 'signed-out' })
        return
      }
      setRouteState({ status: 'activating' })
      await activate(session)
    }
    void replace().catch(() => {
      if (version === activationVersion.current) setRouteState({ status: 'sign-out-failed' })
    })
  }, [activate, session, transition])

  const runSignOut = useCallback(() => beginTerminalTransition('logout'), [beginTerminalTransition])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (terminalFlight.current) return { status: 'unavailable' as const }
    terminalLocked.current = false
    return auth.signInWithPassword(email, password)
  }, [auth])

  const signInWithIdToken = useCallback(async (
    provider: NativeIdentityProviderId,
    token: string,
    nonce: string,
  ) => {
    if (terminalFlight.current) return { status: 'unavailable' as const }
    terminalLocked.current = false
    setActivationError(null)
    return auth.signInWithIdToken(provider, token, nonce)
  }, [auth])

  const signInWithSso = useCallback(async () => {
    if (terminalFlight.current) return { status: 'unavailable' as const }
    terminalLocked.current = false
    setActivationError(null)
    return auth.signInWithBrowser(OIDC_PROVIDER_ID)
  }, [auth])

  const signInWithPasskey = useCallback(async () => {
    if (terminalFlight.current) return { status: 'unavailable' as const }
    terminalLocked.current = false
    setActivationError(null)
    return auth.signInWithPasskey()
  }, [auth])

  const signUp = useCallback(async (email: string, password: string) => {
    if (terminalFlight.current) return { status: 'unavailable' as const }
    terminalLocked.current = false
    setActivationError(null)
    return auth.signUp(email, password, signupLocale.current)
  }, [auth])

  const clearActivationError = useCallback(() => setActivationError(null), [])

  const blockAccess = useCallback((reason: 'mfa-required') => {
    void beginTerminalTransition(reason)
  }, [beginTerminalTransition])

  const registerAuthenticatedBoundary = useCallback(() => {
    boundaryCount.current += 1
    committedBoundaryCount.current += 1
    let registered = true
    let passiveCompleted = false
    return {
      unregisterLayout: () => {
      if (!registered) return
      registered = false
      boundaryCount.current = Math.max(0, boundaryCount.current - 1)
      },
      completePassiveUnmount: () => {
        if (passiveCompleted) return
        passiveCompleted = true
        committedBoundaryCount.current = Math.max(0, committedBoundaryCount.current - 1)
      },
    }
  }, [])
  const acknowledgeDeactivation = useCallback(() => {
    const resolve = deactivationAck.current
    deactivationAck.current = null
    resolve?.()
  }, [])

  const mfaEnrollTotp = useCallback(() => auth.mfaEnrollTotp(), [auth])
  const mfaChallenge = useCallback((factorId: string) => auth.mfaChallenge(factorId), [auth])
  const mfaVerify = useCallback(
    (factorId: string, challengeId: string, code: string) => auth.mfaVerify(factorId, challengeId, code),
    [auth],
  )
  const mfaUnenroll = useCallback((factorId: string) => auth.mfaUnenroll(factorId), [auth])
  const mfaListFactors = useCallback(() => auth.mfaListFactors(), [auth])
  const changePassword = useCallback(
    (email: string, currentPassword: string, newPassword: string) => auth.changePassword(email, currentPassword, newPassword),
    [auth],
  )
  const sendVerificationEmail = useCallback((email: string) => auth.sendVerificationEmail(email), [auth])
  const listPasskeys = useCallback(() => auth.listPasskeys(), [auth])
  const addPasskey = useCallback(() => auth.addPasskey(), [auth])
  const deletePasskey = useCallback((id: string) => auth.deletePasskey(id), [auth])
  const validateHouseholdInvite = useCallback(
    (token: string) => validateHouseholdInviteToken(transport, token),
    [transport],
  )

  const completeMfaVerification = useCallback(async () => {
    if (routeState.status !== 'mfa-required') return
    terminalLocked.current = false
    const version = ++activationVersion.current
    setRouteState({ status: 'activating' })
    try {
      const result = await auth.getSession()
      if (version !== activationVersion.current) return
      if (result.error || !result.data.session) {
        setRouteState({ status: 'sign-out-failed' })
        return
      }
      await activate(result.data.session)
    } catch {
      if (version === activationVersion.current) setRouteState({ status: 'sign-out-failed' })
    }
  }, [activate, auth, routeState.status])

  const value = useMemo<ProductRuntimeContextValue>(() => ({
    routeState,
    runtime,
    signInWithPassword,
    signInWithIdToken,
    signInWithSso,
    signInWithPasskey,
    signUp,
    signOut: runSignOut,
    retrySignOut: runSignOut,
    blockAccess,
    registerAuthenticatedBoundary,
    acknowledgeDeactivation,
    activationError,
    clearActivationError,
    mfaEnrollTotp,
    mfaChallenge,
    mfaVerify,
    mfaUnenroll,
    mfaListFactors,
    changePassword,
    sendVerificationEmail,
    listPasskeys,
    addPasskey,
    deletePasskey,
    completeMfaVerification,
    validateHouseholdInvite,
  }), [
    addPasskey,
    deletePasskey,
    listPasskeys,
    signInWithPasskey,
    acknowledgeDeactivation,
    activationError,
    blockAccess,
    changePassword,
    clearActivationError,
    completeMfaVerification,
    mfaChallenge,
    mfaEnrollTotp,
    mfaListFactors,
    mfaUnenroll,
    mfaVerify,
    registerAuthenticatedBoundary,
    routeState,
    runSignOut,
    runtime,
    sendVerificationEmail,
    signInWithIdToken,
    signInWithPassword,
    signInWithSso,
    signUp,
    validateHouseholdInvite,
  ])

  return <ProductRuntimeContext.Provider value={value}>{children}</ProductRuntimeContext.Provider>
}
