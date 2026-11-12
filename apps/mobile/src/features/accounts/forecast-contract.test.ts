import { createAccountForecastEndpoint, forecastResponseSchema } from './forecast-contract'

const series = {
  complete: true,
  currency: 'EUR',
  lowPoint: { balance: 900, date: '2026-03-06' },
  openingBalance: 1000,
  points: [{ balance: 900, date: '2026-03-06' }],
  projected: [{ accountKey: 7, amount: 100, currency: 'EUR', date: '2026-03-06', name: 'Rent', seriesKey: 1 }],
}

describe('account forecast contract', () => {
  it('requests one account for a bounded window', () => {
    expect(createAccountForecastEndpoint(7, 30).path).toBe('/v1/account/forecast?accountKeys=7&days=30')
  })

  it('parses the per-account series, the per-currency totals and a single total', () => {
    const parsed = forecastResponseSchema.parse({
      accounts: [{ ...series, accountKey: 7, extra: 1 }],
      days: 30,
      from: '2026-03-01',
      total: series,
      totals: [series],
    })

    expect(parsed.accounts[0]).toMatchObject({ accountKey: 7, lowPoint: { balance: 900 } })
    expect(parsed.accounts[0]).not.toHaveProperty('extra')
    expect(parsed.total?.currency).toBe('EUR')
  })

  it('reads the card installments still to come, and a series from an older API without them', () => {
    const projectedInstallments = [{ accountKey: 7, amount: 25, currency: 'EUR', date: '2026-03-05', installmentCount: 12, installmentNumber: 3, installmentPlanKey: 11, name: 'Laptop' }]
    const parsed = forecastResponseSchema.parse({
      accounts: [{ ...series, accountKey: 7, projectedInstallments }, { ...series, accountKey: 8 }, { ...series, accountKey: 9, projectedInstallments: [{ amount: 'x' }] }],
      days: 30,
      from: '2026-03-01',
      total: { ...series, projectedInstallments },
      totals: [series],
    })
    expect(parsed.accounts[0]?.projectedInstallments).toEqual(projectedInstallments)
    expect(parsed.accounts[1]?.projectedInstallments).toBeUndefined()
    expect(parsed.accounts[2]?.projectedInstallments).toBeUndefined()
    expect(parsed.total?.projectedInstallments).toHaveLength(1)
  })

  it('accepts an unavailable series and a mixed-currency response with no single total', () => {
    const parsed = forecastResponseSchema.parse({
      accounts: [{ ...series, accountKey: 7, lowPoint: null, openingBalance: null, points: [] }],
      days: 30,
      from: '2026-03-01',
      total: null,
      totals: [series, { ...series, currency: 'USD' }],
    })

    expect(parsed.accounts[0]?.lowPoint).toBeNull()
    expect(parsed.total).toBeNull()
    expect(parsed.totals).toHaveLength(2)
  })
})
