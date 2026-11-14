import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

/**
 * The shape of a rule's conditions and actions, as stored in `rule.conditions` / `rule.actions`
 * and accepted by the API. `rule.version` records which version of this shape a row was written
 * with; bump {@link RULE_DEFINITION_VERSION} and keep a reader for the old shape when it changes.
 *
 * Text matching ignores case, accents and repeated spaces. There are no regular expressions:
 * they need a timeout-safe engine first.
 *
 * The individual pieces are exported so the rules export/import format
 * (`rule-export.schema.ts`) can reuse them instead of restating the operators and bounds.
 */
export const RULE_DEFINITION_VERSION = 1;

export const MAX_CONDITIONS = 20;
export const MAX_LIST_VALUES = 50;
export const MAX_TAGS = 20;
/** Matches the `varchar(255)` description and notes columns. */
export const MAX_TEXT_LENGTH = 255;
export const MAX_AMOUNT = 1_000_000_000_000;
/** Amounts are stored as `numeric(18,4)`; a bound with more decimals could never be met exactly. */
export const AMOUNT_SCALE = 4;

export const TEXT_OPERATORS = ['contains', 'not_contains', 'equals', 'starts_with', 'ends_with'] as const;
export const NUMBER_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte'] as const;
export const LIST_OPERATORS = ['in', 'not_in'] as const;

export const textValueSchema = z.string().trim().min(1, 'Value is required').max(MAX_TEXT_LENGTH);

/** A non-negative amount (conditions compare the absolute amount) with at most 4 decimals. */
export const amountValueSchema = z
  .number()
  .min(0, 'Amounts are compared without their sign; use a direction condition for in or out')
  .max(MAX_AMOUNT)
  .refine((value) => Number.isInteger(Number((value * 10 ** AMOUNT_SCALE).toFixed(6))), { message: `At most ${AMOUNT_SCALE} decimal places` });

export const uniqueListSchema = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .min(1, 'At least one value is required')
    .max(MAX_LIST_VALUES)
    .transform((values) => [...new Set(values)]);

export const textOperatorSchema = z.enum(TEXT_OPERATORS);
export const listOperatorSchema = z.enum(LIST_OPERATORS);

export const descriptionConditionSchema = z.object({
  field: z.literal('description'),
  operator: textOperatorSchema,
  /** `cleaned` is the tidied description shown in the app; `raw` is the bank's original text. */
  source: z.enum(['cleaned', 'raw']).default('cleaned'),
  value: textValueSchema,
});

export const merchantConditionSchema = z.object({
  field: z.literal('merchant'),
  operator: textOperatorSchema,
  value: textValueSchema,
});

export const amountConditionSchema = z.discriminatedUnion('operator', [
  z.object({ field: z.literal('amount'), operator: z.enum(NUMBER_OPERATORS), value: amountValueSchema }),
  z
    .object({ field: z.literal('amount'), max: amountValueSchema, min: amountValueSchema, operator: z.literal('between') })
    .refine((condition) => condition.min <= condition.max, { message: 'min must not be greater than max', path: ['max'] }),
]);

export const directionConditionSchema = z.object({
  field: z.literal('direction'),
  operator: z.literal('is'),
  value: z.enum(['in', 'out']),
});

const accountConditionSchema = z.object({
  field: z.literal('account'),
  operator: listOperatorSchema,
  values: uniqueListSchema(positiveIntId),
});

/** `uncategorized` stands for a transaction with no category. */
export const UNCATEGORIZED = 'uncategorized';

const categoryConditionSchema = z.object({
  field: z.literal('category'),
  operator: listOperatorSchema,
  values: uniqueListSchema(z.union([positiveIntId, z.literal(UNCATEGORIZED)])),
});

/** Transaction type names as stored in `transaction_type.name`, compared ignoring case. */
export const transactionTypeConditionSchema = z.object({
  field: z.literal('transactionType'),
  operator: listOperatorSchema,
  values: uniqueListSchema(z.string().trim().min(1).max(64).transform((value) => value.toUpperCase())),
});

export const currencyConditionSchema = z.object({
  field: z.literal('currency'),
  operator: listOperatorSchema,
  values: uniqueListSchema(z.string().trim().regex(/^[a-z]{3}$/i, 'Use a three-letter currency code').transform((value) => value.toUpperCase())),
});

const ruleConditionSchema = z.discriminatedUnion('field', [
  descriptionConditionSchema,
  merchantConditionSchema,
  amountConditionSchema,
  directionConditionSchema,
  accountConditionSchema,
  categoryConditionSchema,
  transactionTypeConditionSchema,
  currencyConditionSchema,
]);

/**
 * What a rule can do. There is deliberately no action that sets the transaction type: only
 * transfer matching (`transfer-matching.service.ts`) types a row TRANSFER_IN / TRANSFER_OUT.
 */
const ruleActionSchema = z.discriminatedUnion('type', [
  z.object({ categoryId: positiveIntId, type: z.literal('set_category') }),
  z
    .object({
      merchantId: positiveIntId.optional(),
      merchantName: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
      type: z.literal('set_merchant'),
    })
    .refine((action) => (action.merchantId === undefined) !== (action.merchantName === undefined), { message: 'Give either merchantId or merchantName' }),
  z.object({ type: z.literal('set_description'), value: textValueSchema }),
  z.object({ type: z.literal('set_notes'), value: textValueSchema }),
  z.object({ type: z.literal('mark_reviewed') }),
  z.object({ type: z.literal('hide') }),
  z.object({ tagIds: uniqueListSchema(positiveIntId).pipe(z.array(z.number()).max(MAX_TAGS)), type: z.literal('add_tags') }),
]);

export const ruleConditionsSchema = z.array(ruleConditionSchema).min(1, 'A rule needs at least one condition').max(MAX_CONDITIONS);

/** Each kind of action at most once per rule, so a rule never contradicts itself. */
export const ruleActionsSchema = z
  .array(ruleActionSchema)
  .min(1, 'A rule needs at least one action')
  .superRefine((actions, context) => {
    const seen = new Set<string>();
    actions.forEach((action, index) => {
      if (seen.has(action.type)) context.addIssue({ code: 'custom', message: `${action.type} appears more than once`, path: [index, 'type'] });
      seen.add(action.type);
    });
  });

export const ruleMatchSchema = z.enum(['all', 'any']);

export type RuleAction = z.output<typeof ruleActionSchema>;
export type RuleCondition = z.output<typeof ruleConditionSchema>;
export type RuleMatch = z.output<typeof ruleMatchSchema>;
