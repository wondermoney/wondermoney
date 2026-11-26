/**
 * "Sign in again" for an action the API allows only from a fresh session (`session_not_fresh`),
 * such as setting up an Enable Banking key: the app signs out, the sign-in screen says why, and
 * once signed in again the app goes back to the screen the person left
 * (`features/onboarding/onboarding-gate.hook.ts`, after the first-run redirect).
 *
 * In memory only, like `sign-up-after-sign-out.ts`: a request left over from a sign-in that never
 * happened dies with the app.
 */
let pending: string | null = null

export function requestReturnAfterSignIn(href: string): void {
  pending = href
}

/** Whether a return is waiting, for the sign-in screen's notice. Leaves it in place. */
export function hasReturnAfterSignIn(): boolean {
  return pending !== null
}

/** The screen to go back to, once per request. */
export function takeReturnAfterSignIn(): string | null {
  const href = pending
  pending = null
  return href
}
