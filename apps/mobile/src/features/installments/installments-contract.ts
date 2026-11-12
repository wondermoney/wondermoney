import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Installment plans on a credit card (`/v1/installment-plans`). A plan stores its schedule as rows
 * of its own: a future installment is a projection, never a transaction, and never counted in a
 * balance. A row reads as `paid` once a posted transaction is linked to it.
 *
 * Amounts are positive magnitudes in the account's currency (what was or will be charged); dates
 * are calendar days (`YYYY-MM-DD`). Fields a screen can do without are optional, so a later API
 * that drops or renames one still parses.
 */

const positiveId = z.number().int().positive()
const money = z.number().finite()
const count = z.number().int().nonnegative()
const currencyCode = z.string().regex(/^[A-Z]{3}$/)
const day = z.iso.date()
/** A posted transaction's date: a calendar day, or an instant from a server that sends one. */
const postedDay = z.string().min(10)

export const MIN_INSTALLMENTS = 2
export const MAX_INSTALLMENTS = 120

export const INSTALLMENT_STATUSES = ['paid', 'upcoming', 'unmatched'] as const
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number]

export const installmentSchema = z.object({
  installmentNumber: positiveId,
  amount: money,
  scheduledDate: day,
  statementDate: day.nullish(),
  dueDate: day.nullish(),
  // A status this build does not know reads as null: the row shows no status rather than a wrong one.
  status: tolerantEnum(INSTALLMENT_STATUSES, null),
  transactionKey: positiveId.nullish(),
  postedAmount: money.nullish(),
  postedDate: postedDay.nullish(),
})

export const installmentPlanSchema = z.object({
  installmentPlanKey: positiveId,
  accountKey: positiveId,
  accountName: z.string().nullish(),
  currency: currencyCode,
  description: z.string().max(1000),
  purchaseDate: day,
  totalAmount: money,
  installmentCount: positiveId,
  categoryKey: positiveId.nullish(),
  paidCount: count,
  paidAmount: money,
  remainingCount: count,
  remainingAmount: money,
  unmatchedCount: count.optional(),
  nextInstallment: installmentSchema.nullish(),
})

export const installmentPlanDetailSchema = installmentPlanSchema.extend({
  installments: z.array(installmentSchema),
})

export const installmentCommitmentSchema = z.object({
  accountKey: positiveId,
  accountName: z.string().nullish(),
  currency: currencyCode,
  remainingAmount: money,
  remainingCount: count,
  activePlanCount: count,
  nextInstallment: z.object({
    amount: money,
    date: day,
    installmentPlanKey: positiveId,
    installmentNumber: positiveId,
    installmentCount: positiveId,
    description: z.string().max(1000),
  }).nullish(),
})

export const installmentSuggestionSchema = z.object({
  key: z.string().min(1),
  accountKey: positiveId,
  accountName: z.string().nullish(),
  currency: currencyCode,
  description: z.string().max(1000),
  installmentCount: positiveId,
  installmentAmount: money,
  totalAmount: money,
  purchaseDate: day,
  transactions: z.array(z.object({
    transactionKey: positiveId,
    installmentNumber: positiveId,
    amount: money,
    transactionDate: postedDay,
    description: z.string().nullish(),
  })),
})

export const installmentPlansResponseSchema = z.object({ installmentPlans: z.array(installmentPlanSchema) })
export const installmentCommitmentsResponseSchema = z.object({ commitments: z.array(installmentCommitmentSchema) })
export const installmentSuggestionsResponseSchema = z.object({ suggestions: z.array(installmentSuggestionSchema) })
export const installmentPlanDetailResponseSchema = z.object({ installmentPlan: installmentPlanDetailSchema })

export type InstallmentDto = z.infer<typeof installmentSchema>
export type InstallmentPlanDto = z.infer<typeof installmentPlanSchema>
export type InstallmentPlanDetailDto = z.infer<typeof installmentPlanDetailSchema>
export type InstallmentCommitmentDto = z.infer<typeof installmentCommitmentSchema>
export type InstallmentSuggestionDto = z.infer<typeof installmentSuggestionSchema>

export const isValidInstallmentPlanId = (value: number): boolean => Number.isSafeInteger(value) && value > 0

export function parseInstallmentPlanId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isValidInstallmentPlanId(parsed) ? parsed : null
}

const accountQuery = (accountId: number | undefined): string => {
  if (accountId === undefined) return ''
  if (!isValidInstallmentPlanId(accountId)) throw new Error('A positive safe account id is required.')
  return `?accountId=${accountId}`
}

/** The plans the reader can see, newest purchase first; `accountId` keeps one card's. */
export const createInstallmentPlansEndpoint = (accountId?: number) => readEndpoint({
  method: 'GET',
  path: `/v1/installment-plans${accountQuery(accountId)}`,
  schema: installmentPlansResponseSchema,
})

/** What is still to be charged, one row per account that has a plan. */
export const createInstallmentCommitmentsEndpoint = (accountId?: number) => readEndpoint({
  method: 'GET',
  path: `/v1/installment-plans/commitments${accountQuery(accountId)}`,
  schema: installmentCommitmentsResponseSchema,
})

/** Posted rows that look like installments ("3/12") of a purchase with no plan yet. Never applied on their own. */
export const createInstallmentSuggestionsEndpoint = (accountId?: number) => readEndpoint({
  method: 'GET',
  path: `/v1/installment-plans/suggestions${accountQuery(accountId)}`,
  schema: installmentSuggestionsResponseSchema,
})

export function createInstallmentPlanDetailEndpoint(planId: number) {
  if (!isValidInstallmentPlanId(planId)) throw new Error('A positive safe installment plan id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/installment-plans/${planId}`,
    schema: installmentPlanDetailResponseSchema,
  })
}

export const createInstallmentPlanEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/installment-plans',
  schema: installmentPlanDetailResponseSchema,
})

/** 204 with no body; the posted transactions stay, unlinked. */
export function createDeleteInstallmentPlanEndpoint(planId: number) {
  if (!isValidInstallmentPlanId(planId)) throw new Error('A positive safe installment plan id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/installment-plans/${planId}`,
    // The body is never read, so a server that answers 200 with one is not a contract failure.
    schema: z.unknown(),
  })
}

const centsOf = (value: number): number => Math.round(value * 100)

/** The largest purchase total the API accepts, in the account's currency. */
export const MAX_PLAN_TOTAL = 1_000_000_000

/** A positive amount in whole cents: the API splits a plan in cents. */
const planTotal = z.number().finite().positive().max(MAX_PLAN_TOTAL).refine(
  (value) => Math.abs(value * 100 - centsOf(value)) < 1e-6,
  'At most two decimal places.',
)

export const installmentPlanCreateSchema = z.object({
  accountKey: positiveId,
  description: z.string().trim().min(1).max(255),
  purchaseDate: day,
  totalAmount: planTotal,
  installmentCount: z.number().int().min(MIN_INSTALLMENTS).max(MAX_INSTALLMENTS),
  categoryKey: positiveId.nullable().optional(),
  links: z.array(z.object({ transactionKey: positiveId, installmentNumber: positiveId }).strict()).optional(),
}).strict()

export type InstallmentPlanCreate = z.infer<typeof installmentPlanCreateSchema>

/** The links that accept a suggestion: each of its posted rows on the installment it was detected as. */
export const suggestionLinks = (suggestion: Pick<InstallmentSuggestionDto, 'transactions'>): NonNullable<InstallmentPlanCreate['links']> => (
  suggestion.transactions.map(({ transactionKey, installmentNumber }) => ({ transactionKey, installmentNumber }))
)

/**
 * The API's split of a plan, in cents: each installment is `floor(total / count)` cents and the
 * last takes the remainder, so the installments add up to the total exactly. Empty for a count
 * or total the API would refuse.
 */
export function splitInstallmentCents(totalCents: number, installmentCount: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return []
  if (!Number.isInteger(installmentCount) || installmentCount < MIN_INSTALLMENTS || installmentCount > MAX_INSTALLMENTS) return []
  const each = Math.floor(totalCents / installmentCount)
  const last = totalCents - each * (installmentCount - 1)
  return Array.from({ length: installmentCount }, (_, index) => (index === installmentCount - 1 ? last : each))
}

/** `splitInstallmentCents` for an amount in currency units (12.34), returned in currency units. */
export function splitInstallments(totalAmount: number, installmentCount: number): number[] {
  if (!Number.isFinite(totalAmount)) return []
  return splitInstallmentCents(centsOf(totalAmount), installmentCount).map((cents) => cents / 100)
}
