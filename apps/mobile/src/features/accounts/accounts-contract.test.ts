import {
  accountDetailResponseSchema,
  accountSummarySchema,
  accountUpdateWriteSchema,
  accountsEndpoint,
  accountsResponseSchema,
  createAccountDetailEndpoint,
  createDeleteAccountEndpoint,
  createUpdateAccountEndpoint,
  parseAccountId,
} from './accounts-contract'

const account = {
  accountFinancialInstitutionKey: { displayName: 'Wonder Bank', logoUrl: 'https://example.test/logo.png' },
  accountKey: 12,
  accountName: 'Everyday',
  accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
  appuserCurrencyBalance: 90.25,
  balance: 100,
  currencyKey: { code: 'USD' },
  isOwnedByViewer: true,
  isPrivate: false,
  refreshedAt: '2026-07-17T10:11:12.000Z',
  source: 'open_banking' as const,
}

describe('accounts contract', () => {
  it('pins the read endpoint, preserves server order, and accepts empty lists', () => {
    expect(accountsEndpoint).toMatchObject({ method: 'GET', path: '/v1/account' })
    expect(accountsResponseSchema.parse({ accounts: [{ ...account, accountKey: 2 }, account] }).accounts.map((row) => row.accountKey)).toEqual([2, 12])
    expect(accountsResponseSchema.parse({ accounts: [] })).toEqual({ accounts: [] })
  })

  it('accepts explicit nulls, zero, and harmless additive fields', () => {
    const candidate = {
      accounts: [{
        ...account,
        accountFinancialInstitutionKey: null,
        accountName: null,
        appuserCurrencyBalance: null,
        balance: 0,
        refreshedAt: null,
        futureRowField: true,
      }],
      generatedAt: 'future',
    }
    expect(accountsResponseSchema.safeParse(candidate).success).toBe(true)
    expect(accountSummarySchema.safeParse({
      ...account,
      accountFinancialInstitutionKey: { displayName: null, logoUrl: null, future: true },
    }).success).toBe(true)
    const parsed = accountSummarySchema.parse(account)
    expect(parsed.accountFinancialInstitutionKey).toEqual({
      displayName: 'Wonder Bank',
      logoUrl: 'https://example.test/logo.png',
    })
  })

  it.each([
    ['missing accounts', {}],
    ['non-array accounts', { accounts: account }],
    ['missing account key', { ...account, accountKey: undefined }],
    ['zero account key', { ...account, accountKey: 0 }],
    ['fractional account key', { ...account, accountKey: 1.5 }],
    ['missing account name', { ...account, accountName: undefined }],
    ['missing institution', { ...account, accountFinancialInstitutionKey: undefined }],
    ['missing institution name', { ...account, accountFinancialInstitutionKey: { logoUrl: null } }],
    ['missing institution logo', { ...account, accountFinancialInstitutionKey: { displayName: null } }],
    ['long institution name', { ...account, accountFinancialInstitutionKey: { displayName: 'B'.repeat(256) } }],
    ['long account name', { ...account, accountName: 'A'.repeat(256) }],
    ['missing balance', { ...account, balance: undefined }],
    ['non-finite balance', { ...account, balance: Infinity }],
    ['missing converted balance', { ...account, appuserCurrencyBalance: undefined }],
    ['non-finite converted balance', { ...account, appuserCurrencyBalance: NaN }],
    ['missing original currency', { ...account, currencyKey: undefined }],
    ['lowercase original currency', { ...account, currencyKey: { code: 'usd' } }],
    ['long original currency', { ...account, currencyKey: { code: 'USDD' } }],
    ['missing owner', { ...account, accountOwnerAppuserKey: undefined }],
    ['missing primary currency', { ...account, accountOwnerAppuserKey: { currencyKey: {} } }],
    ['short primary currency', { ...account, accountOwnerAppuserKey: { currencyKey: { code: 'EU' } } }],
    ['missing refreshed date', { ...account, refreshedAt: undefined }],
    ['malformed refreshed date', { ...account, refreshedAt: '2026-07-17' }],
    ['missing source', { ...account, source: undefined }],
    ['unknown source', { ...account, source: 'bank' }],
    ['missing isOwnedByViewer', { ...account, isOwnedByViewer: undefined }],
    ['non-boolean isOwnedByViewer', { ...account, isOwnedByViewer: 1 }],
    ['missing isPrivate', { ...account, isPrivate: undefined }],
    ['non-boolean isPrivate', { ...account, isPrivate: 'no' }],
  ])('rejects %s', (_label, candidate) => {
    const response = 'accounts' in candidate ? candidate : { accounts: [candidate] }
    expect(accountsResponseSchema.safeParse(response).success).toBe(false)
  })

  it('reuses the exact account summary schema for the detail response and preserves nulls and zero', () => {
    expect(accountDetailResponseSchema.shape.account).toBe(accountSummarySchema)
    expect(accountDetailResponseSchema.parse({
      account: {
        ...account,
        accountFinancialInstitutionKey: { displayName: null, logoUrl: null },
        accountName: null,
        appuserCurrencyBalance: 0,
        balance: 0,
        refreshedAt: null,
      },
    }).account).toMatchObject({ balance: 0, appuserCurrencyBalance: 0, accountName: null })
    expect(accountDetailResponseSchema.safeParse({ account: { ...account, source: 'other' } }).success).toBe(false)
    expect(accountDetailResponseSchema.safeParse({}).success).toBe(false)
  })

  it('validates positive safe route ids before building the exact detail endpoint', () => {
    expect(parseAccountId('42')).toBe(42)
    expect(createAccountDetailEndpoint(42)).toMatchObject({ method: 'GET', path: '/v1/account/42' })
    for (const value of ['0', '-1', '1.2', 'abc', '', '9007199254740992', ['42'], undefined]) {
      expect(parseAccountId(value)).toBeNull()
    }
    expect(() => createAccountDetailEndpoint(0)).toThrow(/account id/i)
    expect(() => createAccountDetailEndpoint(Number.MAX_SAFE_INTEGER + 1)).toThrow(/account id/i)
  })

  it('builds the exact update and delete endpoints and validates positive safe ids', () => {
    expect(createUpdateAccountEndpoint(12)).toMatchObject({ method: 'PATCH', path: '/v1/account/12' })
    expect(createDeleteAccountEndpoint(12)).toMatchObject({ method: 'DELETE', path: '/v1/account/12' })
    expect(() => createUpdateAccountEndpoint(0)).toThrow(/account id/i)
    expect(() => createDeleteAccountEndpoint(0)).toThrow(/account id/i)
  })

  it('accepts a partial rename/privacy write and rejects out-of-range or unknown fields', () => {
    expect(accountUpdateWriteSchema.safeParse({ accountName: 'Everyday' }).success).toBe(true)
    expect(accountUpdateWriteSchema.safeParse({ isPrivate: true }).success).toBe(true)
    expect(accountUpdateWriteSchema.safeParse({}).success).toBe(true)
    expect(accountUpdateWriteSchema.safeParse({ accountName: '' }).success).toBe(false)
    expect(accountUpdateWriteSchema.safeParse({ accountName: 'A'.repeat(101) }).success).toBe(false)
    expect(accountUpdateWriteSchema.safeParse({ isPrivate: 'yes' }).success).toBe(false)
    expect(accountUpdateWriteSchema.safeParse({ accountName: 'Everyday', unknownField: true }).success).toBe(false)
  })
})
