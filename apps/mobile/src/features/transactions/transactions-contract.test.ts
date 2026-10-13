import {
  accountTransactionsResponseSchema,
  aggregateTransactionsResponseSchema,
  createAccountTransactionsEndpoint,
  createAggregateTransactionsEndpoint,
  createEditTransactionAmountEndpoint,
  freezeEditTransactionAmount,
  parseTransactionDateRange,
} from './transactions-contract'
import { nullishTransactionFixture, transactionFixture } from './test-fixtures'

const omitNullishWireContext = () => {
  const {
    settlementAmount: _settlementAmount,
    settlementCurrencyKey: _settlementCurrencyKey,
    appuserSettlementAmount: _appuserSettlementAmount,
    appuserCurrencyKey: _appuserCurrencyKey,
    balance: _balance,
    appuserCurrencyBalance: _appuserCurrencyBalance,
    accountKey,
    ...rest
  } = transactionFixture
  const { accountName: _accountName, ...accountWithoutName } = accountKey
  return { ...rest, accountKey: accountWithoutName }
}

describe('transactions endpoint contracts', () => {
  it('accepts aggregate enrichment, optional wire context, and negative synthetic ids', () => {
    const result = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...transactionFixture, loanRepayment: { loanKey: 2, loanKeys: [2, 3], loanName: 'Card', principalAmount: 40, interestAmount: 2, feeAmount: 1, spendingAmount: 3 } },
      { ...transactionFixture, transactionKey: -42, transactionMerchantKey: undefined, transactionTypeKey: undefined, appuserTransactionCategories: [], description: undefined },
    ] })
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[1]?.transactionKey).toBe(-42)
  })

  it('accepts explicit null financial and account context on aggregate rows', () => {
    const result = aggregateTransactionsResponseSchema.parse({ transactions: [
      nullishTransactionFixture,
      omitNullishWireContext(),
    ] })
    expect(result.transactions[0]).toMatchObject({
      settlementAmount: null,
      settlementCurrencyKey: null,
      appuserSettlementAmount: null,
      appuserCurrencyKey: null,
      balance: null,
      appuserCurrencyBalance: null,
      accountKey: { accountName: null },
    })
    expect(result.transactions[1]).not.toHaveProperty('appuserSettlementAmount')
    expect(result.transactions[1]?.accountKey).not.toHaveProperty('accountName')
  })

  it('accepts omitted financial and account context on per-account rows', () => {
    const result = accountTransactionsResponseSchema.parse({ transactions: [
      nullishTransactionFixture,
      omitNullishWireContext(),
    ] })
    expect(result.transactions[0]?.settlementAmount).toBeNull()
    expect(result.transactions[1]).not.toHaveProperty('settlementAmount')
    expect(result.transactions[1]?.accountKey).not.toHaveProperty('accountName')
  })

  it('accepts a synthetic row with omitted balances and explicit null amount context', () => {
    const {
      balance: _balance,
      appuserCurrencyBalance: _appuserCurrencyBalance,
      ...withoutBalances
    } = nullishTransactionFixture
    const result = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...nullishTransactionFixture, transactionKey: -72 },
      { ...withoutBalances, transactionKey: -73 },
      { ...omitNullishWireContext(), transactionKey: -74 },
    ] })
    expect(result.transactions[0]?.balance).toBeNull()
    expect(result.transactions[0]?.transactionKey).toBe(-72)
    expect(result.transactions[1]).not.toHaveProperty('balance')
    expect(result.transactions[1]?.settlementAmount).toBeNull()
    expect(result.transactions[2]).not.toHaveProperty('settlementAmount')
  })

  it.each([
    ['non-finite money', { ...transactionFixture, settlementAmount: Infinity }],
    ['invalid date', { ...transactionFixture, transactionDate: '18/07/2026' }],
    ['invalid currency', { ...transactionFixture, appuserCurrencyKey: { code: 'EURO' } }],
    ['non-finite optional primary amount', { ...transactionFixture, appuserSettlementAmount: Number.NaN }],
    ['invalid optional settlement currency', { ...transactionFixture, settlementCurrencyKey: { code: 'eur' } }],
    ['zero id', { ...transactionFixture, transactionKey: 0 }],
  ])('rejects %s', (_label, transaction) => {
    expect(aggregateTransactionsResponseSchema.safeParse({ transactions: [transaction] }).success).toBe(false)
  })

  it('keeps repayment enrichment aggregate-only', () => {
    expect(accountTransactionsResponseSchema.parse({ transactions: [{ ...transactionFixture, loanRepayment: { unsafe: true } }] }).transactions[0]).not.toHaveProperty('loanRepayment')
  })

  it('builds actual aggregate and account URLs with server-side filters', () => {
    const filters = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-18T00:00:00.000Z', needsReview: true }
    expect(createAggregateTransactionsEndpoint(filters).path).toBe('/v1/account/transaction?fromDate=1782864000000&toDate=1784332800000&unreviewedOnly=true')
    expect(createAccountTransactionsEndpoint(7, filters).path).toBe('/v1/account/7/transaction?fromDate=1782864000000&toDate=1784332800000&unreviewedOnly=true&accountId=7')
  })

  it('includes includeHidden in the query string only when requested', () => {
    expect(createAggregateTransactionsEndpoint({ includeHidden: true }).path).toBe('/v1/account/transaction?includeHidden=true')
    expect(createAggregateTransactionsEndpoint({ includeHidden: false }).path).toBe('/v1/account/transaction')
    expect(createAggregateTransactionsEndpoint({}).path).toBe('/v1/account/transaction')
  })

  it('accepts an explicit hidden flag and defaults it to undefined when omitted', () => {
    const result = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...transactionFixture, hidden: true },
      omitNullishWireContext(),
    ] })
    expect(result.transactions[0]?.hidden).toBe(true)
    expect(result.transactions[1]).not.toHaveProperty('hidden')
  })
})

describe('parseTransactionDateRange', () => {
  it('resolves a valid range to an inclusive ISO fromDate/toDate pair', () => {
    expect(parseTransactionDateRange('2026-07-01', '2026-07-18')).toEqual({
      fromDate: '2026-07-01T00:00:00.000Z',
      toDate: '2026-07-18T23:59:59.999Z',
    })
  })

  it('accepts a single-day range', () => {
    const result = parseTransactionDateRange('2026-07-01', '2026-07-01')
    expect(result.fromDate).toBe('2026-07-01T00:00:00.000Z')
    expect(result.toDate).toBe('2026-07-01T23:59:59.999Z')
  })

  it('returns a frozen object', () => {
    expect(Object.isFrozen(parseTransactionDateRange('2026-07-01', '2026-07-18'))).toBe(true)
  })

  it.each([
    ['empty from', '', '2026-07-18'],
    ['empty to', '2026-07-01', ''],
    ['wrong format', '01/07/2026', '2026-07-18'],
    ['impossible calendar date', '2026-02-30', '2026-07-18'],
    ['non-calendar month', '2026-13-01', '2026-07-18'],
  ])('rejects %s', (_label, fromDate, toDate) => {
    expect(() => parseTransactionDateRange(fromDate, toDate)).toThrow()
  })

  it('rejects a start date after the end date', () => {
    expect(() => parseTransactionDateRange('2026-07-18', '2026-07-01')).toThrow('must not be after')
  })
})

describe('freezeEditTransactionAmount', () => {
  it('trims and passes through a valid signed decimal as a string', () => {
    expect(freezeEditTransactionAmount({ transactionId: 5, updatedAmount: ' -12.34 ' })).toEqual({
      transactionId: 5,
      payload: { updatedAmount: '-12.34' },
    })
  })

  it('accepts a bare positive integer and a leading-dot decimal', () => {
    expect(freezeEditTransactionAmount({ transactionId: 5, updatedAmount: '100' }).payload.updatedAmount).toBe('100')
    expect(freezeEditTransactionAmount({ transactionId: 5, updatedAmount: '.5' }).payload.updatedAmount).toBe('.5')
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['non-numeric text', 'abc'],
    ['double sign', '--5'],
    ['trailing sign', '5-'],
    ['thousands separator', '1,200'],
    ['multiple decimal points', '1.2.3'],
  ])('rejects %s', (_label, updatedAmount) => {
    expect(() => freezeEditTransactionAmount({ transactionId: 5, updatedAmount })).toThrow()
  })

  it('rejects a non-positive or non-integer transaction id', () => {
    expect(() => freezeEditTransactionAmount({ transactionId: 0, updatedAmount: '5' })).toThrow()
    expect(() => freezeEditTransactionAmount({ transactionId: -1, updatedAmount: '5' })).toThrow()
    expect(() => freezeEditTransactionAmount({ transactionId: 1.5, updatedAmount: '5' })).toThrow()
  })

  it('returns a frozen payload', () => {
    const frozen = freezeEditTransactionAmount({ transactionId: 5, updatedAmount: '10' })
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.payload)).toBe(true)
  })

  it('omits description from the payload when the caller does not supply one', () => {
    expect(freezeEditTransactionAmount({ transactionId: 5, updatedAmount: '10' }).payload).toEqual({ updatedAmount: '10' })
  })

  it('trims and includes a supplied description, including an empty string to clear it', () => {
    expect(freezeEditTransactionAmount({ transactionId: 5, updatedAmount: '10', description: '  Groceries  ' }).payload).toEqual({ updatedAmount: '10', description: 'Groceries' })
    expect(freezeEditTransactionAmount({ transactionId: 5, updatedAmount: '10', description: '   ' }).payload).toEqual({ updatedAmount: '10', description: '' })
  })

  it('rejects a description longer than 500 characters', () => {
    expect(() => freezeEditTransactionAmount({ transactionId: 5, updatedAmount: '10', description: 'x'.repeat(501) })).toThrow()
  })
})

describe('createEditTransactionAmountEndpoint', () => {
  it('builds the single-transaction PATCH path', () => {
    const endpoint = createEditTransactionAmountEndpoint(42)
    expect(endpoint.method).toBe('PATCH')
    expect(endpoint.path).toBe('/v1/account/transaction/42')
  })

  it('rejects a non-positive transaction id', () => {
    expect(() => createEditTransactionAmountEndpoint(0)).toThrow()
    expect(() => createEditTransactionAmountEndpoint(-3)).toThrow()
  })
})
