import { mapTransactions } from './transactions-view-model'
import { nullishTransactionFixture, transactionFixture } from './test-fixtures'

describe('transaction view model', () => {
  it('sorts recent-first and maps merchant, converted amount, cues, and detail context', () => {
    const rows = mapTransactions({ transactions: [
      transactionFixture,
      { ...transactionFixture, transactionKey: 42, transactionDate: '2026-07-19T10:00:00.000Z', transactionTypeKey: { name: 'credit' }, transactionMerchantKey: undefined, description: 'Salary', appuserSettlementAmount: 1000, recurringSeries: { recurringSeriesKey: 2, displayName: 'Salary', type: 'bill', amountType: 'fixed', status: 'confirmed' } },
    ] })
    expect(rows.map((row) => row.id)).toEqual([42, 41])
    expect(rows[0]).toMatchObject({ title: 'Salary', isCredit: true, amount: 1000, currency: 'EUR', description: 'Salary' })
    expect(rows[1]).toMatchObject({ title: 'Corner shop', isCredit: true, direction: 'credit', category: 'Groceries', description: 'Card purchase', rawDescription: 'CARD PURCHASE 1234' })
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
})
