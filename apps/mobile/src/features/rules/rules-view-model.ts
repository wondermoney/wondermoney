import type { TFunction } from 'i18next'

import { parseNumberInput } from '@/lib/formatters/decimal-input'

import {
  MAX_RULE_CONDITIONS,
  RULE_NAME_MAX_LENGTH,
  RULE_TEXT_MAX_LENGTH,
  UNCATEGORIZED,
  type RuleActionDto,
  type RuleConditionDto,
  type RuleDraft,
  type RuleDto,
  type RuleInput,
  type RuleMatch,
  type RulesResponse,
  type TextOperator,
} from './rules-contract'

/**
 * The rules list and editor, as the screens read them.
 *
 * The editor covers the common subset: text and amount conditions, and category, merchant and
 * reviewed actions. Everything else still lists and still summarizes, but opens read-only, and
 * `formToRuleInput` can only ever build that subset — so saving a rule never drops the parts this
 * build does not show.
 */

/** The condition fields the mobile editor can show. */
export const EDITABLE_CONDITION_FIELDS = ['description', 'merchant', 'amount'] as const
/** The action types the mobile editor can show. */
export const EDITABLE_ACTION_TYPES = ['set_category', 'set_merchant', 'mark_reviewed'] as const

export type EditableConditionField = (typeof EDITABLE_CONDITION_FIELDS)[number]
export type EditableActionType = (typeof EDITABLE_ACTION_TYPES)[number]

const editableConditionFields: ReadonlySet<string> = new Set(EDITABLE_CONDITION_FIELDS)
const editableActionTypes: ReadonlySet<string> = new Set(EDITABLE_ACTION_TYPES)

/** Whether every part of the rule is one the mobile editor can show. */
export function isRuleEditable(rule: Pick<RuleDto, 'conditions' | 'actions'>): boolean {
  return rule.conditions.every((condition) => editableConditionFields.has(condition.field))
    && rule.actions.every((action) => editableActionTypes.has(action.type))
}

/** Names and figures a rule summary needs; a category that is gone reads as "(deleted)". */
export type RuleSummaryLookups = Readonly<{
  category: (categoryKey: number) => string | undefined
  amount: (value: number) => string
}>

const MAX_LISTED = 3

function listNames(t: TFunction, names: readonly string[]): string {
  if (names.length <= MAX_LISTED) return names.join(', ')
  return t('rules.summary.listMore', { names: names.slice(0, MAX_LISTED).join(', '), count: names.length - MAX_LISTED })
}

function summarizeCondition(condition: RuleConditionDto, t: TFunction, lookups: RuleSummaryLookups): string {
  switch (condition.field) {
    case 'description':
    case 'merchant':
      return t('rules.summary.textCondition', {
        field: t(condition.field === 'description' && condition.source === 'raw' ? 'rules.fields.rawDescription' : `rules.fields.${condition.field}`),
        operator: t(`rules.operators.${condition.operator}`),
        value: condition.value,
      })
    case 'amount':
      return condition.operator === 'between'
        ? t('rules.summary.amountBetween', { min: lookups.amount(condition.min), max: lookups.amount(condition.max) })
        : t('rules.summary.amountCondition', { operator: t(`rules.operators.${condition.operator}`), value: lookups.amount(condition.value) })
    case 'direction':
      return t(`rules.summary.direction${condition.value === 'in' ? 'In' : 'Out'}`)
    case 'category': {
      const names = condition.values.map((value) => value === UNCATEGORIZED ? t('rules.uncategorized') : (lookups.category(value) ?? t('rules.summary.unknown')))
      return t('rules.summary.listCondition', { field: t('rules.fields.category'), operator: t(`rules.operators.${condition.operator}`), values: listNames(t, names) })
    }
    case 'account':
    case 'transactionType':
    case 'currency':
      return t('rules.summary.unsupportedCondition')
    default:
      return t('rules.summary.unsupportedCondition')
  }
}

function summarizeAction(action: RuleActionDto, t: TFunction, lookups: RuleSummaryLookups): string {
  switch (action.type) {
    case 'set_category':
      return t('rules.summary.setCategory', { name: lookups.category(action.categoryId) ?? t('rules.summary.unknown') })
    case 'set_merchant':
      return action.merchantName === undefined
        ? t('rules.summary.setMerchantSaved')
        : t('rules.summary.setMerchant', { name: action.merchantName })
    case 'set_description':
      return t('rules.summary.setDescription', { value: action.value })
    case 'set_notes':
      return t('rules.summary.setNotes', { value: action.value })
    case 'add_tags':
      return t('rules.summary.addTags')
    case 'mark_reviewed':
      return t('rules.summary.markReviewed')
    case 'hide':
      return t('rules.summary.hide')
    default:
      return t('rules.summary.unsupportedAction')
  }
}

/** A rule in one line: "Description contains NETFLIX, set category Entertainment". */
export function summarizeRule(rule: Pick<RuleDto, 'conditions' | 'actions' | 'match'>, t: TFunction, lookups: RuleSummaryLookups): string {
  const joiner = ` ${t(rule.match === 'any' ? 'rules.summary.or' : 'rules.summary.and')} `
  const conditions = rule.conditions.map((condition) => summarizeCondition(condition, t, lookups)).join(joiner)
  const actions = rule.actions.map((action) => summarizeAction(action, t, lookups)).join(', ')
  return `${conditions}, ${actions}`
}

export type RuleListItem = Readonly<{
  id: number
  name: string
  active: boolean
  position: number
  summary: string
  /** False when the rule uses a field or action the mobile editor cannot show. */
  editable: boolean
  stopProcessing: boolean
}>

/** The household's rules in run order, each with its one-line summary. */
export function mapRules(response: RulesResponse, t: TFunction, lookups: RuleSummaryLookups): RuleListItem[] {
  return [...response.rules]
    .sort((left, right) => left.position - right.position || left.ruleKey - right.ruleKey)
    .map((rule) => ({
      id: rule.ruleKey,
      name: rule.name,
      active: rule.active,
      position: rule.position,
      summary: summarizeRule(rule, t, lookups),
      editable: isRuleEditable(rule),
      stopProcessing: rule.stopProcessing,
    }))
}

/* ------------------------------------------------------------------------------------------------
 * The editor's form state
 * ---------------------------------------------------------------------------------------------- */

export type RuleConditionDraft = Readonly<{
  id: string
  field: EditableConditionField
  operator: string
  source: 'cleaned' | 'raw'
  value: string
  min: string
  max: string
}>

export type RuleActionDraft = Readonly<{
  id: string
  type: EditableActionType
  categoryId: string
  /** The merchant's name; the API finds it by name and creates it only when there is none. */
  merchant: string
  /** Kept from a rule saved with a merchant key, until another merchant is typed. */
  merchantId: number | null
}>

export type RuleEditorForm = Readonly<{
  name: string
  match: RuleMatch
  conditions: readonly RuleConditionDraft[]
  actions: readonly RuleActionDraft[]
}>

let nextRowId = 0
const rowId = () => `rule-row-${++nextRowId}`

export function defaultOperator(field: EditableConditionField): string {
  return field === 'amount' ? 'eq' : 'contains'
}

export function createConditionDraft(field: EditableConditionField = 'description', overrides: Partial<Omit<RuleConditionDraft, 'id' | 'field'>> = {}): RuleConditionDraft {
  return {
    id: rowId(),
    field,
    operator: overrides.operator ?? defaultOperator(field),
    source: overrides.source ?? 'cleaned',
    value: overrides.value ?? '',
    min: overrides.min ?? '',
    max: overrides.max ?? '',
  }
}

export function createActionDraft(type: EditableActionType = 'set_category', overrides: Partial<Omit<RuleActionDraft, 'id' | 'type'>> = {}): RuleActionDraft {
  return {
    id: rowId(),
    type,
    categoryId: overrides.categoryId ?? '',
    merchant: overrides.merchant ?? '',
    merchantId: overrides.merchantId ?? null,
  }
}

export function emptyRuleForm(): RuleEditorForm {
  return { name: '', match: 'all', conditions: [createConditionDraft()], actions: [createActionDraft()] }
}

/** A saved rule as the editor's form state; null when the rule is outside the mobile subset. */
export function ruleToEditorForm(rule: RuleDto): RuleEditorForm | null {
  if (!isRuleEditable(rule)) return null
  const conditions: RuleConditionDraft[] = []
  for (const condition of rule.conditions) {
    if (condition.field === 'description') conditions.push(createConditionDraft('description', { operator: condition.operator, source: condition.source, value: condition.value }))
    else if (condition.field === 'merchant') conditions.push(createConditionDraft('merchant', { operator: condition.operator, value: condition.value }))
    else if (condition.field === 'amount') {
      conditions.push(condition.operator === 'between'
        ? createConditionDraft('amount', { operator: 'between', min: String(condition.min), max: String(condition.max) })
        : createConditionDraft('amount', { operator: condition.operator, value: String(condition.value) }))
    }
  }
  const actions: RuleActionDraft[] = []
  for (const action of rule.actions) {
    if (action.type === 'set_category') actions.push(createActionDraft('set_category', { categoryId: String(action.categoryId) }))
    else if (action.type === 'set_merchant') actions.push(createActionDraft('set_merchant', { merchant: action.merchantName ?? '', merchantId: action.merchantId ?? null }))
    else if (action.type === 'mark_reviewed') actions.push(createActionDraft('mark_reviewed'))
  }
  return { name: rule.name, match: rule.match, conditions, actions }
}

/**
 * A rule for transactions like this one: the merchant (or, without one, a description containing
 * this one's), set to the transaction's current category. Same shape as web's
 * `formFromTransaction`.
 */
export function seedRuleFromTransaction(transaction: Readonly<{ merchant: string | null; description: string | null; categoryId: number | null }>): RuleEditorForm {
  const merchant = transaction.merchant?.trim() ?? ''
  const description = transaction.description?.trim() ?? ''
  const condition = merchant
    ? createConditionDraft('merchant', { operator: 'equals', value: merchant })
    : createConditionDraft('description', { operator: 'contains', value: description })
  return {
    name: (merchant || description).slice(0, RULE_NAME_MAX_LENGTH),
    match: 'all',
    conditions: [condition],
    actions: [createActionDraft('set_category', { categoryId: transaction.categoryId === null ? '' : String(transaction.categoryId) })],
  }
}

/* ------------------------------------------------------------------------------------------------
 * Form → API
 * ---------------------------------------------------------------------------------------------- */

export type RuleRowProblem = 'valueRequired' | 'valueTooLong' | 'amountInvalid' | 'rangeInvalid' | 'categoryRequired' | 'merchantRequired'

export type RuleFormProblems = Readonly<{
  name?: 'nameRequired'
  conditions: Readonly<Record<string, RuleRowProblem>>
  actions: Readonly<Record<string, RuleRowProblem>>
  /** The same kind of action twice. */
  duplicateActions: boolean
}>

export type RuleFormConversion =
  | Readonly<{ ok: true; input: RuleInput }>
  | Readonly<{ ok: false; problems: RuleFormProblems }>

const AMOUNT_DECIMALS = 4
const MAX_AMOUNT = 1_000_000_000_000

/** A non-negative amount with at most four decimals, or null. */
function parseAmount(value: string, locale: string): number | null {
  const parsed = parseNumberInput(value.trim(), locale)
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > MAX_AMOUNT) return null
  const scaled = parsed * 10 ** AMOUNT_DECIMALS
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return null
  return parsed
}

function toText(value: string): string | 'valueRequired' | 'valueTooLong' {
  const text = value.trim()
  if (text.length === 0) return 'valueRequired'
  if (text.length > RULE_TEXT_MAX_LENGTH) return 'valueTooLong'
  return text
}

type ConditionConversion = RuleInput['conditions'][number] | RuleRowProblem
type ActionConversion = RuleInput['actions'][number] | RuleRowProblem

function toCondition(row: RuleConditionDraft, locale: string): ConditionConversion {
  if (row.field === 'description' || row.field === 'merchant') {
    const value = toText(row.value)
    if (value === 'valueRequired' || value === 'valueTooLong') return value
    const operator = row.operator as TextOperator
    return row.field === 'description'
      ? { field: 'description', operator, source: row.source, value }
      : { field: 'merchant', operator, value }
  }
  if (row.operator === 'between') {
    const min = parseAmount(row.min, locale)
    const max = parseAmount(row.max, locale)
    if (min === null || max === null) return 'amountInvalid'
    if (min > max) return 'rangeInvalid'
    return { field: 'amount', operator: 'between', min, max }
  }
  const value = parseAmount(row.value, locale)
  if (value === null) return 'amountInvalid'
  return { field: 'amount', operator: row.operator as 'eq' | 'gt' | 'gte' | 'lt' | 'lte', value }
}

function toAction(row: RuleActionDraft): ActionConversion {
  if (row.type === 'set_category') {
    return row.categoryId ? { type: 'set_category', categoryId: Number(row.categoryId) } : 'categoryRequired'
  }
  if (row.type === 'set_merchant') {
    const name = toText(row.merchant)
    if (name === 'valueRequired') return row.merchantId === null ? 'merchantRequired' : { type: 'set_merchant', merchantId: row.merchantId }
    if (name === 'valueTooLong') return name
    return { type: 'set_merchant', merchantName: name }
  }
  return { type: 'mark_reviewed' }
}

const isProblem = (value: unknown): value is RuleRowProblem => typeof value === 'string'

/**
 * The form as a rule body, or what stops it. Only the subset the editor shows is ever produced;
 * an unsupported row cannot reach here because such a rule never opens the editor.
 */
export function formToRuleInput(form: RuleEditorForm, locale: string): RuleFormConversion {
  const problems: { conditions: Record<string, RuleRowProblem>; actions: Record<string, RuleRowProblem>; duplicateActions: boolean; name?: 'nameRequired' } = {
    conditions: {},
    actions: {},
    duplicateActions: false,
  }
  const conditions: RuleInput['conditions'] = []
  const actions: RuleInput['actions'] = []
  for (const row of form.conditions) {
    const condition = toCondition(row, locale)
    if (isProblem(condition)) problems.conditions[row.id] = condition
    else conditions.push(condition)
  }
  for (const row of form.actions) {
    const action = toAction(row)
    if (isProblem(action)) problems.actions[row.id] = action
    else actions.push(action)
  }
  const types = form.actions.map((row) => row.type)
  problems.duplicateActions = new Set(types).size !== types.length
  const name = form.name.trim().slice(0, RULE_NAME_MAX_LENGTH)
  if (name.length === 0) problems.name = 'nameRequired'

  const failed = problems.name !== undefined
    || problems.duplicateActions
    || Object.keys(problems.conditions).length > 0
    || Object.keys(problems.actions).length > 0
    || conditions.length === 0
    || actions.length === 0
    || conditions.length > MAX_RULE_CONDITIONS
  if (failed) return { ok: false, problems }
  return { ok: true, input: { name, match: form.match, conditions, actions } }
}

/**
 * The form as a preview draft, or null while a row is incomplete. A preview needs no name, so an
 * unnamed rule still shows its count.
 */
export function ruleEditorDraft(form: RuleEditorForm, locale: string): RuleDraft | null {
  if (form.conditions.length === 0 || form.actions.length === 0) return null
  const conditions: RuleConditionDto[] = []
  for (const row of form.conditions) {
    const condition = toCondition(row, locale)
    if (isProblem(condition)) return null
    conditions.push(condition)
  }
  const actions: RuleActionDto[] = []
  for (const row of form.actions) {
    const action = toAction(row)
    if (isProblem(action)) return null
    actions.push(action)
  }
  return { match: form.match, conditions, actions }
}
