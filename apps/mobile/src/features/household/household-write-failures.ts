import { ApiError } from '@/lib/api/errors'

/**
 * Shared across the household invite/resend/revoke/remove mutations — they all write
 * against the same resource family and the API's error shapes for each collapse onto
 * this one bucket set. 'conflict' covers a full household or an email that already has
 * an account (both ConflictError/409 server-side); 'invalid' covers bad input such as
 * inviting yourself (BadRequestError/400).
 */
export type HouseholdWriteFailure =
  | 'demo'
  | 'access'
  | 'cancelled'
  | 'network-ambiguous'
  | 'conflict'
  | 'invalid'
  | 'not-found'
  | 'general'

export function classifyHouseholdWriteFailure(error: unknown): HouseholdWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required' || error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'http' && error.status === 409) return 'conflict'
  if (error.code === 'http' && error.status === 400) return 'invalid'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'invalid-response') return 'invalid'
  return 'general'
}
