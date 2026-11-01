import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

const recurringIdSchema = z.number().int().positive().safe()
const positiveId = recurringIdSchema
const finiteMoney = z.number().finite()
const optionalMoney = finiteMoney.nullish()
const optionalDate = z.iso.datetime().nullish()

const RECURRING_TYPES = ['bill', 'subscription'] as const
const RECURRING_CADENCES = ['biweekly', 'monthly', 'quarterly', 'weekly', 'yearly'] as const
const RECURRING_AMOUNT_TYPES = ['fixed', 'variable'] as const

// Write side: the metadata body only ever carries values this build knows.
const recurringTypeSchema = z.enum(RECURRING_TYPES)
const recurringCadenceSchema = z.enum(RECURRING_CADENCES)
const recurringAmountTypeSchema = z.enum(RECURRING_AMOUNT_TYPES)

// Read side: a value this build doesn't know reads as 'unknown' and renders as "unavailable" on
// that one row instead of failing the whole recurring list.
const recurringStatusSchema = tolerantEnum(['candidate', 'confirmed', 'dismissed', 'paused', 'ended'], 'unknown')
const recurringSourceSchema = tolerantEnum(['detected', 'user_created'], 'unknown')
const recurringTypeResponseSchema = tolerantEnum(RECURRING_TYPES, 'unknown')
const recurringCadenceResponseSchema = tolerantEnum(RECURRING_CADENCES, 'unknown')
const recurringAmountTypeResponseSchema = tolerantEnum(RECURRING_AMOUNT_TYPES, 'unknown')

const accountRelationSchema = z.object({ accountKey: positiveId })
const currencySchema = z.object({ currencyKey: positiveId, code: z.string().regex(/^[A-Z]{3}$/) })
const categorySchema = z.object({
  categoryKey: positiveId,
  name: z.string().min(1).max(255),
  isSystemCategory: z.boolean(),
  bgColor: z.string().nullish(),
  textColor: z.string().nullish(),
  icon: z.string().nullish(),
})

export const recurringItemSchema = z.object({
  recurringSeriesKey: positiveId,
  type: recurringTypeResponseSchema,
  status: recurringStatusSchema,
  source: recurringSourceSchema,
  confidenceScore: z.number().finite().min(0).max(100),
  displayName: z.string().min(1).max(255),
  normalizedMerchantKey: z.string().min(1).max(255),
  cadence: recurringCadenceResponseSchema,
  cadenceConfidence: z.number().finite().min(0).max(100),
  amountType: recurringAmountTypeResponseSchema,
  expectedAmount: optionalMoney,
  expectedAmountMin: optionalMoney,
  expectedAmountMax: optionalMoney,
  averageAmount: optionalMoney,
  lastAmount: optionalMoney,
  nextExpectedAt: optionalDate,
  lastSeenAt: optionalDate,
  occurrenceCount: z.number().int().nonnegative(),
  accountKey: accountRelationSchema.nullish(),
  category: categorySchema.nullish(),
  currency: currencySchema.nullish(),
})

export const recurringItemsResponseSchema = z.object({ items: z.array(recurringItemSchema) })

const summaryTotalsSchema = z.object({
  billMaxTotal: finiteMoney,
  billMinTotal: finiteMoney,
  count: z.number().int().nonnegative(),
  fixedTotal: finiteMoney,
  monthlyMaxTotal: finiteMoney,
  monthlyMinTotal: finiteMoney,
  monthlyTotal: finiteMoney,
  subscriptionMaxTotal: finiteMoney,
  subscriptionMinTotal: finiteMoney,
  variableMaxTotal: finiteMoney,
  variableMinTotal: finiteMoney,
})

export const recurringSummarySchema = z.object({
  billMaxTotal: finiteMoney,
  billMinTotal: finiteMoney,
  currencyTotals: z.record(z.string().min(1), summaryTotalsSchema),
  detectedIncludedCount: z.number().int().nonnegative(),
  fixedTotal: finiteMoney,
  lastDetectedAt: optionalDate,
  monthlyMaxTotal: finiteMoney,
  monthlyMinTotal: finiteMoney,
  monthlyTotal: finiteMoney,
  needsReviewCount: z.number().int().nonnegative(),
  subscriptionMaxTotal: finiteMoney,
  subscriptionMinTotal: finiteMoney,
  variableMaxTotal: finiteMoney,
  variableMinTotal: finiteMoney,
})

export type RecurringItemDto = z.infer<typeof recurringItemSchema>
export type RecurringSummaryDto = z.infer<typeof recurringSummarySchema>

export const recurringMetadataSchema = z.object({
  amountType: recurringAmountTypeSchema.optional(),
  cadence: recurringCadenceSchema.optional(),
  categoryKey: positiveId.nullable().optional(),
  displayName: z.string().min(1).max(255).optional(),
  expectedAmount: z.number().finite().nonnegative().nullable().optional(),
  expectedAmountMax: z.number().finite().nonnegative().nullable().optional(),
  expectedAmountMin: z.number().finite().nonnegative().nullable().optional(),
  type: recurringTypeSchema.optional(),
}).strict().refine(
  (body) => body.expectedAmountMin == null || body.expectedAmountMax == null || body.expectedAmountMin <= body.expectedAmountMax,
  { message: 'Minimum amount must not exceed maximum amount.', path: ['expectedAmountMin'] },
)

export type RecurringMetadataInput = z.infer<typeof recurringMetadataSchema>

// Mirrors web's onRestore, which reuses the update endpoint with `status: 'candidate'` rather than
// a dedicated restore route (see recurring-client.tsx handleRecurringAction's "restore" case).
export const recurringRestoreSchema = z.object({ status: z.literal('candidate') }).strict()

const detectionCountSchema = z.number().int().nonnegative().safe()
export const recurringDetectionResponseSchema = z.object({
  created: detectionCountSchema,
  updated: detectionCountSchema,
  skipped: detectionCountSchema,
})
export type RecurringDetectionResult = z.infer<typeof recurringDetectionResponseSchema>

const emptyResponseSchema = z.undefined()
export const createConfirmRecurringEndpoint = (id: number) => {
  recurringIdSchema.parse(id)
  return writeEndpoint({ method: 'POST', path: `/v1/recurring/${id}/confirm`, schema: emptyResponseSchema })
}
export const createDismissRecurringEndpoint = (id: number) => {
  recurringIdSchema.parse(id)
  return writeEndpoint({ method: 'POST', path: `/v1/recurring/${id}/dismiss`, schema: emptyResponseSchema })
}
export const createUpdateRecurringEndpoint = (id: number) => {
  recurringIdSchema.parse(id)
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/recurring/${id}`,
    schema: z.object({ recurringSeries: recurringItemSchema }),
  })
}

export const recurringDetectionEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/recurring/detect',
  schema: recurringDetectionResponseSchema,
})

export const recurringItemsEndpoint = readEndpoint({ method: 'GET', path: '/v1/recurring', schema: recurringItemsResponseSchema })
export const recurringSummaryEndpoint = readEndpoint({ method: 'GET', path: '/v1/recurring/summary', schema: recurringSummarySchema })
