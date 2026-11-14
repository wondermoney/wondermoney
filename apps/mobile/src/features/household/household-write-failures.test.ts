import { ApiError } from '@/lib/api/errors'

import { classifyAcceptInviteFailure, classifyHouseholdWriteFailure } from './household-write-failures'

describe('classifyHouseholdWriteFailure', () => {
  it.each([
    ['demo-forbidden', undefined, 'demo'],
    ['household-read-only', 403, 'read-only'],
    ['mfa-required', undefined, 'access'],
    ['auth-session', undefined, 'access'],
    ['http', 403, 'access'],
    ['cancelled', undefined, 'cancelled'],
    ['network', undefined, 'network-ambiguous'],
    ['http', 409, 'conflict'],
    ['http', 400, 'invalid'],
    ['http', 404, 'not-found'],
    ['invalid-response', undefined, 'invalid'],
    ['http', 500, 'general'],
  ] as const)('maps ApiError(%s, %s) to %s', (code, status, expected) => {
    expect(classifyHouseholdWriteFailure(new ApiError(code, status))).toBe(expected)
  })

  it.each([
    [403, 'household_role_required', 'role-required'],
    [403, 'household_owner_required', 'role-required'],
    [409, 'household_full', 'full'],
    [409, 'already_household_member', 'already-member'],
    [409, 'something_else', 'conflict'],
  ] as const)('maps a %s %s to %s', (status, serverCode, expected) => {
    expect(classifyHouseholdWriteFailure(new ApiError('http', status, { serverCode }))).toBe(expected)
  })

  it('maps a ZodError to invalid', () => {
    const error = new Error('bad shape')
    error.name = 'ZodError'
    expect(classifyHouseholdWriteFailure(error)).toBe('invalid')
  })

  it('maps any other error to general', () => {
    expect(classifyHouseholdWriteFailure(new Error('boom'))).toBe('general')
    expect(classifyHouseholdWriteFailure('not an error')).toBe('general')
  })
})

describe('classifyAcceptInviteFailure', () => {
  it.each([
    [409, 'household_has_data', 'household-has-data'],
    [409, 'household_has_members', 'household-has-members'],
    [409, 'already_household_member', 'already-member'],
    [409, 'household_full', 'household-full'],
    [400, 'invite_email_mismatch', 'email-mismatch'],
    [400, 'invite_expired', 'expired'],
    [400, 'invite_invalid', 'invalid'],
    [400, 'invite_already_used', 'already-used'],
  ] as const)('maps a %s %s to its own reason, %s', (status, serverCode, expected) => {
    expect(classifyAcceptInviteFailure(new ApiError('http', status, { serverCode }))).toBe(expected)
  })

  it('reads an uncoded 400 or 404 as an invalid invite and anything else as general', () => {
    expect(classifyAcceptInviteFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyAcceptInviteFailure(new ApiError('http', 404))).toBe('invalid')
    expect(classifyAcceptInviteFailure(new ApiError('http', 409, { serverCode: 'constructor' }))).toBe('general')
    expect(classifyAcceptInviteFailure(new ApiError('http', 500))).toBe('general')
    expect(classifyAcceptInviteFailure(new Error('boom'))).toBe('general')
  })

  it.each([
    ['demo-forbidden', 'demo'],
    ['cancelled', 'cancelled'],
    ['network', 'network-ambiguous'],
  ] as const)('maps ApiError(%s) to %s', (code, expected) => {
    expect(classifyAcceptInviteFailure(new ApiError(code))).toBe(expected)
  })
})
