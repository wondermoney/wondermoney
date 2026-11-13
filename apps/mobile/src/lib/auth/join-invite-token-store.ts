/**
 * The invite token from a join link opened while signed in, held in memory for the join
 * screen to read once. Kept apart from `invite-token-store`, which the sign-up path hands to
 * provisioning: a signed-in person joins only by tapping Join, never as a side effect of a
 * later sign-in. Never persisted and never put in a route, so it stays out of navigation logs.
 */
let pending: string | null = null

export function setJoinInviteToken(token: string): void {
  pending = token
}

export function takeJoinInviteToken(): string | null {
  const token = pending
  pending = null
  return token
}
