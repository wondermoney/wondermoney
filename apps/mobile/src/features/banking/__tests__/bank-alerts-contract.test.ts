import { bankAlertsEndpoint, bankAlertsResponseSchema } from '../bank-alerts-contract'

const expiring = {
  id: 'alert-1',
  kind: 'consent_expiring',
  institutionName: 'Banco X',
  bankId: 'BANCO_X',
  expiresAt: '2026-11-16T00:00:00.000Z',
  daysUntilExpiry: 7,
  failingSince: null,
}

describe('bank alerts contract', () => {
  it('reads the viewer-scoped alerts endpoint', () => {
    expect(bankAlertsEndpoint.method).toBe('GET')
    expect(bankAlertsEndpoint.path).toBe('/v1/banking/alerts')
  })

  it('accepts every known kind', () => {
    const parsed = bankAlertsResponseSchema.parse({
      alerts: [
        expiring,
        { ...expiring, id: 'alert-2', kind: 'consent_revoked', expiresAt: null, daysUntilExpiry: null },
        { ...expiring, id: 'alert-3', kind: 'sync_failing', expiresAt: null, daysUntilExpiry: null, failingSince: '2026-11-05T08:00:00.000Z' },
      ],
    })
    expect(parsed.alerts.map((alert) => alert.kind)).toEqual(['consent_expiring', 'consent_revoked', 'sync_failing'])
    expect(parsed.alerts[0]).toEqual(expiring)
  })

  it('drops an alert kind this build does not know instead of failing the list', () => {
    const parsed = bankAlertsResponseSchema.parse({
      alerts: [{ ...expiring, id: 'future', kind: 'payment_due' }, expiring],
    })
    expect(parsed.alerts.map((alert) => alert.id)).toEqual(['alert-1'])
  })

  it('reads omitted optional fields as null and strips added ones', () => {
    const parsed = bankAlertsResponseSchema.parse({
      alerts: [{ id: 'alert-9', kind: 'consent_revoked', institutionName: null, providerCode: 'gc' }],
    })
    expect(parsed.alerts).toEqual([{
      id: 'alert-9',
      kind: 'consent_revoked',
      institutionName: null,
      bankId: null,
      expiresAt: null,
      daysUntilExpiry: null,
      failingSince: null,
    }])
  })

  it('rejects an alert without an id', () => {
    expect(bankAlertsResponseSchema.safeParse({ alerts: [{ ...expiring, id: '' }] }).success).toBe(false)
    expect(bankAlertsResponseSchema.safeParse({}).success).toBe(false)
  })
})
