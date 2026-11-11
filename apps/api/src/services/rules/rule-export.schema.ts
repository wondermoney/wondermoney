import { z } from 'zod';

import {
  amountConditionSchema,
  currencyConditionSchema,
  descriptionConditionSchema,
  directionConditionSchema,
  listOperatorSchema,
  MAX_CONDITIONS,
  MAX_TAGS,
  MAX_TEXT_LENGTH,
  merchantConditionSchema,
  ruleMatchSchema,
  textValueSchema,
  transactionTypeConditionSchema,
  UNCATEGORIZED,
  uniqueListSchema,
} from './rule-schema';

/**
 * The JSON file a household downloads from `GET /v1/rule/export` and uploads to
 * `POST /v1/rule/import`.
 *
 * It carries no internal ids. A rule names what it refers to the way a person would:
 * accounts, merchants and tags by name, and categories either by the system category's key
 * (its seeded `name`, e.g. `FOOD`) or by the household's own category name. `uncategorized`
 * keeps its meaning from the rule schema.
 *
 * The conditions and actions reuse the rule schema's own pieces wherever they do not name an
 * entity, so a file can never describe something the rule engine would not accept. After
 * resolving the names to the household's rows, the import validates each rule with
 * `ruleConditionsSchema` / `ruleActionsSchema` before writing it.
 */
export const RULE_EXPORT_FORMAT = 'wondermoney-rules';
export const RULE_EXPORT_VERSION = 1;
/** A file larger than this is refused before it is parsed. */
export const MAX_IMPORT_BYTES = 1024 * 1024;
/** A file with more rules than this is refused. */
export const MAX_IMPORT_RULES = 1000;

/**
 * A category reference: a global system category by its key, a household category by its name,
 * or the literal `uncategorized`.
 */
export const categoryReferenceSchema = z.union([
  z.literal(UNCATEGORIZED),
  z.object({ system: z.string().trim().min(1).max(MAX_TEXT_LENGTH) }).strict(),
  z.object({ name: z.string().trim().min(1).max(MAX_TEXT_LENGTH) }).strict(),
]);

export type CategoryReference = z.output<typeof categoryReferenceSchema>;

const accountConditionSchema = z.object({
  field: z.literal('account'),
  operator: listOperatorSchema,
  values: uniqueListSchema(z.string().trim().min(1).max(MAX_TEXT_LENGTH)),
});

const categoryConditionSchema = z.object({
  field: z.literal('category'),
  operator: listOperatorSchema,
  values: uniqueListSchema(categoryReferenceSchema),
});

export const exportedConditionSchema = z.discriminatedUnion('field', [
  descriptionConditionSchema,
  merchantConditionSchema,
  amountConditionSchema,
  directionConditionSchema,
  accountConditionSchema,
  categoryConditionSchema,
  transactionTypeConditionSchema,
  currencyConditionSchema,
]);

export const exportedActionSchema = z.discriminatedUnion('type', [
  z.object({ category: categoryReferenceSchema, type: z.literal('set_category') }),
  z.object({ merchant: z.string().trim().min(1).max(MAX_TEXT_LENGTH), type: z.literal('set_merchant') }),
  z.object({ type: z.literal('set_description'), value: textValueSchema }),
  z.object({ type: z.literal('set_notes'), value: textValueSchema }),
  z.object({ type: z.literal('mark_reviewed') }),
  z.object({ type: z.literal('hide') }),
  z.object({ tags: uniqueListSchema(z.string().trim().min(1).max(64)).pipe(z.array(z.string()).max(MAX_TAGS)), type: z.literal('add_tags') }),
]);

export const exportedRuleSchema = z.object({
  actions: z
    .array(exportedActionSchema)
    .min(1, 'A rule needs at least one action')
    .superRefine((actions, context) => {
      const seen = new Set<string>();
      actions.forEach((action, index) => {
        if (seen.has(action.type)) context.addIssue({ code: 'custom', message: `${action.type} appears more than once`, path: [index, 'type'] });
        seen.add(action.type);
      });
    }),
  active: z.boolean().default(true),
  conditions: z.array(exportedConditionSchema).min(1, 'A rule needs at least one condition').max(MAX_CONDITIONS),
  match: ruleMatchSchema.default('all'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  stopProcessing: z.boolean().default(false),
});

export const rulesExportFileSchema = z.object({
  /** When the file was written. Informational; the import does not read it. */
  exportedAt: z.string().optional(),
  format: z.literal(RULE_EXPORT_FORMAT),
  rules: z.array(exportedRuleSchema).max(MAX_IMPORT_RULES),
  version: z.literal(RULE_EXPORT_VERSION),
});

export type ExportedAction = z.output<typeof exportedActionSchema>;
export type ExportedCondition = z.output<typeof exportedConditionSchema>;
export type ExportedRule = z.output<typeof exportedRuleSchema>;
export type RulesExportFile = z.output<typeof rulesExportFileSchema>;
