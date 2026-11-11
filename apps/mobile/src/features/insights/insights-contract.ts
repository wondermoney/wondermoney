import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'

const severitySchema = z.enum(['critical', 'info', 'warning'])
const periodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)

const spendingFactsSchema = z.object({
  baselineAmount: z.string(),
  categoryKey: z.number().int(),
  categoryKeys: z.array(z.number().int()),
  categoryName: z.string(),
  currency: z.string(),
  currentAmount: z.string(),
  daysElapsed: z.number().int().nonnegative(),
  deviationPercent: z.string(),
  direction: z.enum(['above', 'below']),
  fromDate: z.string(),
  toDate: z.string(),
})

const budgetFactsSchema = z.object({
  amountBudgeted: z.string(),
  amountSpent: z.string(),
  budgetKey: z.number().int().positive(),
  budgetName: z.string(),
  budgetTemplateCategoryKey: z.number().int().positive(),
  categoryKey: z.number().int(),
  categoryName: z.string(),
  currencyCode: z.string(),
  daysElapsed: z.number().int().nonnegative(),
  daysInMonth: z.number().int().positive(),
  elapsedPercent: z.string(),
  overBy: z.string(),
  parentCategoryName: z.string().nullable(),
  projectedAmount: z.string(),
})

export const insightSchema = z.discriminatedUnion('type', [
  z.object({
    facts: spendingFactsSchema,
    id: z.string().min(1),
    period: periodSchema,
    severity: severitySchema,
    type: z.literal('spending_vs_normal'),
  }),
  z.object({
    facts: budgetFactsSchema,
    id: z.string().min(1),
    period: periodSchema,
    severity: severitySchema,
    type: z.literal('budget_pace'),
  }),
])

export const insightsResponseSchema = z.object({ insights: z.array(insightSchema) })

export type InsightDto = z.infer<typeof insightSchema>
export type SpendingVsNormalFactsDto = z.infer<typeof spendingFactsSchema>
export type BudgetPaceFactsDto = z.infer<typeof budgetFactsSchema>

/** `month` is `YYYY-MM`; omitted means the current month. */
export function createInsightsEndpoint(month?: string) {
  return readEndpoint({
    method: 'GET',
    path: month ? `/v1/insights?month=${encodeURIComponent(month)}` : '/v1/insights',
    schema: insightsResponseSchema,
  })
}
