import { type Href, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { OnboardingScreen } from './onboarding-screen'
import { useCompleteOnboarding } from './use-complete-onboarding'
import { useOnboardingBootstrap } from './use-onboarding-bootstrap'
import { mapOnboardingState } from './onboarding-view-model'

type Outcome = 'idle' | 'skip' | 'connect-bank'

export function OnboardingRoute() {
  const { runtime } = useProductRuntime()
  const router = useRouter()
  const bootstrap = useOnboardingBootstrap()
  const completion = useCompleteOnboarding()
  const [outcome, setOutcome] = useState<Outcome>('idle')
  const hasLeft = useRef(false)

  const state = resolveViewState(bootstrap)

  // If the user is no longer required (legacy / re-fetched completed), leave
  // the journey and go back to the app. This keeps the route idempotent
  // across re-entry and after a stale completion.
  const shouldLeave = state.status === 'loaded' && (!state.view.required || state.view.completed)

  // In an effect, not in the render body. `router.back()` and
  // `router.replace()` write to the router store, so calling them while this
  // component renders schedules a state update on another component mid-render
  // and React throws every time the route is entered by a user who does not
  // need it. The ref makes it fire once rather than on every render that still
  // satisfies the condition, matching `useOnboardingGate`'s `lastAction` guard.
  useEffect(() => {
    if (!runtime || !shouldLeave || hasLeft.current) return
    hasLeft.current = true
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }, [router, runtime, shouldLeave])

  if (!runtime) return null

  if (bootstrap.isAccessTransition) return null

  // Nothing to show on the way out — rendering the journey for a frame while
  // navigating away from it is what made the redirect visible as a flash.
  if (shouldLeave) return null

  return (
    <OnboardingScreen
      state={state}
      pending={completion.isPending}
      outcome={outcome}
      onRetry={() => { void bootstrap.refetch() }}
      onConnectBank={async () => {
        setOutcome('connect-bank')
        // Bank linking owns its HTTP handoff and read-only consent boundary.
        // Do not mark onboarding complete before the user has connected it.
        router.push('/more/banking/connect' as Href)
        setOutcome('idle')
      }}
      onSkip={async () => {
        if (state.status !== 'loaded') return
        setOutcome('skip')
        try {
          await completion.mutateAsync({ version: state.view.version })
        } catch {
          // The screen surfaces the error from `classifyCompleteOnboardingFailure`.
        } finally {
          setOutcome('idle')
        }
      }}
      onCreateAccount={() => {
        // Pure navigation — no mutation happens here. The destination screen
        // creates the account first and only then completes onboarding, so a
        // user who backs out mid-flow is left in the same required state.
        //
        // Pushed as an explicit query string rather than the
        // object form ({ pathname, params }). Reproduced in production
        // builds: object-form params were not reaching this screen at all
        // (useLocalSearchParams saw an empty {}), landing on the invalid-
        // version fallback on every single sign-in. The query-string form
        // is the same shape `parseVersion` on the receiving end already
        // expects, and matches the existing recovery/invite deep-link
        // pushes elsewhere in the app.
        if (state.status !== 'loaded') return
        router.push(`/onboarding/create-account?version=${state.view.version}` as Href)
      }}
    />
  )
}



function resolveViewState(bootstrap: ReturnType<typeof useOnboardingBootstrap>) {
  if (bootstrap.isAccessTransition) return { status: 'access-transition' as const }
  if (bootstrap.data) {
    return { status: 'loaded' as const, view: mapOnboardingState(bootstrap.data.onboarding) }
  }
  if (bootstrap.isInitialFailure) {
    const code = (bootstrap.error as { code?: string } | null)?.code
    if (code === 'invalid-response') return { status: 'invalid-response' as const }
    return { status: 'error' as const }
  }
  if (bootstrap.isNotFound) return { status: 'invalid-id' as const }
  return { status: 'loading' as const }
}
