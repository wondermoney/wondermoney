import {
  createManualTransactionEndpoint,
  createTransactionMerchantsEndpoint,
  freezeManualTransaction,
  settlementCurrenciesEndpoint,
  settlementCurrenciesResponseSchema,
  transactionMerchantsResponseSchema,
  transactionTypesEndpoint,
  transactionTypesResponseSchema,
} from './manual-transaction-contract'

describe('manual transaction contract', () => {
  const valid = {
    accountId: 7,
    transactionDate: '2026-07-19',
    transactionTypeId: 3,
    settlementAmount: '12.50',
    settlementCurrencyId: 151,
    existingMerchantId: 9,
    newMerchantName: 'ignored because the existing merchant wins',
    categoryId: 4,
    description: '  Lunch  ',
  }

  it('freezes the exact mixed API body, prefers an existing merchant, and accepts empty 201', () => {
    const frozen = freezeManualTransaction(valid, new Date('2026-07-20T10:00:00Z'))
    expect(frozen).toEqual({
      accountId: 7,
      payload: {
        transactionDate: '2026-07-19T12:00:00.000Z',
        transactionTypeId: '3',
        settlementAmount: '12.50',
        settlementCurrencyId: '151',
        transactionMerchantId: 9,
        categoryId: '4',
        description: 'Lunch',
      },
    })
    const endpoint = createManualTransactionEndpoint(7)
    expect(endpoint).toMatchObject({ method: 'POST', path: '/v1/account/7/transaction' })
    expect(endpoint.schema.parse(undefined)).toBeUndefined()
    expect(() => endpoint.schema.parse({ transactionKey: 1 })).toThrow()
  })

  it.each([
    ['future date', { ...valid, transactionDate: '2026-07-21' }],
    ['signed amount', { ...valid, settlementAmount: '-12.5' }],
    ['positive sign', { ...valid, settlementAmount: '+12.5' }],
    ['nonfinite amount', { ...valid, settlementAmount: 'Infinity' }],
    ['zero amount', { ...valid, settlementAmount: '0' }],
    ['missing merchant', { ...valid, existingMerchantId: null, newMerchantName: '   ' }],
  ])('rejects %s before dispatch', (_label, draft) => {
    expect(() => freezeManualTransaction(draft, new Date('2026-07-20T10:00:00Z'))).toThrow()
  })

  it('uses strict metadata schemas and bounded encoded merchant search', () => {
    expect(transactionTypesEndpoint.path).toBe('/v1/account/transaction-types')
    expect(settlementCurrenciesEndpoint.path).toBe('/v1/account/currencies')
    expect(createTransactionMerchantsEndpoint(' Café & Co ', 20).path).toBe('/v1/account/transaction-merchants?search=Caf%C3%A9%20%26%20Co&limit=20')
    expect(transactionTypesResponseSchema.parse({ transactionTypes: [{ transactionTypeKey: 1, name: 'payment' }] })).toBeTruthy()
    expect(settlementCurrenciesResponseSchema.parse({ currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }] })).toBeTruthy()
    expect(transactionMerchantsResponseSchema.parse({ transactionMerchants: [{ transactionMerchantKey: 2, name: 'Cafe' }] })).toBeTruthy()
    expect(() => transactionTypesResponseSchema.parse({ transactionTypes: [{ transactionTypeKey: 1, name: 'payment', extra: true }] })).toThrow()
    expect(() => createTransactionMerchantsEndpoint('x'.repeat(201))).toThrow()
    expect(() => createTransactionMerchantsEndpoint('', 51)).toThrow()
  })
})
