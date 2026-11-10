import { useCallback, useMemo } from 'react'

import { useOptionalSessionPreferences } from '@/components/providers/session-preferences-provider'

export type PrivacyMode = Readonly<{
  /** Amounts render as a mask instead of their value. */
  hidden: boolean
  setHidden: (value: boolean) => void
  toggle: () => void
}>

const noop = () => undefined

/**
 * Privacy mode: device-local, remembered across restarts like the theme
 * (`preference-storage.ts`). Outside the preferences provider (shell chrome,
 * isolated tests) amounts are shown and the setters do nothing.
 */
export function usePrivacyMode(): PrivacyMode {
  const preferences = useOptionalSessionPreferences()
  const hidden = preferences?.privacyMode ?? false
  const setPrivacyMode = preferences?.setPrivacyMode
  const toggle = useCallback(() => setPrivacyMode?.(!hidden), [hidden, setPrivacyMode])
  return useMemo(() => ({ hidden, setHidden: setPrivacyMode ?? noop, toggle }), [hidden, setPrivacyMode, toggle])
}
