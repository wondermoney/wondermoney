import { buildLoanCreatePayload, type LoanCreateDraft } from './loan-create-model'

const draft: LoanCreateDraft = {
  name: ' Home loan ',
  type: 'MORTGAGE',
  currencyId: 1,
  openingPrincipalBalance: '250000',
  openingBalanceDate: '2026-01-01',
  includeInNetWorth: true,
}

describe('buildLoanCreatePayload', () => {
  it('trims text fields and coerces numeric strings into the write payload', () => {
    const result = buildLoanCreatePayload(draft)
    expect(result).toEqual({
      success: true,
      payload: {
        name: 'Home loan',
        type: 'MORTGAGE',
        currencyKey: 1,
        openingPrincipalBalance: 250_000,
        openingBalanceDate: '2026-01-01',
        includeInNetWorth: true,
      },
    })
  })

  it('omits optional fields entirely when left blank', () => {
    const result = buildLoanCreatePayload({ ...draft, providerName: '  ', regularPaymentAmount: '', annualInterestRateBps: undefined, termMonths: '  ', notes: '' })
    expect(result.success).toBe(true)
    const payload = result.success ? result.payload : null
    expect(payload).not.toHaveProperty('providerName')
    expect(payload).not.toHaveProperty('regularPaymentAmount')
    expect(payload).not.toHaveProperty('annualInterestRateBps')
    expect(payload).not.toHaveProperty('termMonths')
    expect(payload).not.toHaveProperty('notes')
  })

  it('includes trimmed optional fields and coerces their numeric values when provided', () => {
    const result = buildLoanCreatePayload({ ...draft, providerName: ' Wonder Bank ', regularPaymentAmount: '1200', annualInterestRateBps: '4.5', termMonths: '360', notes: ' Fixed rate ' })
    expect(result).toEqual({
      success: true,
      payload: {
        name: 'Home loan',
        type: 'MORTGAGE',
        currencyKey: 1,
        openingPrincipalBalance: 250_000,
        openingBalanceDate: '2026-01-01',
        includeInNetWorth: true,
        providerName: 'Wonder Bank',
        regularPaymentAmount: 1200,
        annualInterestRateBps: 450,
        termMonths: 360,
        notes: 'Fixed rate',
      },
    })
  })

  it('flags the exact field when the type or currency choice is missing, before schema validation', () => {
    const noType = buildLoanCreatePayload({ ...draft, type: null })
    expect(noType).toEqual({ success: false, invalidFields: new Set(['type']) })
    const noCurrency = buildLoanCreatePayload({ ...draft, currencyId: null })
    expect(noCurrency).toEqual({ success: false, invalidFields: new Set(['currencyId']) })
  })

  it('defers numeric and date validation to the write schema, flagging the specific invalid field', () => {
    expect(buildLoanCreatePayload({ ...draft, name: '' })).toEqual({ success: false, invalidFields: new Set(['name']) })
    expect(buildLoanCreatePayload({ ...draft, openingPrincipalBalance: '0' })).toEqual({ success: false, invalidFields: new Set(['openingPrincipalBalance']) })
    expect(buildLoanCreatePayload({ ...draft, openingPrincipalBalance: 'not-a-number' })).toEqual({ success: false, invalidFields: new Set(['openingPrincipalBalance']) })
    expect(buildLoanCreatePayload({ ...draft, openingBalanceDate: 'not-a-date' })).toEqual({ success: false, invalidFields: new Set(['openingBalanceDate']) })
    // 101% is out of range; 101 basis points (1.01%) is not — this fails on a
    // field with no UI mapping (annualInterestRateBps isn't in
    // LoanCreateField), so it surfaces as an empty invalid-field set rather
    // than a false positive on an unrelated field.
    expect(buildLoanCreatePayload({ ...draft, annualInterestRateBps: '101' })).toEqual({ success: false, invalidFields: new Set() })
    expect(buildLoanCreatePayload({ ...draft, termMonths: '0' })).toEqual({ success: false, invalidFields: new Set() })
  })
})
