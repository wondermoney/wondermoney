import { type ReactNode, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppLock } from '@/components/providers/app-lock-provider'

import { AppLockScreen } from './app-lock-screen'

/**
 * Runs inside the (app) authenticated layout, alongside OnboardingGate. Unlike that gate (which
 * redirects), this one blocks in place — a route change must not be able to bypass the lock.
 * Renders nothing while the persisted preference is still loading, to avoid a flash of
 * unprotected content before the app even knows whether it should be locked.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { isLoaded, enabled, locked, unlock } = useAppLock()
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const attemptUnlock = useCallback(async () => {
    setPending(true)
    setFailed(false)
    const success = await unlock(t('appLock.promptMessage'))
    setPending(false)
    if (!success) setFailed(true)
  }, [t, unlock])

  if (!isLoaded) return null
  if (enabled && locked) return <AppLockScreen pending={pending} failed={failed} onUnlock={attemptUnlock} />
  return <>{children}</>
}
