import type { HttpTransport } from '@/lib/api/client'

import { validateHouseholdInviteToken } from './household-invite-validation'

const transportWith = (request: HttpTransport['request']): HttpTransport => ({ request })

describe('validateHouseholdInviteToken', () => {
  it('sends an unauthenticated GET to the public validate endpoint', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      body: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })
    await validateHouseholdInviteToken(transportWith(request), 'tok-1')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      path: '/v1/household/invites/validate?token=tok-1',
      headers: {},
    }))
  })

  it('encodes the token in the query string', async () => {
    const request = jest.fn().mockResolvedValue({ status: 400, body: {} })
    await validateHouseholdInviteToken(transportWith(request), 'a b/c')
    expect(request.mock.calls[0][0].path).toBe('/v1/household/invites/validate?token=a%20b%2Fc')
  })

  it('returns valid with the parsed invite on 200', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      body: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })
    const result = await validateHouseholdInviteToken(transportWith(request), 'tok-1')
    expect(result).toEqual({
      status: 'valid',
      invite: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })
  })

  it('returns valid when the API adds fields to the invite, dropping them', async () => {
    const invite = { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' }
    const request = jest.fn().mockResolvedValue({ status: 200, body: { ...invite, householdName: 'Casa' } })
    await expect(validateHouseholdInviteToken(transportWith(request), 'tok-1')).resolves.toEqual({ status: 'valid', invite })
  })

  it('returns unavailable when the 200 body fails schema validation', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, body: { email: 'x' } })
    const result = await validateHouseholdInviteToken(transportWith(request), 'tok-1')
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('returns invalid on a 4xx response', async () => {
    const request = jest.fn().mockResolvedValue({ status: 400, body: {} })
    const result = await validateHouseholdInviteToken(transportWith(request), 'tok-1')
    expect(result).toEqual({ status: 'invalid' })
  })

  it('returns unavailable on a 5xx response', async () => {
    const request = jest.fn().mockResolvedValue({ status: 500, body: {} })
    const result = await validateHouseholdInviteToken(transportWith(request), 'tok-1')
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('returns unavailable when the transport throws', async () => {
    const request = jest.fn().mockRejectedValue(new Error('network'))
    const result = await validateHouseholdInviteToken(transportWith(request), 'tok-1')
    expect(result).toEqual({ status: 'unavailable' })
  })
})
