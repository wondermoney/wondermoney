import { createStartBankConnectionEndpoint, startBankConnectionResponseSchema } from '../start-connection-contract'

describe('startBankConnectionResponseSchema', () => {
  it('accepts an Enable Banking-hosted consent redirect URL', () => {
    const parsed = startBankConnectionResponseSchema.parse({ redirectUrl: 'https://enablebanking.com/session/abc' })
    expect(parsed).toEqual({ redirectUrl: 'https://enablebanking.com/session/abc' })
  })

  it('rejects a non-url redirectUrl', () => {
    expect(startBankConnectionResponseSchema.safeParse({ redirectUrl: 'not-a-url' }).success).toBe(false)
  })

  it('tolerates additive upstream fields beyond redirectUrl (cross-repo HTTP boundary, not our own DTO)', () => {
    expect(
      startBankConnectionResponseSchema.safeParse({ redirectUrl: 'https://enablebanking.com/session/abc', authorizationId: 'a-1' }).success,
    ).toBe(true)
  })
})

describe('createStartBankConnectionEndpoint', () => {
  it('targets GET /v1/banking/bank/:bankId/start with an encoded bank id, asking to return to the app', () => {
    const endpoint = createStartBankConnectionEndpoint('REVOLUT_REVOGB21')
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/banking/bank/REVOLUT_REVOGB21/start?returnTo=mobile')
    expect(endpoint.schema).toBe(startBankConnectionResponseSchema)
  })

  it('encodes a bank id that needs escaping', () => {
    const endpoint = createStartBankConnectionEndpoint('bank id/with slash')
    expect(endpoint.path).toBe('/v1/banking/bank/bank%20id%2Fwith%20slash/start?returnTo=mobile')
  })

  it('rejects a blank bank id rather than building a malformed path', () => {
    expect(() => createStartBankConnectionEndpoint('  ')).toThrow(/bank id/i)
  })
})
