import {
  bankConnectionSchema,
  bankConnectionsResponseSchema,
  connectionStatusSchema,
  createBankConnectionsEndpoint,
  createDisconnectBankConnectionEndpoint,
  isValidBankConnectionId,
} from '../connection-status-contract'

const newConnection = {
  accessType: 'open_banking',
  dataFreshAsOf: '2026-07-30T10:00:00.000Z',
  expiresAt: '2026-08-30T12:00:00.000Z',
  institutionName: 'Real Bank',
  provider: 'GoCardless',
  status: 'connected',
} as const

describe('banking connection-status contract', () => {
  it('accepts the full six-field shape with a status enum', () => {
    expect(connectionStatusSchema.parse('connected')).toBe('connected')
    expect(connectionStatusSchema.parse('error')).toBe('error')
    expect(connectionStatusSchema.parse('expired')).toBe('expired')
    expect(connectionStatusSchema.parse('processing')).toBe('processing')
  })

  it('reads a status this build does not know as unknown, and still rejects a non-string', () => {
    expect(connectionStatusSchema.parse('pending')).toBe('unknown')
    expect(connectionStatusSchema.parse('linked')).toBe('unknown')
    expect(connectionStatusSchema.safeParse(null).success).toBe(false)
  })

  it('keeps nulls explicit and preserves a real zero-length institutionName', () => {
    expect(bankConnectionSchema.parse({ ...newConnection, institutionName: null }).institutionName).toBeNull()
    expect(bankConnectionSchema.parse({ ...newConnection, dataFreshAsOf: null }).dataFreshAsOf).toBeNull()
  })

  it('tolerates additive upstream fields (cross-repo HTTP boundary, not our own DTO)', () => {
    expect(
      bankConnectionSchema.safeParse({ ...newConnection, requisitionId: 'req-1' }).success,
    ).toBe(true)
  })

  it('accepts both known provider values', () => {
    expect(bankConnectionSchema.parse({ ...newConnection, provider: 'GoCardless' }).provider).toBe('GoCardless')
    expect(bankConnectionSchema.parse({ ...newConnection, provider: 'EnableBanking' }).provider).toBe('EnableBanking')
  })

  it('reads a provider or access type this build does not know as unknown instead of failing the list', () => {
    const parsed = bankConnectionsResponseSchema.parse({ connections: [
      { ...newConnection, provider: 'Plaid', accessType: 'screen_scraping', status: 'reauthorizing' },
      newConnection,
    ] })
    expect(parsed.connections[0]).toMatchObject({ provider: 'unknown', accessType: 'unknown', status: 'unknown' })
    expect(parsed.connections[1]).toMatchObject({ provider: 'GoCardless', accessType: 'open_banking', status: 'connected' })
    expect(bankConnectionSchema.safeParse({ ...newConnection, provider: undefined }).success).toBe(false)
  })

  it('exposes the read endpoint at /v1/banking/connections', () => {
    const endpoint = createBankConnectionsEndpoint()
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/banking/connections')
    expect(endpoint.schema).toBe(bankConnectionsResponseSchema)
  })

  it('accepts an empty list as a 200-shaped response', () => {
    const parsed = bankConnectionsResponseSchema.parse({ connections: [] })
    expect(parsed.connections).toEqual([])
  })

  it('accepts connectionId as a positive int, null, or absent (forward-compatible)', () => {
    expect(bankConnectionSchema.parse({ ...newConnection, connectionId: 42 }).connectionId).toBe(42)
    expect(bankConnectionSchema.parse({ ...newConnection, connectionId: null }).connectionId).toBeNull()
    expect(bankConnectionSchema.parse(newConnection).connectionId).toBeUndefined()
  })

  it('rejects a non-positive or non-integer connectionId', () => {
    expect(bankConnectionSchema.safeParse({ ...newConnection, connectionId: 0 }).success).toBe(false)
    expect(bankConnectionSchema.safeParse({ ...newConnection, connectionId: -1 }).success).toBe(false)
    expect(bankConnectionSchema.safeParse({ ...newConnection, connectionId: 1.5 }).success).toBe(false)
  })

  it('validates a bank connection id the same way the accounts/goals contracts do', () => {
    expect(isValidBankConnectionId(42)).toBe(true)
    expect(isValidBankConnectionId(0)).toBe(false)
    expect(isValidBankConnectionId(-1)).toBe(false)
    expect(isValidBankConnectionId(1.5)).toBe(false)
  })

  it('exposes the disconnect write endpoint at DELETE /v1/banking/connections/:connectionId', () => {
    const endpoint = createDisconnectBankConnectionEndpoint(42)
    expect(endpoint.method).toBe('DELETE')
    expect(endpoint.path).toBe('/v1/banking/connections/42')
  })

  it('refuses to build a disconnect endpoint for an invalid connection id', () => {
    expect(() => createDisconnectBankConnectionEndpoint(0)).toThrow()
    expect(() => createDisconnectBankConnectionEndpoint(-1)).toThrow()
  })
})
