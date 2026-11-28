import { type Href, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { takeReturnAfterSignIn } from '@/lib/auth/return-after-sign-in'

import { useOnboardingBootstrap } from './use-onboarding-bootstrap'

export type OnboardingGateView = Readonly<{
  bootstrapReady: boolean
  required: boolean
  completed: boolean
}>

/**
 * Pure data hook for the (app) layout gate. Decoupled from the
 * presentational `OnboardingGate` component so it can be tested without
 * rendering. Returns the three flags the root router cares about and, as a
 * side effect, navigates the router to `/onboarding` once when the bootstrap
 * resolves to required && !completed. After a sign-in that a sensitive action asked for, it then
 * opens the screen the person left.
 *
 * Returns a never-pushed gate when the runtime isn't authenticated (signed
 * out, activating, deactivating, mfa / sign-out-failed): the
 * gate is a no-op so the existing (app) tree stays interactive and the
 * pre-existing route state owns the destination.
 */
export function useOnboardingGate(): OnboardingGateView {
  const { runtime } = useProductRuntime()
  const router = useRouter()
  const lastAction = useRef<'none' | 'pushed' | 'dismissed'>('none')
  // A return after signing in again is taken once per mount, however often the effect runs.
  const returnChecked = useRef(false)
  const server = useServerSwitch()?.apiBaseUrl ?? null

  // The bootstrap hook requires an authenticated runtime; gate the call so
  // the root router test (which renders every route state without a runtime)
  // does not throw.
  const bootstrap = useOnboardingBootstrapSafe(runtime ? true : false)

  useEffect(() => {
    if (!runtime) return
    if (bootstrap.isAccessTransition) return
    if (bootstrap.isLoading) return
    if (!bootstrap.data) return
    const onboarding = bootstrap.data.onboarding
    if (onboarding.required && !onboarding.completed) {
      if (lastAction.current !== 'pushed') {
        lastAction.current = 'pushed'
        router.replace('/onboarding' as Href)
      }
    } else {
      lastAction.current = 'dismissed'
    }
    // Back to the screen that asked for a fresh sign-in (lib/auth/return-after-sign-in.ts), on
    // top of first run when it is still required, so leaving that screen returns there.
    if (returnChecked.current) return
    returnChecked.current = true
    const returnTo = server === null ? null : takeReturnAfterSignIn(runtime.principalId, server)
    if (returnTo) router.push(returnTo as Href)
  }, [bootstrap.data, bootstrap.isAccessTransition, bootstrap.isLoading, router, runtime, server])

  const onboarding = bootstrap.data?.onboarding
  return {
    bootstrapReady: !!onboarding,
    completed: onboarding?.completed ?? false,
    required: onboarding?.required ?? false,
  }
}

// Conditional call to the bootstrap hook: when `enabled` is false the hook is
// not invoked at all, which means React's rules of hooks are satisfied
// (the alternative is to push the runtime check into the hook itself and
// return a never-resolved placeholder, which makes the gate harder to test).
type OnboardingBootstrapResult = ReturnType<typeof useOnboardingBootstrap>

function useOnboardingBootstrapSafe(enabled: boolean): OnboardingBootstrapResult {
  if (enabled) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useOnboardingBootstrap()
  }
  return {
    data: undefined,
    isAccessTransition: false,
    isInitialFailure: false,
    isLoading: false,
    isNotFound: false,
    isRefreshFailure: false,
    isRefreshing: false,
  } as OnboardingBootstrapResult
}
