import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

const finiteNullable = z.number().finite().nullable()

const goalStatusSchema = z.enum(['active', 'archived', 'completed', 'paused'])
const goalSummaryStatusSchema = z.enum(['behind', 'funded', 'on_track', 'paused'])

const accountLinksSchema = z.array(z.object({
  goalAccountLinkKey: z.number().int().positive(),
  accountKey: z.object({
    accountKey: z.number().int().positive(),
    accountName: z.string().nullable(),
  }),
}))

export const goalSummarySchema = z.object({
  assignedThisMonth: z.number().finite(),
  availableAmount: z.number().finite(),
  fundedHistorically: z.number().finite(),
  monthlyShortfall: finiteNullable,
  progressPercentage: z.number().finite(),
  remainingToTarget: z.number().finite(),
  requiredMonthlyContribution: finiteNullable,
  spentAmount: z.number().finite(),
  status: goalSummaryStatusSchema,
})

export const goalListItemSchema = z.object({
  accountLinks: accountLinksSchema,
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  goalKey: z.number().int().positive(),
  monthlyContributionTarget: finiteNullable,
  name: z.string(),
  priority: z.number().int(),
  status: goalStatusSchema,
  summary: goalSummarySchema,
  targetAmount: z.number().finite(),
  targetDate: z.iso.datetime().nullable(),
})

export const goalsResponseSchema = z.object({ goals: z.array(goalListItemSchema) })

export type GoalListItemDto = z.infer<typeof goalListItemSchema>
export type GoalsResponseDto = z.infer<typeof goalsResponseSchema>

export const goalDetailSchema = goalListItemSchema.omit({ summary: true }).extend({
  // Optional entity properties are omitted by JSON serialization when unset.
  monthlyContributionTarget: finiteNullable.optional().transform((value) => value ?? null),
})
export const goalDetailResponseSchema = z.object({
  goal: goalDetailSchema,
  summary: goalSummarySchema,
})

export const goalActivityTypeSchema = z.enum([
  'archived',
  'assigned',
  'completed',
  'goal_created',
  'goal_updated',
  'manual_adjustment',
  'moved_in',
  'moved_out',
  'paused',
  'resumed',
  'spent_from_goal',
  'transaction_funding_reversed',
])

const activityCurrencySchema = z.union([
  z.number().int().positive(),
  z.object({
    code: z.string().regex(/^[A-Z]{3}$/).optional(),
    currencyKey: z.number().int().positive().optional(),
  }).refine((currency) => currency.code !== undefined || currency.currencyKey !== undefined),
]).nullable().optional()

export const goalActivitySchema = z.object({
  goalActivityKey: z.number().int().positive(),
  type: goalActivityTypeSchema,
  amount: finiteNullable.optional(),
  occurredAt: z.iso.datetime(),
  note: z.string().nullable().optional(),
  currencyKey: activityCurrencySchema,
}).transform(({ currencyKey, ...activity }) => ({
  ...activity,
  currencyCode: typeof currencyKey === 'object' && currencyKey !== null ? currencyKey.code : undefined,
}))

export const goalActivityResponseSchema = z.object({
  activities: z.array(goalActivitySchema),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0).max(100000),
  total: z.number().int().nonnegative(),
})

export type GoalDetailDto = z.infer<typeof goalDetailSchema>
export type GoalDetailResponseDto = z.infer<typeof goalDetailResponseSchema>
export type GoalActivityDto = z.infer<typeof goalActivitySchema>
export type GoalActivityResponseDto = z.infer<typeof goalActivityResponseSchema>

const positiveMoneySchema = z.number().finite().positive().refine((value) => (
  Math.round(value * 10000) / 10000 === value
), 'Money supports at most four fractional digits.')

const futureGoalDateSchema = z.iso.datetime().refine((value) => new Date(value).getTime() > Date.now(), {
  message: 'Target date must be in the future.',
})

export const goalCreateWriteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  targetAmount: positiveMoneySchema,
  description: z.string().max(500).optional(),
  monthlyContributionTarget: positiveMoneySchema.optional(),
  targetDate: futureGoalDateSchema.optional(),
}).strict()

export type GoalCreateWrite = z.infer<typeof goalCreateWriteSchema>

export type GoalCreateField = 'name' | 'target' | 'description' | 'monthly' | 'date'

const GOAL_ZOD_FIELD_TO_UI_FIELD: Record<string, GoalCreateField> = {
  description: 'description',
  monthlyContributionTarget: 'monthly',
  name: 'name',
  targetAmount: 'target',
  targetDate: 'date',
}

/** A field the user typed something into but couldn't be parsed (e.g. text
 * in the amount field) never reaches the schema at all — it's dropped from
 * the candidate object before `safeParse` runs, since an omitted optional
 * field and an invalid one look identical to zod. Those need their own
 * check; only what actually reaches the schema can rely on zod's issues. */
export function invalidGoalCreateFields(draft: {
  name: string
  targetAmount: number | null
  monthlyRaw: string
  monthlyAmount: number | null | undefined
  targetDateRaw: string
  targetDate: string | null | undefined
  candidate: Record<string, unknown>
}): ReadonlySet<GoalCreateField> {
  const fields = new Set<GoalCreateField>()
  if (draft.targetAmount === null) fields.add('target')
  if (draft.monthlyRaw.trim() && draft.monthlyAmount === null) fields.add('monthly')
  if (draft.targetDateRaw.trim() && draft.targetDate === null) fields.add('date')

  const parsed = goalCreateWriteSchema.safeParse(draft.candidate)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const zodField = issue.path[0]
      const uiField = typeof zodField === 'string' ? GOAL_ZOD_FIELD_TO_UI_FIELD[zodField] : undefined
      if (uiField) fields.add(uiField)
    }
  }
  return fields
}

const goalCreateResponseSchema = z.object({
  goal: z.object({ goalKey: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).passthrough(),
}).transform(({ goal }) => ({ goalId: goal.goalKey }))

export const createGoalEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/goals',
  schema: goalCreateResponseSchema,
  successStatuses: [201],
})

export function parseGoalTargetDate(value: string, now = new Date()): string | null {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const date = new Date(`${trimmed}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed || date.getTime() <= now.getTime()) return null
  return date.toISOString()
}

export const goalMetadataWriteSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  targetAmount: positiveMoneySchema.optional(),
  monthlyContributionTarget: positiveMoneySchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one changed field is required.')

export type GoalMetadataWrite = z.infer<typeof goalMetadataWriteSchema>

export const goalReserveWriteSchema = z.object({ amount: positiveMoneySchema }).strict()
export type GoalReserveWrite = z.infer<typeof goalReserveWriteSchema>

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parseLocalizedGoalMoney(value: string, locale: string): number | null {
  // Hermes does not implement NumberFormat.prototype.formatToParts on all
  // supported React Native runtimes. Infer the separators from the formatted
  // sample instead of calling that optional API.
  const sample = new Intl.NumberFormat(locale).format(12345.6)
  const separators = sample.match(/[^0-9]/gu) ?? []
  const decimal = separators[separators.length - 1] ?? '.'
  const group = separators.length > 1 ? separators[0] : undefined
  const decimalPattern = escapeRegex(decimal)
  const groupPattern = group && /\s/u.test(group) ? '[\\s\\u00a0\\u202f]' : group ? escapeRegex(group) : null
  const integerPattern = groupPattern ? `(?:\\d+|\\d{1,3}(?:${groupPattern}\\d{3})+)` : '\\d+'
  const trimmed = value.trim()
  if (!new RegExp(`^${integerPattern}(?:${decimalPattern}\\d{1,4})?$`, 'u').test(trimmed)) return null
  const withoutGroups = groupPattern ? trimmed.replace(new RegExp(groupPattern, 'gu'), '') : trimmed
  const normalized = decimal === '.' ? withoutGroups : withoutGroups.replace(decimal, '.')
  const amount = Number(normalized)
  return goalReserveWriteSchema.safeParse({ amount }).success ? amount : null
}

const rawGoalWriteResponseSchema = z.object({
  goal: z.object({ goalKey: z.number().int().positive() }).passthrough(),
}).strict()

const rawGoalLinkResponseSchema = z.object({
  link: z.object({
    goalAccountLinkKey: z.number().int().positive(),
  }).passthrough(),
}).strict()

const rawGoalReserveResponseSchema = z.object({
  goal: z.object({ goalKey: z.number().int().positive() }).passthrough(),
  summary: goalSummarySchema,
}).strict()

export const isValidGoalId = (goalId: number): boolean => Number.isSafeInteger(goalId) && goalId > 0

export function parseGoalId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isValidGoalId(parsed) ? parsed : null
}

export function createGoalDetailEndpoint(goalId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/goals/${goalId}`,
    schema: goalDetailResponseSchema.refine((response) => response.goal.goalKey === goalId),
  })
}

export function createGoalMetadataEndpoint(goalId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/goals/${goalId}`,
    schema: rawGoalWriteResponseSchema.refine((response) => response.goal.goalKey === goalId),
  })
}

export function createGoalAccountLinkEndpoint(goalId: number, accountId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/goals/${goalId}/accounts`,
    schema: rawGoalLinkResponseSchema,
  })
}

export function createGoalAccountUnlinkEndpoint(goalId: number, accountId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/goals/${goalId}/accounts/${accountId}`,
    schema: z.undefined(),
  })
}

export function createGoalAssignEndpoint(goalId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/goals/${goalId}/assign`,
    schema: rawGoalReserveResponseSchema.refine(({ goal }) => goal.goalKey === goalId),
  })
}

export function createGoalMoveOutEndpoint(goalId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/goals/${goalId}/move-out`,
    schema: rawGoalReserveResponseSchema.refine(({ goal }) => goal.goalKey === goalId),
  })
}

export const GOAL_ACTIVITY_PAGE_SIZE = 25

export function createGoalActivityEndpoint(goalId: number, offset: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new Error('A valid goal activity offset is required.')
  }
  return readEndpoint({
    method: 'GET',
    path: `/v1/goals/${goalId}/activity?limit=${GOAL_ACTIVITY_PAGE_SIZE}&offset=${offset}`,
    schema: goalActivityResponseSchema.refine((response) => (
      response.limit === GOAL_ACTIVITY_PAGE_SIZE
      && response.offset === offset
      && response.activities.length <= GOAL_ACTIVITY_PAGE_SIZE
      && response.total >= response.activities.length
    )),
  })
}

export const goalsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/goals',
  schema: goalsResponseSchema,
})

// Archived goals are excluded by default (API defaults includeArchived=false); this variant is
// used for the Archived tab, matching web's client-side filter-after-fetch approach.
export const archivedGoalsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/goals?includeArchived=true',
  schema: goalsResponseSchema,
})

export function createGoalArchiveEndpoint(goalId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/goals/${goalId}`,
    schema: rawGoalWriteResponseSchema.refine((response) => response.goal.goalKey === goalId),
  })
}

export function createGoalRestoreEndpoint(goalId: number) {
  if (!isValidGoalId(goalId)) throw new Error('A positive safe goal id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/goals/${goalId}/restore`,
    schema: rawGoalWriteResponseSchema.refine((response) => response.goal.goalKey === goalId),
  })
}

// Mirrors web's useDebtStrategy (lib/api/goals/useDebtStrategy.ts) and its DebtStrategyResponse
// shape (lib/api/goals/types.ts): a read-only avalanche/snowball comparison for the tenant's
// debt-paydown goals, computed server-side. `avalanche`/`snowball` are null when there are fewer
// than two debts to compare (mirrors DebtStrategySection's own eligibility gate).
export const debtStrategyDebtSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  balance: z.number().finite(),
  minimumPayment: z.number().finite(),
  annualInterestRateBps: z.number().int(),
}).strict()

export const debtStrategyResultSchema = z.object({
  order: z.array(z.number().int().positive()),
  months: z.number().int().nonnegative(),
  totalInterest: z.number().finite(),
  perDebt: z.array(z.object({
    id: z.number().int().positive(),
    months: z.number().int().nonnegative().nullable(),
    totalInterest: z.number().finite(),
  }).strict()),
}).strict()

export const debtStrategyResponseSchema = z.object({
  debts: z.array(debtStrategyDebtSchema),
  extraBudget: z.number().finite(),
  avalanche: debtStrategyResultSchema.nullable(),
  snowball: debtStrategyResultSchema.nullable(),
}).strict()

export type DebtStrategyDebtDto = z.infer<typeof debtStrategyDebtSchema>
export type DebtStrategyResultDto = z.infer<typeof debtStrategyResultSchema>
export type DebtStrategyResponseDto = z.infer<typeof debtStrategyResponseSchema>

export const debtStrategyEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/goals/debt-strategy',
  schema: debtStrategyResponseSchema,
})
