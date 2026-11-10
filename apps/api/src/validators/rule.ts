import { z } from 'zod';

import { ruleActionsSchema, ruleConditionsSchema, ruleMatchSchema } from '@service/rules/rule-schema';
import { positiveIntId } from '@validators/shared';

const ruleName = z.string().trim().min(1, 'Name is required').max(100);
const ruleIdParams = z.object({ ruleId: positiveIntId });

export const createRuleRequestSchema = z.object({
  body: z.object({
    actions: ruleActionsSchema,
    active: z.boolean().default(true),
    conditions: ruleConditionsSchema,
    match: ruleMatchSchema.default('all'),
    name: ruleName,
    stopProcessing: z.boolean().default(false),
  }),
});

export const updateRuleRequestSchema = z.object({
  body: z.object({
    actions: ruleActionsSchema.optional(),
    active: z.boolean().optional(),
    conditions: ruleConditionsSchema.optional(),
    match: ruleMatchSchema.optional(),
    name: ruleName.optional(),
    stopProcessing: z.boolean().optional(),
  }),
  params: ruleIdParams,
});

/** An unsaved rule to preview: what it matches and does. Other fields (name, active) are ignored. */
export const previewRuleRequestSchema = z.object({
  body: z.object({
    actions: ruleActionsSchema,
    conditions: ruleConditionsSchema,
    limit: z.number().int().min(1).max(100).optional(),
    match: ruleMatchSchema.default('all'),
  }),
});

/**
 * Applying rules to existing transactions. `dryRun` (the default) only counts what would change;
 * `false` starts the run.
 */
const applyRulesBody = z.object({ dryRun: z.boolean().default(true) });

export const applyRuleRequestSchema = z.object({ body: applyRulesBody, params: ruleIdParams });

export const applyAllRulesRequestSchema = z.object({ body: applyRulesBody });

export const deleteRuleRequestSchema = z.object({ params: ruleIdParams });

/** The household's full rule list, in the new run order, each rule once. */
export const reorderRulesRequestSchema = z.object({
  body: z.object({
    ruleIds: z
      .array(positiveIntId)
      .max(1000)
      .refine((keys) => new Set(keys).size === keys.length, { message: 'Each rule may appear only once' }),
  }),
});

export type CreateRuleInput = z.output<typeof createRuleRequestSchema>['body'];
export type UpdateRuleInput = z.output<typeof updateRuleRequestSchema>['body'];
