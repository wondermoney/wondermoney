import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Locale rule presets, as `/v1/rule/presets` serves them (`apps/api/src/services/rules/rule-preset.service.ts`):
 * short lists of well-known national merchants a household can add to its rules in one go. A
 * preset only sets categories, merchants and descriptions on money out; it never touches income,
 * transfers or hidden transactions. Its rules are in the rules export format: categories by
 * system key, merchants by name. Read tolerantly, like the rules themselves.
 */

const presetSummarySchema = z.object({
  code: z.string().min(1),
  countries: z.array(z.string()).catch([]),
  language: z.string().catch(''),
  revision: z.number().int().catch(1),
  ruleCount: z.number().int().nonnegative(),
  installedCount: z.number().int().nonnegative(),
  installed: z.boolean(),
})

export type RulePresetSummary = z.infer<typeof presetSummarySchema>

export const rulePresetListSchema = z.object({
  presets: z.array(presetSummarySchema),
  suggested: z.string().nullable().catch(null),
})

export type RulePresetList = z.infer<typeof rulePresetListSchema>

const presetConditionSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.unknown().optional(),
})

const presetActionSchema = z.object({
  type: z.string(),
  category: z.union([z.object({ system: z.string() }), z.object({ name: z.string() }), z.string()]).optional(),
  merchant: z.string().optional(),
  value: z.string().optional(),
})

const presetRuleSchema = z.object({
  name: z.string().min(1),
  conditions: z.array(presetConditionSchema),
  actions: z.array(presetActionSchema),
  status: z.enum(['new', 'installed', 'unavailable']).catch('unavailable'),
})

export type RulePresetRule = z.infer<typeof presetRuleSchema>

export const rulePresetPreviewSchema = z.object({
  preset: presetSummarySchema,
  rules: z.array(presetRuleSchema),
})

export type RulePresetPreview = z.infer<typeof rulePresetPreviewSchema>

const LANGUAGE = /^[a-z]{2}(?:[-_][a-z]{2})?$/i
const REGION = /^[a-z]{2}$/i
const CODE = /^[a-z]{2}(?:-[a-z]{2})?$/i

/** The presets and the one to offer; the API adds the person's bank countries and currency. */
export function createRulePresetsEndpoint(locale: Readonly<{ language: string; region?: string | null }>) {
  const query = new URLSearchParams()
  if (LANGUAGE.test(locale.language)) query.set('language', locale.language)
  if (locale.region && REGION.test(locale.region)) query.set('region', locale.region)
  const search = query.toString()
  return readEndpoint({ method: 'GET', path: `/v1/rule/presets${search ? `?${search}` : ''}`, schema: rulePresetListSchema })
}

export function createRulePresetPreviewEndpoint(code: string) {
  if (!CODE.test(code)) throw new Error(`Not a preset code: ${code}`)
  return readEndpoint({ method: 'GET', path: `/v1/rule/presets/${encodeURIComponent(code)}`, schema: rulePresetPreviewSchema })
}

/** Adds the rules the household does not have yet; installing again adds nothing. */
export function createRulePresetInstallEndpoint(code: string) {
  if (!CODE.test(code)) throw new Error(`Not a preset code: ${code}`)
  return writeEndpoint({
    method: 'POST',
    path: `/v1/rule/presets/${encodeURIComponent(code)}/install`,
    schema: z.object({ created: z.array(z.string()), skipped: z.array(z.string()).catch([]) }),
    successStatuses: [200],
  })
}

export type PresetRuleLine = Readonly<{
  name: string
  /** Text the bank's description must contain, and must not. */
  matches: readonly string[]
  excludes: readonly string[]
  /** System category key, such as `GROCERIES`. */
  category?: string
  merchant?: string
  status: RulePresetRule['status']
}>

/** What a preset rule looks for and what it sets, for the preview list. */
export function presetRuleLine(rule: RulePresetRule): PresetRuleLine {
  const matches: string[] = []
  const excludes: string[] = []
  for (const condition of rule.conditions) {
    if ((condition.field !== 'description' && condition.field !== 'merchant') || typeof condition.value !== 'string') continue
    if (condition.operator === 'not_contains') excludes.push(condition.value)
    else matches.push(condition.value)
  }
  let category: string | undefined
  let merchant: string | undefined
  for (const action of rule.actions) {
    if (action.type === 'set_category' && action.category && typeof action.category === 'object' && 'system' in action.category) category = action.category.system
    if (action.type === 'set_merchant') merchant = action.merchant
  }
  return { name: rule.name, matches, excludes, category, merchant, status: rule.status }
}
