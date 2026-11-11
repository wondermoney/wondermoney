import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * The household's automation rules, as `/v1/rule` returns and accepts them
 * (`apps/api/src/services/rules/rule-schema.ts`).
 *
 * The read schema knows every field the API can store, plus a tolerant fallback: a condition or
 * action this build does not know reads as `unsupported` instead of failing the whole list, so a
 * newer server cannot make the rules screen unusable. The write schema is the opposite — strict,
 * and only the subset the mobile editor can show. That is what keeps an unsupported rule from
 * being rewritten with its unsupported parts dropped.
 */

const positiveId = z.number().int().positive().safe()

export const TEXT_OPERATORS = ['contains', 'not_contains', 'equals', 'starts_with', 'ends_with'] as const
export const NUMBER_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte'] as const
const LIST_OPERATORS = ['in', 'not_in'] as const
export const RULE_MATCHES = ['all', 'any'] as const

/** Stands for a transaction with no category in a category condition. */
export const UNCATEGORIZED = 'uncategorized'

export const RULE_NAME_MAX_LENGTH = 100
export const RULE_TEXT_MAX_LENGTH = 255
export const MAX_RULE_CONDITIONS = 20

export type TextOperator = (typeof TEXT_OPERATORS)[number]
export type RuleMatch = (typeof RULE_MATCHES)[number]

const textValue = z.string().trim().min(1).max(RULE_TEXT_MAX_LENGTH)

const descriptionCondition = z.object({
  field: z.literal('description'),
  operator: z.enum(TEXT_OPERATORS),
  /** `cleaned` is the tidied description shown in the app; `raw` is the bank's original text. */
  source: z.enum(['cleaned', 'raw']).default('cleaned'),
  value: textValue,
})

const merchantCondition = z.object({
  field: z.literal('merchant'),
  operator: z.enum(TEXT_OPERATORS),
  value: textValue,
})

const amountCondition = z.union([
  z.object({ field: z.literal('amount'), operator: z.enum(NUMBER_OPERATORS), value: z.number().finite() }),
  z.object({ field: z.literal('amount'), operator: z.literal('between'), min: z.number().finite(), max: z.number().finite() }),
])

const directionCondition = z.object({
  field: z.literal('direction'),
  operator: z.literal('is'),
  value: z.enum(['in', 'out']),
})

const accountCondition = z.object({ field: z.literal('account'), operator: z.enum(LIST_OPERATORS), values: z.array(positiveId).min(1) })
const categoryCondition = z.object({
  field: z.literal('category'),
  operator: z.enum(LIST_OPERATORS),
  values: z.array(z.union([positiveId, z.literal(UNCATEGORIZED)])).min(1),
})
const transactionTypeCondition = z.object({ field: z.literal('transactionType'), operator: z.enum(LIST_OPERATORS), values: z.array(z.string().min(1)).min(1) })
const currencyCondition = z.object({ field: z.literal('currency'), operator: z.enum(LIST_OPERATORS), values: z.array(z.string().min(1)).min(1) })

/** Anything this build cannot read, kept as-is so the rule still lists and stays read-only. */
const unsupportedCondition = z.unknown().transform((raw) => ({ field: 'unsupported' as const, raw }))

const ruleConditionSchema = z.union([
  descriptionCondition,
  merchantCondition,
  amountCondition,
  directionCondition,
  accountCondition,
  categoryCondition,
  transactionTypeCondition,
  currencyCondition,
  unsupportedCondition,
])

const setCategoryAction = z.object({ type: z.literal('set_category'), categoryId: positiveId })
const setMerchantAction = z.object({
  type: z.literal('set_merchant'),
  merchantId: positiveId.optional(),
  merchantName: z.string().trim().min(1).max(RULE_TEXT_MAX_LENGTH).optional(),
})
const setDescriptionAction = z.object({ type: z.literal('set_description'), value: textValue })
const setNotesAction = z.object({ type: z.literal('set_notes'), value: textValue })
const markReviewedAction = z.object({ type: z.literal('mark_reviewed') })
const hideAction = z.object({ type: z.literal('hide') })
const addTagsAction = z.object({ type: z.literal('add_tags'), tagIds: z.array(positiveId).min(1) })
const unsupportedAction = z.unknown().transform((raw) => ({ type: 'unsupported' as const, raw }))

const ruleActionSchema = z.union([
  setCategoryAction,
  setMerchantAction,
  setDescriptionAction,
  setNotesAction,
  markReviewedAction,
  hideAction,
  addTagsAction,
  unsupportedAction,
])

export type RuleConditionDto =
  | z.infer<typeof descriptionCondition>
  | z.infer<typeof merchantCondition>
  | z.infer<typeof amountCondition>
  | z.infer<typeof directionCondition>
  | z.infer<typeof accountCondition>
  | z.infer<typeof categoryCondition>
  | z.infer<typeof transactionTypeCondition>
  | z.infer<typeof currencyCondition>
  | { field: 'unsupported'; raw: unknown }

export type RuleActionDto =
  | z.infer<typeof setCategoryAction>
  | z.infer<typeof setMerchantAction>
  | z.infer<typeof setDescriptionAction>
  | z.infer<typeof setNotesAction>
  | z.infer<typeof markReviewedAction>
  | z.infer<typeof hideAction>
  | z.infer<typeof addTagsAction>
  | { type: 'unsupported'; raw: unknown }

export const ruleSchema = z.object({
  ruleKey: positiveId,
  name: z.string().trim().min(1).max(RULE_NAME_MAX_LENGTH),
  active: z.boolean(),
  match: z.enum(RULE_MATCHES).catch('all'),
  stopProcessing: z.boolean().catch(false),
  conditions: z.array(ruleConditionSchema).min(1),
  actions: z.array(ruleActionSchema).min(1),
  position: z.number().int(),
  ownerAppuserKey: positiveId.nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export type RuleDto = z.infer<typeof ruleSchema>

export const rulesResponseSchema = z.object({ rules: z.array(ruleSchema) })
export type RulesResponse = z.infer<typeof rulesResponseSchema>

/** The final change a matching transaction would get; empty when it would not change. */
const rulePreviewChangesSchema = z.object({
  addTagKeys: z.array(positiveId).optional(),
  categoryKey: positiveId.optional(),
  description: z.string().optional(),
  hidden: z.literal(true).optional(),
  merchant: z.object({ merchantKey: positiveId.nullable(), name: z.string() }).optional(),
  notes: z.string().optional(),
  reviewed: z.literal(true).optional(),
})

const rulePreviewRowSchema = z.object({
  transactionKey: z.number().int(),
  transactionDate: z.string().nullable(),
  description: z.string().nullable(),
  merchantName: z.string().nullable(),
  accountName: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  categoryKey: positiveId.nullable(),
  hidden: z.boolean(),
  changes: rulePreviewChangesSchema,
})

export const rulePreviewSchema = z.object({
  /** Matching transactions, including those the rule would leave as they are. */
  matchCount: z.number().int().nonnegative(),
  /** Matching transactions that would change. */
  changeCount: z.number().int().nonnegative(),
  transactions: z.array(rulePreviewRowSchema),
})

export type RulePreview = z.infer<typeof rulePreviewSchema>

/** What an unsaved rule needs for a preview: no name, no active flag. */
export type RuleDraft = Readonly<{
  match: RuleMatch
  conditions: readonly RuleConditionDto[]
  actions: readonly RuleActionDto[]
}>

/**
 * The write shape: only what the mobile editor can produce. `.strict()` everywhere, so a field
 * this build does not edit can never be sent by accident.
 */
const textConditionWrite = z.discriminatedUnion('field', [
  z.object({ field: z.literal('description'), operator: z.enum(TEXT_OPERATORS), source: z.enum(['cleaned', 'raw']), value: textValue }).strict(),
  z.object({ field: z.literal('merchant'), operator: z.enum(TEXT_OPERATORS), value: textValue }).strict(),
])

const amountConditionWrite = z.union([
  z.object({ field: z.literal('amount'), operator: z.enum(NUMBER_OPERATORS), value: z.number().finite().min(0) }).strict(),
  z.object({ field: z.literal('amount'), operator: z.literal('between'), min: z.number().finite().min(0), max: z.number().finite().min(0) }).strict(),
])

const supportedConditionWrite = z.union([textConditionWrite, amountConditionWrite])

const supportedActionWrite = z.union([
  z.object({ type: z.literal('set_category'), categoryId: positiveId }).strict(),
  z.object({ type: z.literal('set_merchant'), merchantId: positiveId.optional(), merchantName: z.string().trim().min(1).max(RULE_TEXT_MAX_LENGTH).optional() }).strict(),
  z.object({ type: z.literal('mark_reviewed') }).strict(),
])

export const ruleWriteSchema = z.object({
  name: z.string().trim().min(1).max(RULE_NAME_MAX_LENGTH),
  match: z.enum(RULE_MATCHES),
  conditions: z.array(supportedConditionWrite).min(1).max(MAX_RULE_CONDITIONS),
  actions: z.array(supportedActionWrite).min(1),
}).strict()

export type RuleInput = z.infer<typeof ruleWriteSchema>

/** Validates and freezes a rule body before it is sent. */
export function freezeRuleInput(input: RuleInput): RuleInput {
  return Object.freeze(ruleWriteSchema.parse(input))
}

export const rulesEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/rule',
  schema: rulesResponseSchema,
})

export const createRuleEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/rule',
  schema: z.object({ rule: ruleSchema }),
  successStatuses: [201],
})

export function createRuleUpdateEndpoint(ruleId: number) {
  positiveId.parse(ruleId)
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/rule/${ruleId}`,
    schema: z.object({ rule: ruleSchema }),
    successStatuses: [200],
  })
}

/** The API answers 200 with no body. */
export function createRuleDeleteEndpoint(ruleId: number) {
  positiveId.parse(ruleId)
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/rule/${ruleId}`,
    schema: z.undefined(),
    successStatuses: [200],
  })
}

/** Reads only: it counts what an unsaved rule would do, and writes nothing. */
export const rulePreviewEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/rule/preview',
  schema: rulePreviewSchema,
  successStatuses: [200],
})

/** The dry run: how many existing transactions applying the rule would change. */
export function createRuleApplyCountEndpoint(ruleId: number) {
  positiveId.parse(ruleId)
  return writeEndpoint({
    method: 'POST',
    path: `/v1/rule/${ruleId}/apply`,
    schema: z.object({ changeCount: z.number().int().nonnegative() }),
    successStatuses: [200],
  })
}

/** Starts the background run; follow it with `GET /v1/operations/:operationId`. */
export function createRuleApplyStartEndpoint(ruleId: number) {
  positiveId.parse(ruleId)
  return writeEndpoint({
    method: 'POST',
    path: `/v1/rule/${ruleId}/apply`,
    schema: z.object({ operationId: z.string().min(1) }),
    successStatuses: [202],
  })
}

export function createRuleOperationEndpoint(operationId: string) {
  const normalized = operationId.trim()
  if (!normalized) throw new Error('A non-empty operation id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/operations/${encodeURIComponent(normalized)}`,
    schema: z.object({
      progress: z.record(z.string(), z.unknown()).nullable().optional(),
      status: z.string().min(1),
    }),
  })
}

export function parseRuleId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}
