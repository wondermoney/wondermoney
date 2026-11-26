/**
 * Where onboarding's manual-account screen was opened from, so its Back returns there: the
 * account step, or the no-bank choice that skipping the bank opens. It travels as `from` to the
 * screen and comes back as `resume` to the journey.
 */
export type OnboardingAccountOrigin = 'account' | 'no-bank'

/** The origin a route parameter names; anything else opens the journey at its start. */
export function parseAccountOrigin(raw: string | string[] | undefined): OnboardingAccountOrigin | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'account' || value === 'no-bank' ? value : undefined
}
