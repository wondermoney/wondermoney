import { netWorthDtoSchema, netWorthEndpoint } from './net-worth-contract'

const fixture = {
  currencyCode: 'EUR',
  totalNetWorth: 1250.5,
  assets: { accounts: 1000, portfolios: 500.5 },
  liabilities: { loans: 250 },
  rows: [
    { type: 'accounts', name: 'Current account', balance: 1000 },
    { type: 'portfolios', name: 'Long-term portfolio', balance: 500.5 },
    { type: 'loans', name: 'Card', balance: -250 },
  ],
  unsupportedCurrencies: { loans: 1, portfolios: 0 },
}

describe('net-worth contract', () => {
  it('pins the current API fixture and endpoint', () => {
    expect(netWorthEndpoint).toMatchObject({ method: 'GET', path: '/v1/net-worth' })
    expect(netWorthDtoSchema.parse(fixture)).toEqual(fixture)
  })

  it.each(['EUR', 'USD', 'JPY'])('accepts ISO-shaped currency code %s', (currencyCode) => {
    expect(netWorthDtoSchema.safeParse({ ...fixture, currencyCode }).success).toBe(true)
  })

  it.each([
    'eur',
    'EuR',
    'EU',
    'EURO',
    'U$D',
    ' USD',
    'USD ',
    'US\n',
  ])('rejects unsafe currency code %p', (currencyCode) => {
    expect(netWorthDtoSchema.safeParse({ ...fixture, currencyCode }).success).toBe(false)
  })

  it('accepts zeros and empty rows', () => {
    expect(netWorthDtoSchema.safeParse({
      ...fixture,
      totalNetWorth: 0,
      assets: { accounts: 0, portfolios: 0 },
      liabilities: { loans: 0 },
      rows: [],
      unsupportedCurrencies: { loans: 0, portfolios: 0 },
    }).success).toBe(true)
  })

  it('permits harmless additive fields', () => {
    expect(netWorthDtoSchema.safeParse({
      ...fixture,
      generatedAt: 'future',
      assets: { ...fixture.assets, futureCategory: 10 },
      rows: [{ ...fixture.rows[0], icon: 'future' }],
    }).success).toBe(true)
  })

  it.each([
    ['missing currency', { ...fixture, currencyCode: undefined }],
    ['null total', { ...fixture, totalNetWorth: null }],
    ['non-finite total', { ...fixture, totalNetWorth: Number.POSITIVE_INFINITY }],
    ['missing account total', { ...fixture, assets: { portfolios: 1 } }],
    ['wrong liability', { ...fixture, liabilities: { loans: '2' } }],
    ['empty row name', { ...fixture, rows: [{ type: 'accounts', name: '', balance: 1 }] }],
    ['oversized row name', { ...fixture, rows: [{ type: 'accounts', name: 'x'.repeat(256), balance: 1 }] }],
    ['non-finite row', { ...fixture, rows: [{ type: 'accounts', name: 'Cash', balance: NaN }] }],
    ['non-string row type', { ...fixture, rows: [{ type: 1, name: 'Cash', balance: 1 }] }],
    ['negative counter', { ...fixture, unsupportedCurrencies: { loans: -1, portfolios: 0 } }],
    ['fraction counter', { ...fixture, unsupportedCurrencies: { loans: 0, portfolios: 0.5 } }],
  ])('rejects %s', (_case, candidate) => {
    expect(netWorthDtoSchema.safeParse(candidate).success).toBe(false)
  })

  it('drops a breakdown row of a type this build does not know and strips added fields', () => {
    const parsed = netWorthDtoSchema.parse({
      ...fixture,
      rows: [...fixture.rows, { type: 'properties', name: 'Flat', balance: 200_000, valuationDate: '2026-01-01' }],
      assets: { ...fixture.assets, properties: 200_000 },
      generatedAt: 'now',
    })
    expect(parsed).toEqual(fixture)
  })

  it('does not assert arithmetic consistency', () => {
    expect(netWorthDtoSchema.safeParse({ ...fixture, totalNetWorth: -999 }).success).toBe(true)
  })
})
