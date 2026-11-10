import { mapTransactions } from './transactions-view-model'
import { estimatedTransactionFixture, nullishTransactionFixture, transactionFixture, unconvertedTransactionFixture } from './test-fixtures'

describe('transaction view model', () => {
  it('keeps the server order and maps merchant, converted amount, cues, and detail context', () => {
    const rows = mapTransactions({ transactions: [
      { ...transactionFixture, transactionKey: 42, transactionDate: '2026-07-19T10:00:00.000Z', transactionTypeKey: { name: 'credit' }, transactionMerchantKey: undefined, description: 'Salary', appuserSettlementAmount: 1000, recurringSeries: { recurringSeriesKey: 2, displayName: 'Salary', type: 'bill', amountType: 'fixed', status: 'confirmed' } },
      transactionFixture,
    ] })
    expect(rows.map((row) => row.id)).toEqual([42, 41])
    expect(rows[0]).toMatchObject({ title: 'Salary', isCredit: true, amount: 1000, currency: 'EUR', description: 'Salary' })
    expect(rows[1]).toMatchObject({ title: 'Corner shop', isCredit: true, direction: 'credit', category: 'Groceries', description: 'Card purchase', rawDescription: 'CARD PURCHASE 1234' })
  })

  it('leaves the server-placed initial balance at the head of the page, as web lists it', () => {
    const rows = mapTransactions({ transactions: [
      { ...transactionFixture, transactionKey: -7, transactionDate: '2025-10-04T00:00:00.000Z', description: 'Initial balance' },
      { ...transactionFixture, transactionKey: 42, transactionDate: '2026-11-03T10:00:00.000Z' },
    ] })
    expect(rows.map((row) => row.id)).toEqual([-7, 42])
  })

  it('leads each row with its mark: category colours, transfer arrows, the institution on the opening row, a tag when uncategorised', () => {
    const category = { categoryKey: 3, name: 'Coffee', icon: 'coffee', bgColor: '#FEE2E2', textColor: '#991B1B', isSystemCategory: false }
    const institution = { logoUrl: 'https://cdn.example/bank.png' }
    const rows = mapTransactions({ transactions: [
      { ...transactionFixture, appuserTransactionCategories: [category] },
      { ...transactionFixture, transactionTypeKey: { name: 'TRANSFER_IN' }, appuserTransactionCategories: [category] },
      { ...transactionFixture, transactionKey: -7, appuserTransactionCategories: [], accountKey: { ...transactionFixture.accountKey, accountFinancialInstitutionKey: institution } },
      { ...transactionFixture, appuserTransactionCategories: [] },
    ] })
    expect(rows.map((row) => row.mark)).toEqual([
      { icon: { name: 'coffee', bgColor: '#FEE2E2', textColor: '#991B1B' } },
      { glyph: 'arrow-left-right' },
      { image: 'https://cdn.example/bank.png', glyph: 'landmark' },
      { glyph: 'tag' },
    ])
  })

  it('marks negative initial-balance rows synthetic', () => {
    expect(mapTransactions({ transactions: [{ ...transactionFixture, transactionKey: -7 }] })[0]?.synthetic).toBe(true)
  })

  it('defaults hidden to false when the server omits it, and passes through an explicit true', () => {
    expect(mapTransactions({ transactions: [transactionFixture] })[0]?.hidden).toBe(false)
    expect(mapTransactions({ transactions: [{ ...transactionFixture, hidden: true }] })[0]?.hidden).toBe(true)
  })

  it('preserves unavailable financial context without zero or currency fallback', () => {
    const row = mapTransactions({ transactions: [nullishTransactionFixture] })[0]
    expect(row).toMatchObject({
      accountName: null,
      amount: null,
      currency: null,
      settlementAmount: null,
      settlementCurrency: null,
      balance: null,
      balanceCurrency: 'EUR',
      convertedBalance: null,
      convertedBalanceCurrency: null,
      direction: 'debit',
      isCredit: false,
    })
  })

  it('keeps a present amount when only its currency is unavailable', () => {
    const row = mapTransactions({ transactions: [{ ...transactionFixture, appuserCurrencyKey: null }] })[0]
    expect(row).toMatchObject({ amount: 12.5, currency: null, direction: 'credit' })
  })

  it('makes every nonzero finite sign authoritative over mismatched type metadata', () => {
    const rows = mapTransactions({ transactions: [
      { ...transactionFixture, transactionKey: 51, appuserSettlementAmount: -25, transactionTypeKey: { name: 'credit' } },
      { ...transactionFixture, transactionKey: 52, appuserSettlementAmount: 25, transactionTypeKey: { name: 'debit' } },
    ] })
    expect(rows.find((row) => row.id === 51)).toMatchObject({ amount: -25, direction: 'debit', isCredit: false, type: 'credit' })
    expect(rows.find((row) => row.id === 52)).toMatchObject({ amount: 25, direction: 'credit', isCredit: true, type: 'debit' })
  })

  it('uses type fallback only for zero or unavailable primary amounts', () => {
    const rows = mapTransactions({ transactions: [
      { ...transactionFixture, transactionKey: 61, appuserSettlementAmount: 0, transactionTypeKey: { name: 'credit' } },
      { ...transactionFixture, transactionKey: 62, appuserSettlementAmount: 0, transactionTypeKey: undefined },
      { ...transactionFixture, transactionKey: 63, appuserSettlementAmount: null, transactionTypeKey: { name: 'debit' } },
    ] })
    expect(rows.find((row) => row.id === 61)?.direction).toBe('credit')
    expect(rows.find((row) => row.id === 62)?.direction).toBe('unknown')
    expect(rows.find((row) => row.id === 63)?.direction).toBe('debit')
  })
  describe('how each row was converted', () => {
    it('carries the original amount of a row with no exchange rate, keeping its sign as the direction', () => {
      const [row] = mapTransactions({ transactions: [unconvertedTransactionFixture] })
      expect(row).toMatchObject({ amount: null, direction: 'debit', fx: { status: 'missing', amount: -10_000, currency: 'JPY' } })
    })

    it('marks a row converted at an old rate as estimated, with the rate date', () => {
      const [row] = mapTransactions({ transactions: [estimatedTransactionFixture] })
      expect(row).toMatchObject({ amount: -60, fx: { status: 'provisional', rateDate: '2026-11-03' } })
    })

    it('leaves a row in the user currency, or from an older API, exact', () => {
      const rows = mapTransactions({ transactions: [transactionFixture, nullishTransactionFixture] })
      expect(rows.map((row) => row.fx)).toEqual([{ status: 'exact' }, { status: 'exact' }])
    })
  })
})
