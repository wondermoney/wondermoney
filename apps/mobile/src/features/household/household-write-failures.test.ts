import { ApiError } from '@/lib/api/errors'

import { classifyHouseholdWriteFailure } from './household-write-failures'

describe('classifyHouseholdWriteFailure', () => {
  it.each([
    ['demo-forbidden', undefined, 'demo'],
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
