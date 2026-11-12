import {
  createDeleteInstallmentPlanEndpoint,
  createInstallmentCommitmentsEndpoint,
  createInstallmentPlanDetailEndpoint,
  createInstallmentPlanEndpoint,
  createInstallmentPlansEndpoint,
  createInstallmentSuggestionsEndpoint,
  installmentCommitmentsResponseSchema,
  installmentPlanCreateSchema,
  installmentPlanDetailResponseSchema,
  installmentPlansResponseSchema,
  installmentSuggestionsResponseSchema,
  parseInstallmentPlanId,
  splitInstallmentCents,
  splitInstallments,
  suggestionLinks,
} from './installments-contract'
import { commitmentFixture, planDetailFixture, suggestionFixture } from './test-fixtures'

describe('installment plan endpoints', () => {
  it('scopes the reads to one card when asked and refuses an unsafe id', () => {
    expect(createInstallmentPlansEndpoint().path).toBe('/v1/installment-plans')
    expect(createInstallmentPlansEndpoint(7).path).toBe('/v1/installment-plans?accountId=7')
    expect(createInstallmentCommitmentsEndpoint(7).path).toBe('/v1/installment-plans/commitments?accountId=7')
    expect(createInstallmentSuggestionsEndpoint(7).path).toBe('/v1/installment-plans/suggestions?accountId=7')
    expect(createInstallmentPlanDetailEndpoint(11).path).toBe('/v1/installment-plans/11')
    expect(createInstallmentPlanEndpoint).toMatchObject({ method: 'POST', path: '/v1/installment-plans' })
    expect(createDeleteInstallmentPlanEndpoint(11)).toMatchObject({ method: 'DELETE', path: '/v1/installment-plans/11' })
    expect(() => createInstallmentPlansEndpoint(0)).toThrow()
    expect(() => createInstallmentPlanDetailEndpoint(-1)).toThrow()
  })

  it('reads a route id strictly', () => {
    expect(parseInstallmentPlanId('11')).toBe(11)
    expect(parseInstallmentPlanId('011')).toBeNull()
    expect(parseInstallmentPlanId('1.5')).toBeNull()
    expect(parseInstallmentPlanId(['11'])).toBeNull()
  })
})

describe('installment plan responses', () => {
  it('parses a plan with its schedule, dropping fields this build does not know', () => {
    const parsed = installmentPlanDetailResponseSchema.parse({ installmentPlan: { ...planDetailFixture, colour: 'red' } })
    expect(parsed.installmentPlan).not.toHaveProperty('colour')
    expect(parsed.installmentPlan.installments.map((row) => row.status)).toEqual(['paid', 'paid', 'unmatched', 'upcoming'])
    expect(parsed.installmentPlan.installments[0]).toMatchObject({ transactionKey: 501, postedAmount: 25, postedDate: '2026-09-05' })
  })

  it('parses a plan without the optional fields, and reads an unknown status as none', () => {
    const { unmatchedCount: _unmatched, nextInstallment: _next, categoryKey: _category, accountName: _name, ...plan } = planDetailFixture
    const installments: { installmentNumber: number; amount: number; scheduledDate: string; status: string | null }[] = plan.installments
      .map(({ installmentNumber, amount, scheduledDate, status }) => ({ installmentNumber, amount, scheduledDate, status }))
    installments[3] = { ...installments[3]!, status: 'skipped' }
    const parsed = installmentPlanDetailResponseSchema.parse({ installmentPlan: { ...plan, installments } })
    expect(parsed.installmentPlan.unmatchedCount).toBeUndefined()
    expect(parsed.installmentPlan.installments[3]?.status).toBeNull()
    expect(parsed.installmentPlan.installments[0]?.dueDate).toBeUndefined()
    expect(parsed.installmentPlan.nextInstallment).toBeUndefined()
  })

  it('parses the plans list, the commitments and the suggestions', () => {
    const { installments: _rows, ...plan } = planDetailFixture
    expect(installmentPlansResponseSchema.parse({ installmentPlans: [plan] }).installmentPlans).toHaveLength(1)
    expect(installmentCommitmentsResponseSchema.parse({ commitments: [commitmentFixture] }).commitments[0]).toMatchObject({ remainingAmount: 75, activePlanCount: 2 })
    expect(installmentCommitmentsResponseSchema.parse({ commitments: [{ ...commitmentFixture, nextInstallment: undefined }] }).commitments[0]?.nextInstallment).toBeUndefined()
    const [suggestion] = installmentSuggestionsResponseSchema.parse({ suggestions: [suggestionFixture] }).suggestions
    expect(suggestion?.transactions).toHaveLength(2)
  })

  it('rejects a plan whose amounts or dates are not what the contract says', () => {
    expect(installmentPlanDetailResponseSchema.safeParse({ installmentPlan: { ...planDetailFixture, totalAmount: '100' } }).success).toBe(false)
    expect(installmentPlanDetailResponseSchema.safeParse({ installmentPlan: { ...planDetailFixture, purchaseDate: '05/09/2026' } }).success).toBe(false)
  })
})

describe('creating a plan', () => {
  const base = { accountKey: 7, description: 'Laptop', purchaseDate: '2026-09-01', totalAmount: 1000, installmentCount: 12 }

  it('takes 2 to 120 installments of a positive total in whole cents', () => {
    expect(installmentPlanCreateSchema.safeParse(base).success).toBe(true)
    expect(installmentPlanCreateSchema.safeParse({ ...base, installmentCount: 1 }).success).toBe(false)
    expect(installmentPlanCreateSchema.safeParse({ ...base, installmentCount: 121 }).success).toBe(false)
    expect(installmentPlanCreateSchema.safeParse({ ...base, totalAmount: 0 }).success).toBe(false)
    expect(installmentPlanCreateSchema.safeParse({ ...base, totalAmount: 10.005 }).success).toBe(false)
    expect(installmentPlanCreateSchema.safeParse({ ...base, totalAmount: 10.07 }).success).toBe(true)
    expect(installmentPlanCreateSchema.safeParse({ ...base, totalAmount: 1_000_000_000.01 }).success).toBe(false)
    expect(installmentPlanCreateSchema.safeParse({ ...base, description: '  ' }).success).toBe(false)
    expect(installmentPlanCreateSchema.safeParse({ ...base, extra: true }).success).toBe(false)
  })

  it('accepts a suggestion with each posted row linked to the installment it was detected as', () => {
    expect(suggestionLinks(suggestionFixture)).toEqual([
      { transactionKey: 901, installmentNumber: 1 },
      { transactionKey: 902, installmentNumber: 2 },
    ])
    expect(installmentPlanCreateSchema.parse({ ...base, links: suggestionLinks(suggestionFixture) }).links).toHaveLength(2)
  })
})

describe('the installment split', () => {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

  it('gives each installment floor(total / count) cents and the last the remainder', () => {
    expect(splitInstallmentCents(10_000, 3)).toEqual([3333, 3333, 3334])
    expect(splitInstallments(100, 3)).toEqual([33.33, 33.33, 33.34])
    expect(splitInstallments(1000, 4)).toEqual([250, 250, 250, 250])
    expect(splitInstallments(0.1 + 0.2, 2)).toEqual([0.15, 0.15])
  })

  it('always adds up to the total exactly, in cents', () => {
    for (const [total, count] of [[100, 3], [999.99, 7], [0.05, 2], [12_345.67, 120], [1, 120], [250.1, 11]] as const) {
      const cents = splitInstallments(total, count).map((value) => Math.round(value * 100))
      expect(cents).toHaveLength(count)
      expect(sum(cents)).toBe(Math.round(total * 100))
      // Only the last one can differ from the rest.
      expect(new Set(cents.slice(0, -1)).size).toBeLessThanOrEqual(1)
      expect(cents.at(-1)!).toBeGreaterThanOrEqual(cents[0]!)
    }
  })

  it('splits nothing the API would refuse', () => {
    expect(splitInstallments(100, 1)).toEqual([])
    expect(splitInstallments(100, 121)).toEqual([])
    expect(splitInstallments(100, 2.5)).toEqual([])
    expect(splitInstallments(0, 3)).toEqual([])
    expect(splitInstallments(Number.NaN, 3)).toEqual([])
  })
})
