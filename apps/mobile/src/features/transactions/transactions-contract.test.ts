import {
  accountTransactionsResponseSchema,
  aggregateTransactionsResponseSchema,
  createAccountTransactionsEndpoint,
  createAggregateTransactionsEndpoint,
  createEditTransactionAmountEndpoint,
  createRemoveTransactionSplitsEndpoint,
  createSetTransactionSplitsEndpoint,
  freezeEditTransactionAmount,
  freezeSetTransactionSplits,
  MAX_SPLIT_LINES,
  transactionReviewSummaryEndpoint,
  transactionReviewSummarySchema,
} from './transactions-contract'
import { inTimeZone } from '@/test/time-zone'

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

  it('reads the merchant with its logo fields, and an older server that sends only its name', () => {
    const merchant = { transactionMerchantKey: 12, name: 'Starbucks', website: 'https://starbucks.example', logoUrl: null, resolvedLogoUrl: 'https://api.example.test/v1/account/transaction-merchants/12/logo' }
    const [current, older, malformed, none] = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...transactionFixture, transactionMerchantKey: merchant },
      { ...transactionFixture, transactionMerchantKey: { name: 'Corner shop' } },
      { ...transactionFixture, transactionMerchantKey: { transactionMerchantKey: 'x', name: 'Odd', website: 42, logoUrl: {}, resolvedLogoUrl: false } },
      { ...transactionFixture, transactionMerchantKey: undefined },
    ] }).transactions
    expect(current!.transactionMerchantKey).toEqual(merchant)
    expect(older!.transactionMerchantKey).toEqual({ name: 'Corner shop' })
    // A malformed logo field reads as absent rather than failing the list.
    expect(malformed!.transactionMerchantKey).toEqual({ transactionMerchantKey: undefined, name: 'Odd', website: null, logoUrl: null, resolvedLogoUrl: null })
    expect(none!.transactionMerchantKey).toBeUndefined()
    expect(accountTransactionsResponseSchema.parse({ transactions: [{ ...transactionFixture, transactionMerchantKey: merchant }] }).transactions[0]!.transactionMerchantKey).toEqual(merchant)
  })

  it('keeps the list parsing when the API adds fields or recurring values this build does not know', () => {
    const recurringSeries = { recurringSeriesKey: 4, displayName: 'Gym', type: 'membership', amountType: 'tiered', status: 'snoozed', cadence: 'monthly' }
    const [row] = aggregateTransactionsResponseSchema.parse({ transactions: [{ ...transactionFixture, recurringSeries, sentiment: 'positive' }] }).transactions
    expect(row!.recurringSeries).toEqual({ recurringSeriesKey: 4, displayName: 'Gym', type: 'unknown', amountType: 'unknown', status: 'unknown' })
    expect(row).not.toHaveProperty('sentiment')
  })

  it('reads the installment a row was linked to, and a row from an older API as none', () => {
    const installment = { installmentPlanKey: 11, installmentNumber: 3, installmentCount: 12 }
    const [linked, ordinary, older, malformed] = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...transactionFixture, installment },
      { ...transactionFixture, installment: null },
      transactionFixture,
      { ...transactionFixture, installment: { installmentNumber: '3' } },
    ] }).transactions
    expect(linked?.installment).toEqual(installment)
    expect(ordinary?.installment).toBeNull()
    expect(older?.installment).toBeUndefined()
    expect(malformed?.installment).toBeNull()
    expect(accountTransactionsResponseSchema.parse({ transactions: [{ ...transactionFixture, installment }] }).transactions[0]?.installment).toEqual(installment)
  })

  it('reads how each row was converted, an unknown status or malformed rate date as unknown', () => {
    const [missing, estimated, unknown] = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...transactionFixture, appuserSettlementAmount: null, fxStatus: 'missing', fxRateDate: null },
      { ...transactionFixture, fxStatus: 'provisional', fxRateDate: '2026-11-03' },
      { ...transactionFixture, fxStatus: 'guessed', fxRateDate: 'last week' },
    ] }).transactions
    expect(missing).toMatchObject({ appuserSettlementAmount: null, fxStatus: 'missing', fxRateDate: null })
    expect(estimated).toMatchObject({ fxStatus: 'provisional', fxRateDate: '2026-11-03' })
    expect(unknown).toMatchObject({ fxStatus: null, fxRateDate: null })
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
    expect(createAggregateTransactionsEndpoint(filters, 'Europe/Lisbon').path).toBe('/v1/account/transaction?fromDate=1782864000000&toDate=1784332800000&timezone=Europe%2FLisbon&unreviewedOnly=true')
    expect(createAccountTransactionsEndpoint(7, filters, 'Europe/Lisbon').path).toBe('/v1/account/7/transaction?fromDate=1782864000000&toDate=1784332800000&timezone=Europe%2FLisbon&unreviewedOnly=true&accountId=7')
  })

  describe('in Tokyo', () => {
    inTimeZone('Asia/Tokyo')

    it('sends the device time zone with a date range, so the API counts a bank booking on its own date', () => {
      const filters = { fromDate: '2026-07-31T15:00:00.000Z', toDate: '2026-08-31T14:59:59.999Z' }
      const aggregate = new URLSearchParams(createAggregateTransactionsEndpoint(filters).path.split('?')[1])
      const account = new URLSearchParams(createAccountTransactionsEndpoint(7, filters).path.split('?')[1])
      expect(aggregate.get('timezone')).toBe('Asia/Tokyo')
      expect(account.get('timezone')).toBe('Asia/Tokyo')
    })

    it('sends no time zone without a date range', () => {
      expect(createAggregateTransactionsEndpoint({ needsReview: true }).path).toBe('/v1/account/transaction?unreviewedOnly=true')
    })
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

describe('the review summary', () => {
  it('reads the count, the amount at stake and its currency', () => {
    expect(transactionReviewSummarySchema.parse({ count: 3, totalAbs: 1240, currency: 'EUR' })).toEqual({ count: 3, totalAbs: 1240, currency: 'EUR' })
    expect(transactionReviewSummarySchema.safeParse({ count: -1, totalAbs: 0, currency: 'EUR' }).success).toBe(false)
    expect(transactionReviewSummarySchema.safeParse({ count: 0, totalAbs: 0, currency: 'euro' }).success).toBe(false)
  })

  it('asks for it at its own path', () => {
    expect(transactionReviewSummaryEndpoint.method).toBe('GET')
    expect(transactionReviewSummaryEndpoint.path).toBe('/v1/account/transaction/review-summary')
  })
})

describe('split transactions', () => {
  const splitLine = {
    transactionSplitKey: 5,
    amount: -7.5,
    appuserAmount: -7.5,
    category: { categoryKey: 3, name: 'Groceries', isSystemCategory: true },
    notes: 'Food',
    position: 0,
  }

  it('reads the lines a list row carries, and treats a row without them as unsplit', () => {
    const [split, plain] = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...transactionFixture, splits: [splitLine, { ...splitLine, transactionSplitKey: 6, amount: -2.5, appuserAmount: -2.5, category: null, notes: null, position: 1 }] },
      transactionFixture,
    ] }).transactions
    expect(split!.splits).toEqual([
      { transactionSplitKey: 5, amount: -7.5, appuserAmount: -7.5, category: { categoryKey: 3, name: 'Groceries', isSystemCategory: true }, notes: 'Food', position: 0 },
      { transactionSplitKey: 6, amount: -2.5, appuserAmount: -2.5, category: null, notes: null, position: 1 },
    ])
    expect(plain).not.toHaveProperty('splits')
  })

  it('accepts a line with no converted amount, and drops fields this build does not know', () => {
    const [row] = aggregateTransactionsResponseSchema.parse({ transactions: [
      { ...transactionFixture, splits: [{ ...splitLine, appuserAmount: null, sentiment: 'positive' }] },
    ] }).transactions
    expect(row!.splits?.[0]).not.toHaveProperty('sentiment')
    expect(row!.splits?.[0]?.appuserAmount).toBeNull()
  })

  it('rejects a line without a finite amount or with a non-positive key', () => {
    expect(aggregateTransactionsResponseSchema.safeParse({ transactions: [{ ...transactionFixture, splits: [{ ...splitLine, amount: Number.NaN }] }] }).success).toBe(false)
    expect(aggregateTransactionsResponseSchema.safeParse({ transactions: [{ ...transactionFixture, splits: [{ ...splitLine, transactionSplitKey: 0 }] }] }).success).toBe(false)
  })

  describe('freezeSetTransactionSplits', () => {
    it('trims notes, keeps nulls, and freezes the payload', () => {
      const frozen = freezeSetTransactionSplits({
        transactionId: 41,
        lines: [
          { categoryId: 3, amount: '-7.5', notes: '  Food  ' },
          { categoryId: null, amount: '-2.5', notes: '   ' },
        ],
      })
      expect(frozen.transactionId).toBe(41)
      expect(frozen.payload).toEqual([
        { categoryId: 3, amount: '-7.5', notes: 'Food' },
        { categoryId: null, amount: '-2.5', notes: null },
      ])
      expect(Object.isFrozen(frozen)).toBe(true)
      expect(Object.isFrozen(frozen.payload)).toBe(true)
    })

    it('needs at least two lines and no more than the API takes', () => {
      expect(() => freezeSetTransactionSplits({ transactionId: 41, lines: [{ categoryId: null, amount: '-10', notes: null }] })).toThrow()
      const many = Array.from({ length: MAX_SPLIT_LINES + 1 }, () => ({ categoryId: null, amount: '-1', notes: null }))
      expect(() => freezeSetTransactionSplits({ transactionId: 41, lines: many })).toThrow()
    })

    it.each([
      ['five decimals', '-1.23456'],
      ['text', 'ten'],
      ['empty', ''],
    ])('rejects a %s amount', (_label, amount) => {
      expect(() => freezeSetTransactionSplits({ transactionId: 41, lines: [{ categoryId: null, amount, notes: null }, { categoryId: null, amount: '-1', notes: null }] })).toThrow()
    })

    it('rejects a non-positive transaction or category id', () => {
      expect(() => freezeSetTransactionSplits({ transactionId: 0, lines: [{ categoryId: null, amount: '-1', notes: null }, { categoryId: null, amount: '-1', notes: null }] })).toThrow()
      expect(() => freezeSetTransactionSplits({ transactionId: 41, lines: [{ categoryId: -1, amount: '-1', notes: null }, { categoryId: null, amount: '-1', notes: null }] })).toThrow()
    })
  })

  it('builds the PUT and DELETE paths, rejecting a bad id', () => {
    expect(createSetTransactionSplitsEndpoint(41)).toMatchObject({ method: 'PUT', path: '/v1/account/transaction/41/splits' })
    expect(createRemoveTransactionSplitsEndpoint(41)).toMatchObject({ method: 'DELETE', path: '/v1/account/transaction/41/splits' })
    expect(() => createSetTransactionSplitsEndpoint(0)).toThrow()
    expect(() => createRemoveTransactionSplitsEndpoint(-1)).toThrow()
  })

  it('reads the transaction the split endpoints return', () => {
    const endpoint = createSetTransactionSplitsEndpoint(41)
    expect(endpoint.schema.parse({
      transaction: { transactionKey: 41, splits: [splitLine], reviewed: false, appuserSettlementAmount: -10 },
    })).toEqual({ transaction: { transactionKey: 41, splits: [splitLine], reviewed: false, appuserSettlementAmount: -10 } })
  })
})
