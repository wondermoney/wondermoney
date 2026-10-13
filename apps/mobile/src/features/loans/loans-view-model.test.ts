import { mapLoan, mapLoans, mapRepayments } from './loans-view-model'
import { loanFixture, repaymentFixture } from './test-fixtures'

describe('loan view models', () => {
  it('preserves per-loan currencies without producing a combined total', () => {
    const values = mapLoans({ loans: [loanFixture, { ...loanFixture, loanKey: 8, currency: { currencyKey: 2, code: 'USD' }, outstandingPrincipal: 2_000 }] })
    expect(values.map(({ currencyCode, outstanding }) => ({ currencyCode, outstanding }))).toEqual([{ currencyCode: 'EUR', outstanding: 180_000 }, { currencyCode: 'USD', outstanding: 2_000 }])
    expect(values[0]).not.toHaveProperty('totalOutstanding')
  })

  it('maps nullable loan context and clamps only visual progress', () => {
    const value = mapLoan({ ...loanFixture, annualInterestRateBps: null, originalPrincipal: null, progressPercentage: 120, providerName: null, regularPaymentAmount: null })
    expect(value).toMatchObject({ annualRatePercent: null, originalPrincipal: null, progressPercentage: 120, meterPercentage: 100, providerName: null, regularPayment: null })
  })

  it('sorts undefined API repayment ordering by payment date descending', () => {
    const values = mapRepayments({ repayments: [repaymentFixture, { ...repaymentFixture, loanRepaymentLinkKey: 22, paymentDate: '2026-08-05' }, { ...repaymentFixture, loanRepaymentLinkKey: 23, paymentDate: '2026-01-05' }] })
    expect(values.map((value) => value.id)).toEqual([22, 21, 23])
  })

  it('keeps total payment separate from principal reduction and consumes nested transaction fields', () => {
    const value = mapRepayments({ repayments: [repaymentFixture] })[0]
    expect(value).toMatchObject({ principal: 645, interest: 300, fee: 5, total: 950, transaction: { id: 81, merchantName: 'Example lender', settlementAmount: -950 } })
  })
})
