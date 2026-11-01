import { type ReactNode } from 'react'

import { useOnboardingGate } from './onboarding-gate.hook'

/**
 * Wrapper that runs inside the (app) authenticated layout. While the
 * bootstrap is loading or in a transitional error state it lets children
 * render so the existing (app) tabs stay interactive (the gate never blocks
 * legal/support/data-export/deletion routes that live under More). Once the
 * bootstrap is loaded and the user is required but not complete, the
 * underlying hook navigates to `/onboarding`.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  useOnboardingGate()
  return <>{children}</>
}
