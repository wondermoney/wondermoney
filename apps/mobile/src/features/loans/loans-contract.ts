import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

const positiveSafeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const finiteMoney = z.number().finite()
const optionalNullableMoney = finiteMoney.nullable().optional()
const optionalNullableString = z.string().nullable().optional()
// MikroORM may serialize SQL date columns as either date-only or midnight ISO timestamps.
const date = z.union([z.iso.date(), z.iso.datetime()])
const optionalNullableDate = date.nullable().optional()

export const loanTypeSchema = z.enum(['AUTO_LOAN', 'MORTGAGE', 'OTHER', 'PERSONAL_LOAN', 'STUDENT_LOAN'])
export const loanStatusSchema = z.enum(['ACTIVE', 'CLOSED', 'PAID_OFF'])
export const loanPaymentFrequencySchema = z.enum(['MONTHLY'])
export const loanRateTypeSchema = z.enum(['FIXED', 'UNKNOWN'])
export const loanAllocationSourceSchema = z.enum(['AMORTIZATION_ESTIMATE', 'AUTO_MATCHED', 'MANUAL'])

export const loanSchema = z.object({
  annualInterestRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
  loanKey: positiveSafeId,
  currency: z.object({
    code: z.string().regex(/^[A-Z]{3}$/),
    currencyKey: positiveSafeId,
  }).strict(),
  includeInNetWorth: z.boolean(),
  maturityDate: optionalNullableDate,
  name: z.string().min(1),
  nextPaymentDate: z.iso.datetime().nullable(),
  notes: optionalNullableString,
  openingBalanceDate: date,
  openingPrincipalBalance: finiteMoney,
  originalPrincipal: optionalNullableMoney,
  outstandingPrincipal: finiteMoney,
  paymentDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  paymentFrequency: loanPaymentFrequencySchema,
  progressBasis: z.enum(['OPENING_BALANCE', 'ORIGINAL_PRINCIPAL']),
  progressPercentage: z.number().finite(),
  providerName: optionalNullableString,
  rateType: loanRateTypeSchema,
  regularPaymentAmount: optionalNullableMoney,
  remainingTermMonthsEstimated: z.number().int().finite().nullable(),
  status: loanStatusSchema,
  termMonths: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  type: loanTypeSchema,
}).strict()

export const loansResponseSchema = z.object({ loans: z.array(loanSchema) }).strict()
export const loanResponseSchema = z.object({ loan: loanSchema }).strict()

// Fields the API's PATCH /v1/loan/:id also accepts (baseLoanSchema.partial()) but that
// mobile deliberately does not expose for editing an existing loan: currencyKey (changing
// the currency of a loan with recorded history is not a safe relabel), maturityDate,
// paymentDayOfMonth, originalPrincipal, status, rateType, paymentFrequency — web's own edit
// form doesn't render inputs for these either, so this isn't a mobile-specific gap.
const loanEditableFieldsSchema = z.object({
  // Basis points, matching `loanSchema` above — the previous 0..100 bound
  // silently described a percentage and disagreed with what the API returns.
  annualInterestRateBps: z.number().int().min(0).max(10_000).optional(),
  includeInNetWorth: z.boolean().optional(),
  name: z.string().min(1).max(255).optional(),
  notes: z.string().max(10_000).optional(),
  openingBalanceDate: date.optional(),
  openingPrincipalBalance: finiteMoney.refine((value) => value > 0).optional(),
  providerName: z.string().max(255).optional(),
  regularPaymentAmount: finiteMoney.refine((value) => value > 0).optional(),
  termMonths: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  type: loanTypeSchema.optional(),
})

export const loanWriteSchema = loanEditableFieldsSchema
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one writable loan field is required.' })

export type LoanWrite = z.input<typeof loanWriteSchema>

export const loanCreateWriteSchema = loanEditableFieldsSchema
  .extend({
    currencyKey: positiveSafeId,
    includeInNetWorth: z.boolean(),
    name: z.string().min(1).max(255),
    openingBalanceDate: date,
    openingPrincipalBalance: finiteMoney.refine((value) => value > 0),
    type: loanTypeSchema,
  })
  .strict()

export type LoanCreateWrite = z.input<typeof loanCreateWriteSchema>

export const loanRepaymentTransactionSchema = z.object({
  description: optionalNullableString,
  merchantName: optionalNullableString,
  settlementAmount: optionalNullableMoney,
  transactionDate: z.iso.datetime().nullable().optional(),
  transactionKey: positiveSafeId,
}).strict()

export const loanRepaymentSchema = z.object({
  allocationSource: loanAllocationSourceSchema,
  loanRepaymentLinkKey: positiveSafeId,
  feeAmount: finiteMoney,
  interestAmount: finiteMoney,
  needsReview: z.boolean(),
  notes: optionalNullableString,
  paymentDate: date,
  principalAmount: finiteMoney,
  totalPaymentAmount: finiteMoney,
  transaction: loanRepaymentTransactionSchema,
}).strict()

export const loanRepaymentsResponseSchema = z.object({ repayments: z.array(loanRepaymentSchema) }).strict()

export const loanRepaymentAllocationSchema = z.object({
  feeAmount: z.number().finite().nonnegative(),
  interestAmount: z.number().finite().nonnegative(),
  principalAmount: z.number().finite().positive(),
  totalPaymentAmount: z.number().finite().positive(),
}).strict().superRefine((value, context) => {
  const componentTotal = +(value.principalAmount + value.interestAmount + value.feeAmount).toFixed(2)
  if (Math.abs(componentTotal - value.totalPaymentAmount) > 0.01) {
    context.addIssue({ code: 'custom', message: 'Allocation components must reconcile to the total.', path: ['totalPaymentAmount'] })
  }
})

const suggestedAllocationSchema = z.object({
  feeAmount: z.number().finite().nonnegative(),
  interestAmount: z.number().finite().nonnegative(),
  principalAmount: z.number().finite().nonnegative(),
  totalPaymentAmount: z.number().finite().positive(),
  needsReview: z.boolean(),
  negativeAmortization: z.boolean(),
}).strict().superRefine((value, context) => {
  const componentTotal = +(value.principalAmount + value.interestAmount + value.feeAmount).toFixed(2)
  if (Math.abs(componentTotal - value.totalPaymentAmount) > 0.01) context.addIssue({ code: 'custom', message: 'Suggested allocation does not reconcile.', path: ['totalPaymentAmount'] })
})

export const loanRepaymentCandidateSchema = z.object({
  amount: z.number().finite().positive(),
  candidateScore: z.number().finite(),
  confidence: z.enum(['HIGH', 'LOW', 'MEDIUM']),
  outstandingPrincipal: z.number().finite(),
  reasons: z.array(z.string()),
  suggestedAllocation: suggestedAllocationSchema,
  transaction: loanRepaymentTransactionSchema,
}).strict()

export const loanRepaymentCandidatesResponseSchema = z.object({
  candidates: z.array(loanRepaymentCandidateSchema),
}).strict()

// Mutation responses include these relation fields because the current controller serializes
// the newly persisted entity as well as the stable repayment fields used by the app.
export const loanRepaymentMutationResponseSchema = z.object({
  repayment: z.object({
    allocationSource: loanAllocationSourceSchema,
    loanKey: z.unknown(),
    loanRepaymentLinkKey: positiveSafeId,
    feeAmount: finiteMoney,
    interestAmount: finiteMoney,
    linkedByAppuserKey: z.unknown(),
    needsReview: z.boolean(),
    notes: optionalNullableString,
    paymentDate: date,
    principalAmount: finiteMoney,
    tenantKey: z.unknown(),
    totalPaymentAmount: finiteMoney,
    transaction: loanRepaymentTransactionSchema,
    transactionKey: z.unknown(),
  }).strict(),
}).strict()

export type LoanType = z.infer<typeof loanTypeSchema>
export type LoanDto = z.infer<typeof loanSchema>
export type LoanRepaymentDto = z.infer<typeof loanRepaymentSchema>
export type LoanRepaymentCandidateDto = z.infer<typeof loanRepaymentCandidateSchema>
export type LoanRepaymentAllocation = z.infer<typeof loanRepaymentAllocationSchema>

export const loansEndpoint = readEndpoint({ method: 'GET', path: '/v1/loan', schema: loansResponseSchema })

export const loanCreateEndpoint = writeEndpoint({ method: 'POST', path: '/v1/loan', schema: loanResponseSchema, successStatuses: [201] })

export const isValidLoanId = (value: number): boolean => Number.isSafeInteger(value) && value > 0

export function parseLoanId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isValidLoanId(parsed) ? parsed : null
}

export function createLoanEndpoint(loanId: number) {
  if (!isValidLoanId(loanId)) throw new Error('A positive safe loan id is required.')
  return readEndpoint({ method: 'GET', path: `/v1/loan/${loanId}`, schema: loanResponseSchema })
}

export function createLoanWriteEndpoint(loanId: number) {
  if (!isValidLoanId(loanId)) throw new Error('A positive safe loan id is required.')
  return writeEndpoint({ method: 'PATCH', path: `/v1/loan/${loanId}`, schema: loanResponseSchema })
}

export function createLoanRepaymentsEndpoint(loanId: number) {
  if (!isValidLoanId(loanId)) throw new Error('A positive safe loan id is required.')
  return readEndpoint({ method: 'GET', path: `/v1/loan/${loanId}/repayments`, schema: loanRepaymentsResponseSchema })
}

export function createLoanRepaymentCandidatesEndpoint(loanId: number) {
  if (!isValidLoanId(loanId)) throw new Error('A positive safe loan id is required.')
  return readEndpoint({ method: 'GET', path: `/v1/loan/${loanId}/repayment-candidates`, schema: loanRepaymentCandidatesResponseSchema })
}

export function createLinkLoanRepaymentEndpoint(loanId: number, transactionKey: number) {
  if (!isValidLoanId(loanId) || !positiveSafeId.safeParse(transactionKey).success) throw new Error('Positive persisted loan and transaction ids are required.')
  return writeEndpoint({ method: 'POST', path: `/v1/loan/${loanId}/repayments/link?transactionKey=${transactionKey}`, schema: loanRepaymentMutationResponseSchema, successStatuses: [201] })
}

export function createUpdateLoanRepaymentEndpoint(loanId: number, repaymentLinkId: number) {
  if (!isValidLoanId(loanId) || !positiveSafeId.safeParse(repaymentLinkId).success) throw new Error('Positive persisted loan and repayment ids are required.')
  return writeEndpoint({ method: 'PATCH', path: `/v1/loan/${loanId}/repayments/${repaymentLinkId}`, schema: loanRepaymentMutationResponseSchema, successStatuses: [200] })
}

export function createDeleteLoanRepaymentEndpoint(loanId: number, repaymentLinkId: number) {
  if (!isValidLoanId(loanId) || !positiveSafeId.safeParse(repaymentLinkId).success) throw new Error('Positive persisted loan and repayment ids are required.')
  return writeEndpoint({ method: 'DELETE', path: `/v1/loan/${loanId}/repayments/${repaymentLinkId}`, schema: z.undefined(), successStatuses: [204] })
}
