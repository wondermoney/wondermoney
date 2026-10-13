import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import type { AppStatePort } from '@/lib/auth/session-lifecycle'
import { getAppLockPreference, setAppLockPreference } from '@/lib/security/app-lock-preference'
import { authenticateWithDeviceAsync, checkLocalAuthCapability, type LocalAuthCapability } from '@/lib/security/local-authentication-adapter'

export type AppLockSetEnabledOutcome =
  | { status: 'enabled' }
  | { status: 'disabled' }
  | { status: 'unavailable'; capability: Exclude<LocalAuthCapability, 'available'> }
  | { status: 'auth-failed' }

export type AppLockContextValue = Readonly<{
  isLoaded: boolean
  enabled: boolean
  locked: boolean
  setEnabled: (next: boolean, promptMessage: string) => Promise<AppLockSetEnabledOutcome>
  unlock: (promptMessage: string) => Promise<boolean>
}>

const AppLockContext = createContext<AppLockContextValue | null>(null)

export function useAppLock() {
  const value = useContext(AppLockContext)
  if (!value) throw new Error('useAppLock must be used within AppLockProvider')
  return value
}

/**
 * Gates the authenticated app behind a device biometric/passcode prompt, independent of the
 * Supabase session itself (see secure-session-storage.ts — the session is deliberately never
 * biometric-protected). Re-locks whenever the app leaves the foreground while enabled, including
 * the very first load: `locked` starts false only until the persisted preference finishes loading.
 *
 * Locks on both 'inactive' and 'background', not just 'background': on iOS the app passes through
 * 'inactive' before 'background' on every backgrounding transition (app switcher, Control Center,
 * incoming call, share sheet), and it is during 'inactive' — not 'background' — that the OS
 * captures the app-switcher snapshot and that system overlays can reveal the current screen.
 * Waiting for 'background' alone leaves financial data exposed in that window.
 */
export function AppLockProvider({ children, appState }: { children: ReactNode; appState: AppStatePort }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [enabled, setEnabledState] = useState(false)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getAppLockPreference().then((value) => {
      if (cancelled) return
      setEnabledState(value)
      setLocked(value)
      setIsLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const subscription = appState.addEventListener('change', (nextState) => {
      if (enabled && (nextState === 'background' || nextState === 'inactive')) setLocked(true)
    })
    return () => subscription.remove()
  }, [appState, enabled])

  const setEnabled = useCallback(async (next: boolean, promptMessage: string): Promise<AppLockSetEnabledOutcome> => {
    if (!next) {
      await setAppLockPreference(false)
      setEnabledState(false)
      setLocked(false)
      return { status: 'disabled' }
    }
    const capability = await checkLocalAuthCapability()
    if (capability !== 'available') return { status: 'unavailable', capability }
    if (!(await authenticateWithDeviceAsync(promptMessage))) return { status: 'auth-failed' }
    await setAppLockPreference(true)
    setEnabledState(true)
    return { status: 'enabled' }
  }, [])

  const unlock = useCallback(async (promptMessage: string): Promise<boolean> => {
    const success = await authenticateWithDeviceAsync(promptMessage)
    if (success) setLocked(false)
    return success
  }, [])

  const value = useMemo<AppLockContextValue>(
    () => ({ isLoaded, enabled, locked, setEnabled, unlock }),
    [enabled, isLoaded, locked, setEnabled, unlock],
  )

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>
}
