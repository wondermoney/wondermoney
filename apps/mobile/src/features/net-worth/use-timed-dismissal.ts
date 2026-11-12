import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'

/**
 * A "dismiss" that holds on this device for `durationMs`, as web's `useDismissibleActivation`
 * holds in the browser's storage. A plain timestamp, kept in SecureStore only because it's the
 * one storage this app wires up; the dismissal still holds for the session when storage fails.
 * `loaded` turns true once the stored value has been read (or failed to read), so a dismissed
 * prompt need not flash on while it is.
 */
export function useTimedDismissal(key: string, durationMs: number) {
  const [dismissed, setDismissed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    SecureStore.getItemAsync(key)
      .then((raw) => {
        const until = Number(raw)
        if (active && Number.isFinite(until) && until > Date.now()) setDismissed(true)
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [key])

  const dismiss = useCallback(() => {
    setDismissed(true)
    SecureStore.setItemAsync(key, String(Date.now() + durationMs)).catch(() => undefined)
  }, [durationMs, key])

  return { dismissed, loaded, dismiss }
}
