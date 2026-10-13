import {
  accountCurrenciesEndpoint,
  accountCurrenciesResponseSchema,
  accountFinancialInstitutionsEndpoint,
  accountFinancialInstitutionsResponseSchema,
  createOfflineAccountEndpoint,
  OFFLINE_ACCOUNT_BALANCE_MAX,
  offlineAccountPayloadSchema,
  parsePositiveDecimal,
} from './offline-account-contract'

describe('manual account contracts', () => {
  it('uses the two narrow reads and a 201-only undefined write response', () => {
    expect(accountCurrenciesEndpoint).toMatchObject({ method: 'GET', path: '/v1/account/currencies' })
    expect(accountFinancialInstitutionsEndpoint).toMatchObject({ method: 'GET', path: '/v1/account/financial-institutions' })
    expect(createOfflineAccountEndpoint).toMatchObject({ method: 'POST', path: '/v1/account/offline', successStatuses: [201] })
    expect(createOfflineAccountEndpoint.schema.parse(undefined)).toBeUndefined()
    expect(createOfflineAccountEndpoint.schema.safeParse({ accountId: 12 }).success).toBe(false)
  })

  it('strictly validates currency and optional institution fields', () => {
    const currencies = { currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }] }
    const institutions = { accountFinancialInstitutions: [{ accountFinancialInstitutionKey: 8, displayName: 'Bank', logoUrl: 'https://example.test/logo.png' }, { accountFinancialInstitutionKey: 9 }] }
    expect(accountCurrenciesResponseSchema.parse(currencies)).toEqual(currencies)
    expect(accountFinancialInstitutionsResponseSchema.parse(institutions)).toEqual(institutions)
    for (const value of [
      { currencies: [{ currencyKey: 0, code: 'EUR', description: 'Euro' }] },
      { currencies: [{ currencyKey: 1, code: 'eur', description: 'Euro' }] },
      { currencies: [{ currencyKey: 1, code: 'EUR', description: '' }] },
      { currencies: [{ currencyKey: 1, code: 'EUR', description: 'Euro', symbol: '€' }] },
    ]) expect(accountCurrenciesResponseSchema.safeParse(value).success).toBe(false)
    expect(accountFinancialInstitutionsResponseSchema.safeParse({ accountFinancialInstitutions: [{ accountFinancialInstitutionKey: -1 }] }).success).toBe(false)
    expect(accountFinancialInstitutionsResponseSchema.safeParse({ accountFinancialInstitutions: [{ accountFinancialInstitutionKey: 1, logoUrl: 'not-a-url' }] }).success).toBe(false)
  })

  it('trims names and permits only a positive bounded balance and positive selected ids', () => {
    expect(offlineAccountPayloadSchema.parse({ name: '  Cash  ', currentBalance: 1.25, currencyId: 151, financialInstitutionId: 8 })).toEqual({ name: 'Cash', currentBalance: 1.25, currencyId: 151, financialInstitutionId: 8 })
    for (const value of [
      { name: '', currentBalance: 1, currencyId: 151 },
      { name: 'x'.repeat(101), currentBalance: 1, currencyId: 151 },
      { name: 'Cash', currentBalance: 0, currencyId: 151 },
      { name: 'Cash', currentBalance: -1, currencyId: 151 },
      { name: 'Cash', currentBalance: OFFLINE_ACCOUNT_BALANCE_MAX + 1, currencyId: 151 },
      { name: 'Cash', currentBalance: 1, currencyId: 0 },
      { name: 'Cash', currentBalance: 1, currencyId: 151, financialInstitutionId: 0 },
      { name: 'Cash', currentBalance: 1, currencyId: 151, accountType: 'cash' },
    ]) expect(offlineAccountPayloadSchema.safeParse(value).success).toBe(false)
    expect(parsePositiveDecimal('12,50')).toBe(12.5)
    expect(parsePositiveDecimal('0')).toBeNull()
  })
})
