import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

export type AppStateSubscribe = (
  onChange: (state: AppStateStatus) => void,
) => { remove: () => void }

const defaultSubscribe: AppStateSubscribe = (onChange) => AppState.addEventListener('change', onChange)

/**
 * RAD-240 — there is no reliable "the user finished GoCardless consent"
 * signal from the in-app browser: no app-scheme callback is wired up (the
 * API redirects to the web app, not back into this app — see
 * start-connection-contract.ts). The closest honest proxy is "the app
 * regained the foreground while a browser session we opened was
 * outstanding". `armed` scopes the listener to exactly that window, so
 * unrelated app-active transitions (the user simply switching apps while
 * browsing elsewhere) never trigger it.
 */
export function useReturnFromBrowser(
  armed: boolean,
  onReturn: () => void,
  subscribe: AppStateSubscribe = defaultSubscribe,
) {
  const onReturnRef = useRef(onReturn)
  useEffect(() => {
    onReturnRef.current = onReturn
  })

  useEffect(() => {
    if (!armed) return
    const subscription = subscribe((state) => {
      if (state === 'active') onReturnRef.current()
    })
    return () => subscription.remove()
  }, [armed, subscribe])
}
