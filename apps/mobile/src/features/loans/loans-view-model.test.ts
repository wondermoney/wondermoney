import { mapLoan, mapLoans, mapRepayments, monthsUntil } from './loans-view-model'
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

  describe('remaining term', () => {
    const now = new Date('2026-11-05T10:00:00.000Z')
    // The seeded mortgage: EUR 742.18 a month at 3.6% takes 382 months to clear
    // EUR 168,382.33, but the contract matures on 2052-01-01, 302 months away.
    const seeded = { ...loanFixture, annualInterestRateBps: 360, maturityDate: '2052-01-01T00:00:00.000Z', outstandingPrincipal: 168_382.33, regularPaymentAmount: 742.18, remainingTermMonthsEstimated: 382, termMonths: 360 }

    it('counts the months left to maturity', () => {
      expect(monthsUntil('2052-01-01T00:00:00.000Z', now)).toBe(302)
      expect(monthsUntil('2026-12-05', now)).toBe(1)
      expect(monthsUntil('2026-12-06', now)).toBe(2)
      expect(monthsUntil('2020-01-01', now)).toBe(0)
    })

    it('shows the contract term and flags a payoff estimate that runs past it', () => {
      expect(mapLoan(seeded, now)).toMatchObject({ remainingTerm: { months: 302, basis: 'contract' }, payoffBeyondContractMonths: 382 })
    })

    it('does not flag an estimate that clears the loan by maturity', () => {
      expect(mapLoan({ ...seeded, remainingTermMonthsEstimated: 290 }, now)).toMatchObject({ remainingTerm: { months: 302, basis: 'contract' }, payoffBeyondContractMonths: null })
    })

    it('uses the estimate without a maturity date, unless it exceeds the original term', () => {
      expect(mapLoan({ ...seeded, maturityDate: null, remainingTermMonthsEstimated: 300 }, now)).toMatchObject({ remainingTerm: { months: 300, basis: 'estimate' }, payoffBeyondContractMonths: null })
      expect(mapLoan({ ...seeded, maturityDate: null }, now)).toMatchObject({ remainingTerm: null, payoffBeyondContractMonths: 382 })
    })

    it('has no remaining term without a maturity date or an estimate', () => {
      expect(mapLoan({ ...seeded, maturityDate: null, remainingTermMonthsEstimated: null }, now)).toMatchObject({ remainingTerm: null, payoffBeyondContractMonths: null })
    })
  })
})
