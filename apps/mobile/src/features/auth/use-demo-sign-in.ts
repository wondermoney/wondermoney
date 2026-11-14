import * as Application from 'expo-application'
import { useCallback, useState } from 'react'

import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { type DemoSignInOutcome, requestDemoSession } from '@/lib/auth/demo-sign-in'
import type { PairingStorage } from '@/lib/auth/pairing'

import { adoptSession } from './adopt-session'

export type DemoSignInStatus = 'idle' | 'signing-in' | DemoSignInOutcome['status']

type DemoSignInDeps = Readonly<{
  appVersion?: string
  fetchImpl?: typeof fetch
  platform?: string
  /** Injected in tests; defaults to the hardened SecureStore write. */
  storage?: PairingStorage
}>

/**
 * "Try the demo": asks the connected server for a demo session and adopts it like a paired
 * one, so the app opens signed in to the shared read-only account.
 */
export function useDemoSignIn(deps: DemoSignInDeps = {}) {
  const serverSwitch = useServerSwitch()
  const [status, setStatus] = useState<DemoSignInStatus>('idle')

  const signIn = useCallback(async (): Promise<DemoSignInStatus> => {
    if (!serverSwitch) {
      setStatus('unavailable')
      return 'unavailable'
    }

    setStatus('signing-in')
    const outcome = await requestDemoSession(serverSwitch.apiBaseUrl, {
      appVersion: deps.appVersion ?? Application.nativeApplicationVersion ?? '0.0.0',
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.platform ? { platform: deps.platform } : {}),
    })

    if (outcome.status !== 'signed-in') {
      setStatus(outcome.status)
      return outcome.status
    }

    try {
      await adoptSession(serverSwitch, serverSwitch.apiBaseUrl, outcome.session, deps.storage)
    } catch {
      setStatus('unavailable')
      return 'unavailable'
    }
    setStatus('signed-in')
    return 'signed-in'
  }, [deps.appVersion, deps.fetchImpl, deps.platform, deps.storage, serverSwitch])

  return { signIn, status }
}
