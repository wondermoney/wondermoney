import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'

/**
 * "Hide for now" on the setup checklist, for 14 days as on web
 * (`useDismissibleActivation`). A plain timestamp, kept in SecureStore only
 * because it's the one storage this app wires up; the dismissal still holds
 * for the session when storage fails.
 */
const KEY = 'wondermoney.setup-checklist.dismissed-until'
const DURATION_MS = 14 * 24 * 60 * 60 * 1000

export function useSetupChecklistDismissal() {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let active = true
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        const until = Number(raw)
        if (active && Number.isFinite(until) && until > Date.now()) setDismissed(true)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const dismiss = useCallback(() => {
    setDismissed(true)
    SecureStore.setItemAsync(KEY, String(Date.now() + DURATION_MS)).catch(() => undefined)
  }, [])

  return { dismissed, dismiss }
}
