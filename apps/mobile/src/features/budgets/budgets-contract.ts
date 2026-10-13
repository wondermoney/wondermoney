import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

export const MIN_BUDGET_YEAR = 2000
export const MAX_BUDGET_YEAR = 2200

const positiveSafeIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const moneySchema = z.number().finite()
const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)
const yearSchema = z.number().int().min(MIN_BUDGET_YEAR).max(MAX_BUDGET_YEAR)
const monthSchema = z.number().int().min(1).max(12)
const emptyWriteResponseSchema = z.undefined()

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
}).strict().refine((value) => value.dependentsNum < value.houseHoldSize, { path: ['dependentsNum'] })

export const budgetCreateResponseSchema = z.object({
  budgetKey: positiveSafeIdSchema,
}).strict()

export type BudgetCreateWrite = z.input<typeof budgetCreateWriteSchema>
export type BudgetCreateIncome = z.input<typeof budgetCreateIncomeSchema>

const budgetInventoryItemSchema = z.object({
  budgetKey: positiveSafeIdSchema,
  budgetTemplates: z.array(z.object({ budgetTemplateCategoryKey: positiveSafeIdSchema }).strict()),
  description: z.string().nullable().optional(),
  name: z.string(),
}).strict()

export const budgetInventoryResponseSchema = z.object({ budgets: z.array(budgetInventoryItemSchema) }).strict()
export type BudgetInventoryResponseDto = z.infer<typeof budgetInventoryResponseSchema>

export const budgetAddCategoryWriteSchema = z.object({
  amountBudgeted: z.number().finite().positive(),
  categoryKey: positiveSafeIdSchema,
  recurrency: z.enum(['MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']),
}).strict()
export type BudgetAddCategoryWrite = z.input<typeof budgetAddCategoryWriteSchema>

export const budgetMetadataWriteSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
}).strict()

export type BudgetMetadataWrite = z.input<typeof budgetMetadataWriteSchema>

export const budgetCategoryWriteSchema = z.object({
  amount: z.number().finite().positive(),
  recurrency: z.enum(['MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'BI_ANNUALLY', 'ANNUALLY']),
  applyToFollowingMonths: z.boolean(),
}).strict()

export type BudgetCategoryWrite = z.input<typeof budgetCategoryWriteSchema>

export const budgetDetailSchema = z.object({
  budgetKey: positiveSafeIdSchema,
  description: z.string().max(500).nullable().optional(),
  name: z.string().min(1).max(100),
}).strict()

export const budgetDetailResponseSchema = z.object({
  budget: budgetDetailSchema,
}).strict()

export type BudgetDetailResponseDto = z.infer<typeof budgetDetailResponseSchema>

export const budgetRecurrenceSchema = z.enum([
  'MONTHLY_14',
  'MONTHLY',
  'QUARTERLY',
  'BI_ANNUALLY',
  'ANNUALLY',
])

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

export const budgetCategoryRowSchema = z.union([
  z.object({
    ...budgetCategoryRowFields,
    category_recurrency: z.null(),
    child_category_name: z.null(),
  }).strict(),
  z.object({
    ...budgetCategoryRowFields,
    category_recurrency: budgetRecurrenceSchema.nullable(),
    child_category_name: z.string(),
  }).strict(),
])

export const budgetAccountSchema = z.object({
  accountKey: positiveSafeIdSchema,
  accountName: z.string().nullable(),
}).strict()

// MikroORM serializes relation metadata alongside these documented income fields.
// This is the only deliberately open object in the budgets response boundary.
export const budgetIncomeSchema = z.object({
  amount: moneySchema,
  budgetTemplateIncomeKey: positiveSafeIdSchema.optional(),
  name: z.string(),
  recurrency: budgetRecurrenceSchema,
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
  year: yearSchema,
}).strict()

export const budgetsResponseSchema = z.object({
  budgets: z.array(budgetSchema),
}).strict()

export const budgetMonthResponseSchema = z.object({
  budget: budgetSchema,
  hasNextMonth: z.boolean(),
  hasPreviousMonth: z.boolean(),
}).strict()

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
  year: yearSchema,
}).strict()

export const budgetYearResponseSchema = z.object({
  budget: budgetYearSchema,
}).strict()

export type BudgetDto = z.infer<typeof budgetSchema>
export type BudgetYearDto = z.infer<typeof budgetYearSchema>
export type BudgetCategoryRowDto = z.infer<typeof budgetCategoryRowSchema>
export type BudgetMonthResponseDto = z.infer<typeof budgetMonthResponseSchema>
export type BudgetYearResponseDto = z.infer<typeof budgetYearResponseSchema>
export type BudgetRecurrence = z.infer<typeof budgetRecurrenceSchema>

export const budgetsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/budget/full',
  schema: budgetsResponseSchema,
})

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
export const budgetLinkedAccountSchema = z.object({
  accountKey: positiveSafeIdSchema,
  accountName: z.string().max(255).nullable().optional(),
}).passthrough()

export const budgetAccountsResponseSchema = z.object({
  accounts: z.array(budgetLinkedAccountSchema),
}).strict()

export type BudgetLinkedAccountDto = z.infer<typeof budgetLinkedAccountSchema>

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
