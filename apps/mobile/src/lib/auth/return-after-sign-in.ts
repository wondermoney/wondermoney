/**
 * "Sign in again" for an action the API allows only from a fresh session (`session_not_fresh`),
 * such as setting up an Enable Banking key: the app signs out, the sign-in screen says why, and
 * once signed in again the app goes back to the screen the person left
 * (`features/onboarding/onboarding-gate.hook.ts`, after the first-run redirect).
 *
 * The request names who asked and on which server: signing in as someone else, or to another
 * server, drops it instead of opening that person's setup. In memory only, like
 * `sign-up-after-sign-out.ts`: a request left over from a sign-in that never happened dies with
 * the app.
 */

/** The screens that send a person to sign in again. */
export type ReturnAfterSignInHref = '/more/banking/connect'

export type ReturnAfterSignInRequest = Readonly<{
  href: ReturnAfterSignInHref
  /** The signed-in person (`ProductRuntime.principalId`). */
  principalId: string
  /** The API the app talked to (`useServerSwitch().apiBaseUrl`). */
  server: string
}>

let pending: ReturnAfterSignInRequest | null = null

export function requestReturnAfterSignIn(request: ReturnAfterSignInRequest): void {
  pending = request
}

/** Whether a return is waiting, for the sign-in screen's notice. Leaves it in place. */
export function hasReturnAfterSignIn(): boolean {
  return pending !== null
}

/**
 * The screen to go back to, once per request, when the same person signed in again to the same
 * server; null otherwise. The request is dropped either way.
 */
export function takeReturnAfterSignIn(principalId: string, server: string): ReturnAfterSignInHref | null {
  const request = pending
  pending = null
  if (!request || request.principalId !== principalId || request.server !== server) return null
  return request.href
}

/** Drops any waiting request (tests, and a sign-in that should not return anywhere). */
export function clearReturnAfterSignIn(): void {
  pending = null
}
