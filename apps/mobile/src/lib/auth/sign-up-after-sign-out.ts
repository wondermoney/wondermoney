/**
 * "Create your account" from the demo banner: the demo session has to be signed out first,
 * because the sign-up screen only exists in the signed-out tree. Signing out lands on the
 * sign-in screen, which takes this one-shot request and moves on to sign-up.
 *
 * In memory only: a request left over from a sign-out that never finished dies with the app.
 */
let requested = false

export function requestSignUpAfterSignOut(): void {
  requested = true
}

/** True once per request; the caller then opens sign-up. */
export function takeSignUpAfterSignOut(): boolean {
  const pending = requested
  requested = false
  return pending
}
