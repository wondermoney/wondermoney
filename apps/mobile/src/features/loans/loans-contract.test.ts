import { createLoanEndpoint, createLoanRepaymentCandidatesEndpoint, createLoanRepaymentsEndpoint, createLoanWriteEndpoint, createDeleteLoanRepaymentEndpoint, createLinkLoanRepaymentEndpoint, createUpdateLoanRepaymentEndpoint, loanCreateEndpoint, loanCreateWriteSchema, loanRepaymentAllocationSchema, loanRepaymentCandidatesResponseSchema, loanRepaymentMutationResponseSchema, loanRepaymentsResponseSchema, loanResponseSchema, loansEndpoint, loansResponseSchema, loanWriteSchema, parseLoanId } from './loans-contract'
import { loanFixture, repaymentCandidateFixture, repaymentFixture } from './test-fixtures'

describe('loan contracts', () => {
  it('pins only the three read endpoints in scope', () => {
    expect(loansEndpoint).toMatchObject({ method: 'GET', path: '/v1/loan' })
    expect(createLoanEndpoint(7)).toMatchObject({ method: 'GET', path: '/v1/loan/7' })
    expect(createLoanRepaymentsEndpoint(7)).toMatchObject({ method: 'GET', path: '/v1/loan/7/repayments' })
    expect(JSON.stringify([loansEndpoint, createLoanEndpoint(7), createLoanRepaymentsEndpoint(7)])).not.toContain('overview')
  })

  it('pins the descriptive PATCH to the canonical loan response', () => {
    const endpoint = createLoanWriteEndpoint(7)
    expect(endpoint).toMatchObject({ method: 'PATCH', path: '/v1/loan/7', schema: loanResponseSchema })
    expect(endpoint.schema.parse({ loan: loanFixture })).toEqual({ loan: loanFixture })
  })

  it('pins candidate and repayment write paths, query placement, statuses, bodies, and responses', () => {
    expect(createLoanRepaymentCandidatesEndpoint(7)).toMatchObject({ method: 'GET', path: '/v1/loan/7/repayment-candidates' })
    expect(createLinkLoanRepaymentEndpoint(7, 82)).toMatchObject({ method: 'POST', path: '/v1/loan/7/repayments/link?transactionKey=82', successStatuses: [201] })
    expect(createUpdateLoanRepaymentEndpoint(7, 21)).toMatchObject({ method: 'PATCH', path: '/v1/loan/7/repayments/21', successStatuses: [200] })
    expect(createDeleteLoanRepaymentEndpoint(7, 21)).toMatchObject({ method: 'DELETE', path: '/v1/loan/7/repayments/21', successStatuses: [204] })
    const allocation = { principalAmount: 645, interestAmount: 300, feeAmount: 5, totalPaymentAmount: 950 }
    expect(loanRepaymentAllocationSchema.parse(allocation)).toEqual(allocation)
    expect(loanRepaymentCandidatesResponseSchema.parse({ candidates: [repaymentCandidateFixture] }).candidates[0].transaction).toEqual(repaymentCandidateFixture.transaction)
    expect(loanRepaymentCandidatesResponseSchema.safeParse({ candidates: [{ ...repaymentCandidateFixture, suggestedAllocation: { ...repaymentCandidateFixture.suggestedAllocation, principalAmount: 0, interestAmount: 950, feeAmount: 0, needsReview: true, negativeAmortization: true } }] }).success).toBe(true)
    const response = { repayment: { ...repaymentFixture, loanKey: 7, linkedByAppuserKey: 2, tenantKey: 3, transactionKey: 82 } }
    expect(loanRepaymentMutationResponseSchema.parse(response)).toEqual(response)
    expect(createDeleteLoanRepaymentEndpoint(7, 21).schema.parse(undefined)).toBeUndefined()
    expect(() => createLinkLoanRepaymentEndpoint(7, 0)).toThrow()
    expect(() => createUpdateLoanRepaymentEndpoint(7, -1)).toThrow()
  })

  it('rejects invalid allocations (a request body, so it stays strict)', () => {
    for (const value of [
      { principalAmount: 0, interestAmount: 0, feeAmount: 0, totalPaymentAmount: 1 },
      { principalAmount: 1, interestAmount: -1, feeAmount: 0, totalPaymentAmount: 0 },
      { principalAmount: 1, interestAmount: 0, feeAmount: 0, totalPaymentAmount: 2 },
      { principalAmount: Infinity, interestAmount: 0, feeAmount: 0, totalPaymentAmount: Infinity },
    ]) expect(loanRepaymentAllocationSchema.safeParse(value).success).toBe(false)
    expect(loanRepaymentAllocationSchema.safeParse({ principalAmount: 1, interestAmount: 0, feeAmount: 0, totalPaymentAmount: 1, notes: 'not writable' }).success).toBe(false)
    expect(loanRepaymentAllocationSchema.safeParse({ principalAmount: 1, interestAmount: 0, feeAmount: 0, totalPaymentAmount: 1, needsReview: false }).success).toBe(false)
  })

  it('keeps parsing candidates when the API adds fields or a confidence this build does not know', () => {
    const [candidate] = loanRepaymentCandidatesResponseSchema.parse({ candidates: [{
      ...repaymentCandidateFixture,
      confidence: 'VERY_HIGH',
      transactionKey: 82,
      transaction: { ...repaymentCandidateFixture.transaction, amount: -950 },
    }] }).candidates
    expect(candidate!.confidence).toBe('UNKNOWN')
    expect(candidate).not.toHaveProperty('transactionKey')
    expect(candidate!.transaction).not.toHaveProperty('amount')
  })

  it('accepts only explicit boolean inclusion or sparse descriptive fields', () => {
    expect(loanWriteSchema.parse({ includeInNetWorth: false })).toEqual({ includeInNetWorth: false })
    expect(loanWriteSchema.parse({ includeInNetWorth: true })).toEqual({ includeInNetWorth: true })
    expect(loanWriteSchema.parse({ providerName: '', notes: '' })).toEqual({ providerName: '', notes: '' })
    expect(loanWriteSchema.parse({ name: 'N'.repeat(255) })).toEqual({ name: 'N'.repeat(255) })
    for (const value of [{}, { includeInNetWorth: 'false' }, { includeInNetWorth: null }, { providerName: null }, { notes: null }, { name: null }, { name: '' }, { name: 'N'.repeat(256) }, { providerName: 'P'.repeat(256) }, { notes: 'N'.repeat(10_001) }, { currency: 'EUR' }, { outstandingPrincipal: 1 }, { status: 'CLOSED' }, { currencyKey: 1 }, { maturityDate: '2030-01-01' }, { paymentDayOfMonth: 5 }, { originalPrincipal: 100 }, { rateType: 'FIXED' }, { paymentFrequency: 'MONTHLY' }]) {
      expect(loanWriteSchema.safeParse(value).success).toBe(false)
    }
  })

  it('widens editing to the financial terms web itself exposes on the shared form, still excluding currency', () => {
    // Basis points, matching what the read schema returns: 350 bps = 3.5%.
    expect(loanWriteSchema.parse({ type: 'MORTGAGE', openingPrincipalBalance: 1000, openingBalanceDate: '2026-01-01', regularPaymentAmount: 250, annualInterestRateBps: 350, termMonths: 60 })).toEqual({ type: 'MORTGAGE', openingPrincipalBalance: 1000, openingBalanceDate: '2026-01-01', regularPaymentAmount: 250, annualInterestRateBps: 350, termMonths: 60 })
    for (const value of [{ type: 'BAD' }, { openingPrincipalBalance: 0 }, { openingPrincipalBalance: -1 }, { openingBalanceDate: 'not-a-date' }, { regularPaymentAmount: 0 }, { annualInterestRateBps: -1 }, { annualInterestRateBps: 10_001 }, { annualInterestRateBps: 3.5 }, { termMonths: 0 }, { termMonths: 1.5 }]) {
      expect(loanWriteSchema.safeParse(value).success).toBe(false)
    }
  })

  it('pins the create endpoint and requires the full base field set', () => {
    expect(loanCreateEndpoint).toMatchObject({ method: 'POST', path: '/v1/loan', schema: loanResponseSchema, successStatuses: [201] })
    const full = { name: 'Home loan', type: 'MORTGAGE' as const, currencyKey: 1, openingPrincipalBalance: 250_000, openingBalanceDate: '2026-01-01', includeInNetWorth: true }
    expect(loanCreateWriteSchema.parse(full)).toEqual(full)
    expect(loanCreateWriteSchema.parse({ ...full, providerName: 'Wonder Bank', regularPaymentAmount: 1200, annualInterestRateBps: 450, termMonths: 360, notes: 'Fixed rate' }))
      .toEqual({ ...full, providerName: 'Wonder Bank', regularPaymentAmount: 1200, annualInterestRateBps: 450, termMonths: 360, notes: 'Fixed rate' })
    for (const missingKey of ['name', 'type', 'currencyKey', 'openingPrincipalBalance', 'openingBalanceDate', 'includeInNetWorth'] as const) {
      const { [missingKey]: _omit, ...incomplete } = full
      expect(loanCreateWriteSchema.safeParse(incomplete).success).toBe(false)
    }
    expect(loanCreateWriteSchema.safeParse({ ...full, currencyKey: 0 }).success).toBe(false)
    expect(loanCreateWriteSchema.safeParse({ ...full, unknownField: true }).success).toBe(false)
  })

  it('accepts actual nullable and omitted loan fields', () => {
    const parsed = loansResponseSchema.parse({ loans: [{ ...loanFixture, annualInterestRateBps: null, maturityDate: null, notes: undefined, originalPrincipal: null, paymentDayOfMonth: undefined, providerName: null, regularPaymentAmount: null, termMonths: null }] })
    expect(parsed.loans[0]).toMatchObject({ annualInterestRateBps: null, originalPrincipal: null, regularPaymentAmount: null })
    expect(loanResponseSchema.safeParse({ loan: loanFixture }).success).toBe(true)
  })

  it('validates nested repayment transactions and nullable transaction context', () => {
    expect(loanRepaymentsResponseSchema.safeParse({ repayments: [repaymentFixture, { ...repaymentFixture, loanRepaymentLinkKey: 22, notes: undefined, transaction: { transactionKey: 82, description: null, merchantName: undefined, settlementAmount: null, transactionDate: null } }] }).success).toBe(true)
  })

  it.each([
    ['unsafe loan id', { ...loanFixture, loanKey: Number.MAX_SAFE_INTEGER + 1 }],
    ['bad currency', { ...loanFixture, currency: { currencyKey: 1, code: 'eur' } }],
    ['nonfinite balance', { ...loanFixture, outstandingPrincipal: Infinity }],
    ['bad date', { ...loanFixture, openingBalanceDate: '01/01/2024' }],
    ['missing type', { ...loanFixture, type: undefined }],
    ['non-string status', { ...loanFixture, status: 1 }],
  ])('rejects loan with %s', (_label, value) => expect(loansResponseSchema.safeParse({ loans: [value] }).success).toBe(false))

  it('reads loan enum values this build does not know as a fallback and strips added fields', () => {
    const [loan] = loansResponseSchema.parse({ loans: [{
      ...loanFixture,
      type: 'CARD',
      status: 'OVERDUE',
      rateType: 'VARIABLE',
      paymentFrequency: 'WEEKLY',
      progressBasis: 'CURRENT_BALANCE',
      overviewTotal: 123,
    }] }).loans
    expect(loan).toMatchObject({ type: 'OTHER', status: 'UNKNOWN', rateType: 'UNKNOWN', paymentFrequency: 'UNKNOWN', progressBasis: 'UNKNOWN' })
    expect(loan).not.toHaveProperty('overviewTotal')
  })

  it.each([
    ['bad repayment id', { ...repaymentFixture, loanRepaymentLinkKey: 0 }],
    ['bad payment date', { ...repaymentFixture, paymentDate: 'June 5' }],
    ['nonfinite fee', { ...repaymentFixture, feeAmount: NaN }],
    ['missing allocation', { ...repaymentFixture, allocationSource: undefined }],
    ['bad transaction id', { ...repaymentFixture, transaction: { ...repaymentFixture.transaction, transactionKey: -1 } }],
    ['bad transaction date', { ...repaymentFixture, transaction: { ...repaymentFixture.transaction, transactionDate: '2026-06-05' } }],
  ])('rejects repayment with %s', (_label, value) => expect(loanRepaymentsResponseSchema.safeParse({ repayments: [value] }).success).toBe(false))

  it('keeps parsing repayments when the API adds fields or an allocation source', () => {
    const [repayment] = loanRepaymentsResponseSchema.parse({ repayments: [{ ...repaymentFixture, allocationSource: 'IMPORT', transaction: { ...repaymentFixture.transaction, currency: 'EUR' } }] }).repayments
    expect(repayment!.allocationSource).toBe('UNKNOWN')
    expect(repayment!.transaction).not.toHaveProperty('currency')
  })

  it('accepts only positive safe route ids', () => {
    expect(parseLoanId('7')).toBe(7)
    for (const value of ['0', '-1', '1.5', String(Number.MAX_SAFE_INTEGER + 1), ['7']]) expect(parseLoanId(value)).toBeNull()
    expect(() => createLoanEndpoint(0)).toThrow()
  })
})
