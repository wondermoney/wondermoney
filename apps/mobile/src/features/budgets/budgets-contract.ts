import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

const MIN_BUDGET_YEAR = 2000
const MAX_BUDGET_YEAR = 2200

const positiveSafeIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const moneySchema = z.number().finite()
const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)
const yearSchema = z.number().int().min(MIN_BUDGET_YEAR).max(MAX_BUDGET_YEAR)
const monthSchema = z.number().int().min(1).max(12)
const emptyWriteResponseSchema = z.undefined()

/**
 * Who sees a budget: everyone in the household, or only the member who created it (not even the
 * household's owner or admins). Chosen at creation only; the budget PATCH does not take it.
 */
export const BUDGET_VISIBILITIES = ['household', 'personal'] as const
export type BudgetVisibility = (typeof BUDGET_VISIBILITIES)[number]
export const budgetVisibilitySchema = z.enum(BUDGET_VISIBILITIES)

// Read side: a server without personal budgets leaves the field out, and every budget it has is a
// household one. A kind this build doesn't know reads as household too, so the stricter account
// rule applies to it, instead of failing the whole response.
const budgetVisibilityResponseSchema = tolerantEnum(BUDGET_VISIBILITIES, 'household').default('household')

export const budgetCreateIncomeSchema = z.discriminatedUnion('isRecurrent', [
  z.object({
    amount: z.number().finite().nonnegative().max(999999999),
    isRecurrent: z.literal(true),
    name: z.string().trim().min(1).max(100),
    recurrency: z.enum(['MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']),
  }).strict(),
  z.object({
    amount: z.number().finite().nonnegative().max(999999999),
    isRecurrent: z.literal(false),
    name: z.string().trim().min(1).max(100),
  }).strict(),
])

export const budgetCreateWriteSchema = z.object({
  dependentsNum: z.number().int().min(0).max(9),
  houseHoldSize: z.number().int().min(1).max(10),
  incomes: z.array(budgetCreateIncomeSchema),
  visibility: budgetVisibilitySchema.optional(),
}).strict().refine((value) => value.dependentsNum < value.houseHoldSize, { path: ['dependentsNum'] })

export const budgetCreateResponseSchema = z.object({
  budgetKey: positiveSafeIdSchema,
})

export type BudgetCreateWrite = z.input<typeof budgetCreateWriteSchema>
export type BudgetCreateIncome = z.input<typeof budgetCreateIncomeSchema>

const budgetInventoryItemSchema = z.object({
  budgetKey: positiveSafeIdSchema,
  budgetTemplates: z.array(z.object({ budgetTemplateCategoryKey: positiveSafeIdSchema })),
  description: z.string().nullable().optional(),
  name: z.string(),
  visibility: budgetVisibilityResponseSchema,
})

export const budgetInventoryResponseSchema = z.object({ budgets: z.array(budgetInventoryItemSchema) })
export type BudgetInventoryResponseDto = z.infer<typeof budgetInventoryResponseSchema>

export const budgetAddCategoryWriteSchema = z.object({
  amountBudgeted: z.number().finite().positive(),
  categoryKey: positiveSafeIdSchema,
  recurrency: z.enum(['MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']),
}).strict()
export type BudgetAddCategoryWrite = z.input<typeof budgetAddCategoryWriteSchema>

/** The day of the month a budget month starts on: 1 (the calendar month) to 28, a day every month has. */
export const budgetPeriodStartDaySchema = z.number().int().min(1).max(28)

/** The days a budget month covers (`YYYY-MM-DD`, both inclusive), which its start day decides. */
export const budgetPeriodSchema = z.object({
  firstDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
})

export type BudgetPeriodDto = z.infer<typeof budgetPeriodSchema>

// `name` (with `description`, which is replaced along with it), `periodStartDay` and
// `rolloverCarriesOverspend` can each be sent alone; the API needs at least one of them.
export const budgetMetadataWriteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  periodStartDay: budgetPeriodStartDaySchema.optional(),
  rolloverCarriesOverspend: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.periodStartDay !== undefined || value.rolloverCarriesOverspend !== undefined, { path: ['name'] })

export type BudgetMetadataWrite = z.input<typeof budgetMetadataWriteSchema>

export const budgetCategoryWriteSchema = z.object({
  amount: z.number().finite().positive(),
  recurrency: z.enum(['MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']),
  applyToFollowingMonths: z.boolean(),
  /** Sent only when the switch changed, so a forward amount edit never rewrites later months' rollover. */
  rolloverEnabled: z.boolean().optional(),
}).strict()

export type BudgetCategoryWrite = z.input<typeof budgetCategoryWriteSchema>

export const budgetSuggestionSchema = z.object({
  average: moneySchema,
  categoryKey: positiveSafeIdSchema,
  categoryName: z.string(),
  hasEnoughData: z.boolean(),
  median: moneySchema,
  monthsWithData: z.number().int().nonnegative(),
  suggested: moneySchema.nullable(),
})

export const budgetSuggestionsResponseSchema = z.object({
  categories: z.array(budgetSuggestionSchema),
  currencyCode: currencyCodeSchema,
  months: z.number().int().positive(),
  targetMonth: z.object({ month: monthSchema, year: yearSchema }),
})

export type BudgetSuggestionDto = z.infer<typeof budgetSuggestionSchema>

const budgetDetailSchema = z.object({
  budgetKey: positiveSafeIdSchema,
  description: z.string().max(500).nullable().optional(),
  name: z.string().min(1).max(100),
  /** Absent from servers without month start days: the setting is then not offered. */
  periodStartDay: budgetPeriodStartDaySchema.optional(),
  /** Absent from servers without rollover: the setting is then not offered. */
  rolloverCarriesOverspend: z.boolean().optional(),
  visibility: budgetVisibilityResponseSchema,
})

export const budgetDetailResponseSchema = z.object({
  budget: budgetDetailSchema,
})

const BUDGET_RECURRENCES = [
  'MONTHLY_14',
  'MONTHLY',
  'QUARTERLY',
  'BI_ANNUALLY',
  'ANNUALLY',
] as const

export const budgetRecurrenceSchema = z.enum(BUDGET_RECURRENCES)

// Read side: a recurrence this build doesn't know reads as null, the same "recurrence unavailable"
// state legacy categories already have, instead of failing the whole budget.
const budgetRecurrenceResponseSchema = tolerantEnum(BUDGET_RECURRENCES, null)

const budgetCategoryRowFields = {
  category_amount: moneySchema,
  category_bg_color: z.string().nullable(),
  category_budgeted_amount: moneySchema,
  category_icon: z.string().nullable(),
  category_is_system_category: z.boolean(),
  category_key: positiveSafeIdSchema,
  category_text_color: z.string().nullable(),
  parent_category_name: z.string(),
}

// Rollover fields (budget rollover). Optional so a server without rollover still parses: nothing
// rolled over, available equals budgeted, rollover off, nothing incomplete.
const budgetCategoryRolloverFields = {
  category_available: moneySchema.optional(),
  category_rolled_over: moneySchema.default(0),
  category_rollover_enabled: z.boolean().default(false),
  category_rollover_incomplete: z.boolean().default(false),
}

const withAvailableDefault = <Row extends { category_available?: number; category_budgeted_amount: number; category_rolled_over: number }>(
  { category_available, ...row }: Row,
): Omit<Row, 'category_available'> & { category_available: number } => ({
  ...row,
  category_available: category_available ?? row.category_budgeted_amount + row.category_rolled_over,
})

export const budgetCategoryRowSchema = z.union([
  z.object({
    ...budgetCategoryRowFields,
    ...budgetCategoryRolloverFields,
    category_recurrency: z.null(),
    child_category_name: z.null(),
  }).transform(withAvailableDefault),
  z.object({
    ...budgetCategoryRowFields,
    ...budgetCategoryRolloverFields,
    category_recurrency: budgetRecurrenceResponseSchema.nullable(),
    child_category_name: z.string(),
  }).transform(withAvailableDefault),
])

const budgetAccountSchema = z.object({
  accountKey: positiveSafeIdSchema,
  accountName: z.string().nullable(),
})

// MikroORM serializes relation metadata alongside these documented income fields.
// This is the only deliberately open object in the budgets response boundary.
const budgetIncomeSchema = z.object({
  amount: moneySchema,
  budgetTemplateIncomeKey: positiveSafeIdSchema.optional(),
  name: z.string(),
  recurrency: budgetRecurrenceResponseSchema,
}).passthrough()

export const budgetSchema = z.object({
  accounts: z.array(budgetAccountSchema),
  budgetKey: positiveSafeIdSchema,
  categories: z.array(budgetCategoryRowSchema),
  currencyCode: currencyCodeSchema,
  description: z.string().nullable().optional(),
  incomes: z.array(budgetIncomeSchema),
  month: monthSchema,
  name: z.string(),
  /** The days `month` covers; absent from servers without month start days. */
  period: budgetPeriodSchema.optional(),
  /** The API's default, and what a server without the setting means, is 1: the calendar month. */
  periodStartDay: budgetPeriodStartDaySchema.default(1),
  /** Off: only unspent money rolls over, an overspend is dropped. The API's default is on. */
  rolloverCarriesOverspend: z.boolean().default(true),
  /** `/v1/budget/full` only; the month endpoint reports it at the top level. */
  rolloverComplete: z.boolean().optional(),
  visibility: budgetVisibilityResponseSchema,
  year: yearSchema,
})

export const budgetsResponseSchema = z.object({
  budgets: z.array(budgetSchema),
})

export const budgetMonthResponseSchema = z.object({
  budget: budgetSchema,
  hasNextMonth: z.boolean(),
  hasPreviousMonth: z.boolean(),
  /** False when some carried amount rests on spending that could not be converted. */
  rolloverComplete: z.boolean().default(true),
})

// The year and year-until-month endpoints return the same shape as a month, minus `month` — the
// categories are pre-aggregated (summed) across whichever months are in scope.
export const budgetYearSchema = z.object({
  accounts: z.array(budgetAccountSchema),
  budgetKey: positiveSafeIdSchema,
  categories: z.array(budgetCategoryRowSchema),
  currencyCode: currencyCodeSchema,
  description: z.string().nullable().optional(),
  incomes: z.array(budgetIncomeSchema),
  name: z.string(),
  visibility: budgetVisibilityResponseSchema,
  year: yearSchema,
})

export const budgetYearResponseSchema = z.object({
  budget: budgetYearSchema,
})

export type BudgetDto = z.infer<typeof budgetSchema>
export type BudgetYearDto = z.infer<typeof budgetYearSchema>
export type BudgetCategoryRowDto = z.infer<typeof budgetCategoryRowSchema>
export type BudgetRecurrence = z.infer<typeof budgetRecurrenceSchema>

export const budgetsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/budget/full',
  schema: budgetsResponseSchema,
})

/**
 * The budgets list with the member filter (`memberKeys`: a member's key or `shared`): each budget
 * counts only that member's part of its spending. It never changes which budgets are listed, so a
 * personal budget stays its owner's whoever they filter by (the API's rule, #89). Without a member,
 * the plain list.
 */
export function createBudgetsEndpoint(member?: string) {
  if (member === undefined) return budgetsEndpoint
  return readEndpoint({
    method: 'GET',
    path: `/v1/budget/full?${new URLSearchParams({ memberKeys: member }).toString()}`,
    schema: budgetsResponseSchema,
  })
}

export const budgetInventoryEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/budget',
  schema: budgetInventoryResponseSchema,
})

export const createBudgetEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/budget',
  schema: budgetCreateResponseSchema,
})

export function createBudgetAddCategoryEndpoint(budgetId: number) {
  if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/budget/${budgetId}/category`,
    schema: emptyWriteResponseSchema,
  })
}

export function createBudgetDetailEndpoint(budgetId: number) {
  if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/budget/${budgetId}`,
    schema: budgetDetailResponseSchema,
  })
}

export const isValidBudgetId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
)

export const isValidBudgetPeriod = (year: number, month: number): boolean => (
  Number.isInteger(year)
  && year >= MIN_BUDGET_YEAR
  && year <= MAX_BUDGET_YEAR
  && Number.isInteger(month)
  && month >= 1
  && month <= 12
)

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export const parseBudgetId = (value: unknown): number | null => {
  const parsed = parsePositiveInteger(value)
  return parsed !== null && isValidBudgetId(parsed) ? parsed : null
}

export const parseBudgetPeriodPart = (value: unknown): number | null => parsePositiveInteger(value)

export function createBudgetMonthEndpoint(budgetId: number, year: number, month: number) {
  if (!isValidBudgetId(budgetId) || !isValidBudgetPeriod(year, month)) {
    throw new Error('A positive safe budget id and valid budget period are required.')
  }
  return readEndpoint({
    method: 'GET',
    path: `/v1/budget/${budgetId}/${year}/${month}`,
    schema: budgetMonthResponseSchema,
  })
}

export function createBudgetSuggestionsEndpoint(budgetId: number, year: number, month: number, months: 3 | 6 | 12 = 3) {
  if (!isValidBudgetId(budgetId) || !isValidBudgetPeriod(year, month)) {
    throw new Error('A positive safe budget id and valid budget period are required.')
  }
  return readEndpoint({
    method: 'GET',
    path: `/v1/budget/${budgetId}/suggestions?year=${year}&month=${month}&months=${months}`,
    schema: budgetSuggestionsResponseSchema,
  })
}

export function createBudgetYearEndpoint(budgetId: number, year: number) {
  if (!isValidBudgetId(budgetId) || !Number.isInteger(year) || year < MIN_BUDGET_YEAR || year > MAX_BUDGET_YEAR) {
    throw new Error('A positive safe budget id and a valid budget year are required.')
  }
  return readEndpoint({
    method: 'GET',
    path: `/v1/budget/${budgetId}/${year}`,
    schema: budgetYearResponseSchema,
  })
}

export function createBudgetYearUntilMonthEndpoint(budgetId: number, year: number, month: number) {
  if (!isValidBudgetId(budgetId) || !isValidBudgetPeriod(year, month)) {
    throw new Error('A positive safe budget id and a valid budget period are required.')
  }
  return readEndpoint({
    method: 'GET',
    path: `/v1/budget/${budgetId}/${year}/until/${month}`,
    schema: budgetYearResponseSchema,
  })
}

export function createBudgetMetadataEndpoint(budgetId: number) {
  if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/budget/${budgetId}`,
    schema: emptyWriteResponseSchema,
  })
}

export function createBudgetCategoryEndpoint(budgetId: number, year: number, month: number, categoryId: number) {
  if (!isValidBudgetId(budgetId) || !isValidBudgetPeriod(year, month) || !isValidBudgetId(categoryId)) {
    throw new Error('Positive safe budget/category ids and a valid budget period are required.')
  }
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/budget/${budgetId}/${year}/${month}/${categoryId}`,
    schema: emptyWriteResponseSchema,
  })
}

export function createDeleteBudgetEndpoint(budgetId: number) {
  if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/budget/${budgetId}`,
    schema: emptyWriteResponseSchema,
  })
}

/** Removes a category for a single month only. The category still applies to other months. */
export function createDeleteBudgetCategoryForMonthEndpoint(budgetId: number, year: number, month: number, categoryId: number) {
  if (!isValidBudgetId(budgetId) || !isValidBudgetPeriod(year, month) || !isValidBudgetId(categoryId)) {
    throw new Error('Positive safe budget/category ids and a valid budget period are required.')
  }
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/budget/${budgetId}/${year}/${month}/${categoryId}`,
    schema: emptyWriteResponseSchema,
  })
}

/** Removes a category from the budget template from the current month onward. Never touches past
 * months — the API's own default is the safer "future only" behavior; deleting full history is
 * intentionally not exposed here. */
export function createRemoveBudgetCategoryEndpoint(budgetId: number, categoryId: number) {
  if (!isValidBudgetId(budgetId) || !isValidBudgetId(categoryId)) throw new Error('A positive safe budget/category id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/budget/${budgetId}/category/${categoryId}?deletePreviousMonths=false`,
    schema: emptyWriteResponseSchema,
  })
}

// MikroORM serializes relation metadata alongside these documented account fields, same pattern
// as budgetIncomeSchema above — this is the only other deliberately open object in this boundary.
const budgetLinkedAccountSchema = z.object({
  accountKey: positiveSafeIdSchema,
  accountName: z.string().max(255).nullable().optional(),
}).passthrough()

export const budgetAccountsResponseSchema = z.object({
  accounts: z.array(budgetLinkedAccountSchema),
})

export const budgetAccountsWriteSchema = z.object({
  accountKeys: z.array(positiveSafeIdSchema),
}).strict()

export type BudgetAccountsWrite = z.input<typeof budgetAccountsWriteSchema>

export function createBudgetAccountsEndpoint(budgetId: number) {
  if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/budget/${budgetId}/accounts`,
    schema: budgetAccountsResponseSchema,
  })
}

export function createUpdateBudgetAccountsEndpoint(budgetId: number) {
  if (!isValidBudgetId(budgetId)) throw new Error('A positive safe budget id is required.')
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/budget/${budgetId}/accounts`,
    schema: emptyWriteResponseSchema,
  })
}
