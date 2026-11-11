import { initMobileI18n } from '@/lib/i18n'

import { ruleSchema, type RuleDto } from './rules-contract'
import {
  emptyRuleForm,
  formToRuleInput,
  isRuleEditable,
  mapRules,
  ruleEditorDraft,
  ruleToEditorForm,
  seedRuleFromTransaction,
  summarizeRule,
  type RuleSummaryLookups,
} from './rules-view-model'

const lookups: RuleSummaryLookups = {
  category: (categoryKey) => (categoryKey === 9 ? 'Entertainment' : undefined),
  amount: (value) => String(value),
}

const makeRule = (overrides: Record<string, unknown> = {}): RuleDto => ruleSchema.parse({
  ruleKey: 4,
  name: 'Netflix',
  active: true,
  match: 'all',
  stopProcessing: false,
  conditions: [{ field: 'description', operator: 'contains', source: 'cleaned', value: 'NETFLIX' }],
  actions: [{ type: 'set_category', categoryId: 9 }],
  position: 0,
  ownerAppuserKey: 2,
  ...overrides,
})

describe('rule summaries', () => {
  it('reads a rule in one line, with the words the web app uses', async () => {
    const i18n = await initMobileI18n('en')
    expect(summarizeRule(makeRule(), i18n.t, lookups)).toBe('Description contains NETFLIX, set category Entertainment')
    expect(summarizeRule(makeRule({
      match: 'any',
      conditions: [
        { field: 'merchant', operator: 'equals', value: 'Corner shop' },
        { field: 'amount', operator: 'between', min: 10, max: 20 },
      ],
      actions: [{ type: 'mark_reviewed' }, { type: 'set_merchant', merchantName: 'Shop' }],
    }), i18n.t, lookups)).toBe('Merchant is Corner shop or Amount between 10 and 20, mark as reviewed, set merchant Shop')
  })

  it('names a deleted category as deleted, and a condition this build cannot show as such', async () => {
    const i18n = await initMobileI18n('en')
    expect(summarizeRule(makeRule({ actions: [{ type: 'set_category', categoryId: 99 }] }), i18n.t, lookups)).toContain('set category (deleted)')
    expect(summarizeRule(makeRule({ conditions: [{ field: 'account', operator: 'in', values: [1] }] }), i18n.t, lookups)).toContain("a condition this app doesn't show")
  })

  it('lists the rules in run order with their run position', async () => {
    const i18n = await initMobileI18n('en')
    const items = mapRules({ rules: [makeRule({ ruleKey: 2, name: 'Second', position: 1 }), makeRule({ ruleKey: 1, name: 'First', position: 0 })] }, i18n.t, lookups)
    expect(items.map((item) => [item.id, item.name])).toEqual([[1, 'First'], [2, 'Second']])
    expect(items[0].summary).toBe('Description contains NETFLIX, set category Entertainment')
  })
})

describe('read-only detection', () => {
  it('edits the common subset', () => {
    expect(isRuleEditable(makeRule())).toBe(true)
    expect(isRuleEditable(makeRule({
      conditions: [
        { field: 'merchant', operator: 'starts_with', value: 'Net' },
        { field: 'amount', operator: 'gt', value: 5 },
      ],
      actions: [{ type: 'set_category', categoryId: 9 }, { type: 'set_merchant', merchantName: 'Netflix' }, { type: 'mark_reviewed' }],
    }))).toBe(true)
  })

  it('opens a rule with any other condition or action read-only', () => {
    for (const unsupported of [
      { conditions: [{ field: 'account', operator: 'in', values: [1] }] },
      { conditions: [{ field: 'category', operator: 'in', values: [9] }] },
      { conditions: [{ field: 'currency', operator: 'in', values: ['EUR'] }] },
      { conditions: [{ field: 'direction', operator: 'is', value: 'out' }] },
      { conditions: [{ field: 'regex', operator: 'matches', value: 'x' }] },
      { actions: [{ type: 'add_tags', tagIds: [1] }] },
      { actions: [{ type: 'hide' }] },
      { actions: [{ type: 'set_notes', value: 'x' }] },
      { actions: [{ type: 'set_currency', currencyId: 1 }] },
    ]) {
      const rule = makeRule(unsupported)
      expect(isRuleEditable(rule)).toBe(false)
      // A rule outside the subset never becomes a form, so it can never be saved from here.
      expect(ruleToEditorForm(rule)).toBeNull()
    }
  })

  it('round-trips a supported rule without inventing or dropping a field', async () => {
    const i18n = await initMobileI18n('en')
    const rule = makeRule({
      conditions: [{ field: 'amount', operator: 'between', min: 10, max: 20 }],
      actions: [{ type: 'set_category', categoryId: 9 }, { type: 'mark_reviewed' }],
    })
    const form = ruleToEditorForm(rule)
    expect(form).not.toBeNull()
    const conversion = formToRuleInput(form!, 'en')
    expect(conversion.ok).toBe(true)
    if (!conversion.ok) return
    // Exactly the four fields the PATCH may carry: nothing about stopProcessing or active.
    expect(Object.keys(conversion.input).sort()).toEqual(['actions', 'conditions', 'match', 'name'])
    expect(conversion.input.conditions).toEqual([{ field: 'amount', operator: 'between', min: 10, max: 20 }])
    expect(conversion.input.actions).toEqual([{ type: 'set_category', categoryId: 9 }, { type: 'mark_reviewed' }])
    expect(i18n.t('rules.editor.editTitle')).toBe('Edit rule')
  })
})

describe('creating a rule from a transaction', () => {
  it('pre-fills the merchant, or the cleaned description when there is none', () => {
    const withMerchant = seedRuleFromTransaction({ merchant: 'Corner shop', description: 'CARD PURCHASE', categoryId: 9 })
    expect(withMerchant.name).toBe('Corner shop')
    expect(withMerchant.conditions).toMatchObject([{ field: 'merchant', operator: 'equals', value: 'Corner shop' }])
    expect(withMerchant.actions).toMatchObject([{ type: 'set_category', categoryId: '9' }])

    const descriptionOnly = seedRuleFromTransaction({ merchant: null, description: '  NETFLIX.COM  ', categoryId: null })
    expect(descriptionOnly.name).toBe('NETFLIX.COM')
    expect(descriptionOnly.conditions).toMatchObject([{ field: 'description', operator: 'contains', value: 'NETFLIX.COM' }])
    // No category yet: the save waits for one instead of guessing.
    expect(descriptionOnly.actions).toMatchObject([{ type: 'set_category', categoryId: '' }])
  })

  it('previews the pre-filled rule once it is complete, and blocks the save until a category is chosen', () => {
    const complete = seedRuleFromTransaction({ merchant: 'Corner shop', description: null, categoryId: 9 })
    expect(ruleEditorDraft(complete, 'en')).toEqual({
      match: 'all',
      conditions: [{ field: 'merchant', operator: 'equals', value: 'Corner shop' }],
      actions: [{ type: 'set_category', categoryId: 9 }],
    })
    const withoutCategory = seedRuleFromTransaction({ merchant: 'Corner shop', description: null, categoryId: null })
    // Nothing to preview until the action can be sent, and the save says what is missing.
    expect(ruleEditorDraft(withoutCategory, 'en')).toBeNull()
    expect(formToRuleInput(withoutCategory, 'en')).toMatchObject({ ok: false, problems: { actions: { [withoutCategory.actions[0].id]: 'categoryRequired' } } })
  })
})

describe('form validation', () => {
  it('requires a name, a value and a category, and one action of each kind', () => {
    const form = { ...emptyRuleForm(), conditions: [{ ...emptyRuleForm().conditions[0], value: '   ' }] }
    const conversion = formToRuleInput(form, 'en')
    expect(conversion.ok).toBe(false)
    if (conversion.ok) return
    expect(conversion.problems.name).toBe('nameRequired')
    expect(Object.values(conversion.problems.conditions)).toEqual(['valueRequired'])
    expect(Object.values(conversion.problems.actions)).toEqual(['categoryRequired'])
  })

  it('reads amounts in the app language and refuses a negative or over-precise one', () => {
    const base = { ...emptyRuleForm(), name: 'Coffee' }
    const amountForm = (value: string) => ({
      ...base,
      conditions: [{ ...base.conditions[0], field: 'amount' as const, operator: 'eq', value }],
      actions: [{ ...base.actions[0], categoryId: '9' }],
    })
    expect(formToRuleInput(amountForm('1.234,56'), 'pt-PT')).toMatchObject({ ok: true, input: { conditions: [{ field: 'amount', operator: 'eq', value: 1234.56 }] } })
    for (const invalid of ['-1', '1,23456', 'abc']) {
      expect(formToRuleInput(amountForm(invalid), 'en')).toMatchObject({ ok: false, problems: { conditions: { [base.conditions[0].id]: 'amountInvalid' } } })
    }
  })

  it('refuses a range whose start is past its end', () => {
    const base = { ...emptyRuleForm(), name: 'Coffee' }
    const conversion = formToRuleInput({
      ...base,
      conditions: [{ ...base.conditions[0], field: 'amount', operator: 'between', min: '20', max: '10' }],
      actions: [{ ...base.actions[0], categoryId: '9' }],
    }, 'en')
    expect(conversion).toMatchObject({ ok: false, problems: { conditions: { [base.conditions[0].id]: 'rangeInvalid' } } })
  })

  it('refuses the same kind of action twice', () => {
    const base = { ...emptyRuleForm(), name: 'Coffee' }
    const conversion = formToRuleInput({
      ...base,
      conditions: [{ ...base.conditions[0], value: 'coffee' }],
      actions: [{ ...base.actions[0], categoryId: '9' }, { ...base.actions[0], id: 'second', categoryId: '10' }],
    }, 'en')
    expect(conversion).toMatchObject({ ok: false, problems: { duplicateActions: true } })
  })
})
