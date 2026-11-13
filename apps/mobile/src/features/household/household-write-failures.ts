import { ApiError } from '@/lib/api/errors'

/**
 * Shared across the household writes (invite, resend, revoke, change role, transfer, remove,
 * leave): they write against the same resource family and the API's error shapes collapse onto
 * this one bucket set. The 403s and 409s the API names by `code` get their own bucket; any other
 * 409 is 'conflict' and a 400 (inviting yourself, transferring to yourself) is 'invalid'.
 */
export type HouseholdWriteFailure =
  | 'demo'
  | 'read-only'
  | 'role-required'
  | 'access'
  | 'cancelled'
  | 'network-ambiguous'
  | 'full'
  | 'already-member'
  | 'conflict'
  | 'invalid'
  | 'not-found'
  | 'general'

export function classifyHouseholdWriteFailure(error: unknown): HouseholdWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'http' && error.status === 403
    && (error.serverCode === 'household_role_required' || error.serverCode === 'household_owner_required')) return 'role-required'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 409) {
    if (error.serverCode === 'household_full') return 'full'
    if (error.serverCode === 'already_household_member') return 'already-member'
    return 'conflict'
  }
  if (error.code === 'http' && error.status === 400) return 'invalid'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid'
  return 'general'
}

/**
 * Why a signed-in person's "Join" on an invite was refused, from the API's `code`. Each one
 * gets its own message on the join screen.
 */
export type AcceptInviteFailure =
  | 'household-has-data'
  | 'household-has-members'
  | 'already-member'
  | 'household-full'
  | 'email-mismatch'
  | 'expired'
  | 'invalid'
  | 'already-used'
  | 'demo'
  | 'cancelled'
  | 'network-ambiguous'
  | 'general'

const ACCEPT_CODES: ReadonlyMap<string, AcceptInviteFailure> = new Map<string, AcceptInviteFailure>([
  ['household_has_data', 'household-has-data'],
  ['household_has_members', 'household-has-members'],
  ['already_household_member', 'already-member'],
  ['household_full', 'household-full'],
  ['invite_email_mismatch', 'email-mismatch'],
  ['invite_expired', 'expired'],
  ['invite_invalid', 'invalid'],
  ['invite_already_used', 'already-used'],
])

export function classifyAcceptInviteFailure(error: unknown): AcceptInviteFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http') {
    const known = error.serverCode ? ACCEPT_CODES.get(error.serverCode) : undefined
    if (known) return known
    if (error.status === 400 || error.status === 404) return 'invalid'
  }
  return 'general'
}
