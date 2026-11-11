import {
  createRuleApplyCountEndpoint,
  createRuleApplyStartEndpoint,
  createRuleDeleteEndpoint,
  createRuleEndpoint,
  createRuleOperationEndpoint,
  createRuleUpdateEndpoint,
  freezeRuleInput,
  parseRuleId,
  rulePreviewSchema,
  ruleSchema,
  rulesEndpoint,
  ruleWriteSchema,
} from './rules-contract'

const rule = {
  ruleKey: 4,
  name: 'Netflix',
  active: true,
  match: 'all',
  stopProcessing: false,
  conditions: [{ field: 'description' as const, operator: 'contains' as const, source: 'cleaned' as const, value: 'NETFLIX' }],
  actions: [{ type: 'set_category' as const, categoryId: 9 }],
  position: 0,
  ownerAppuserKey: 2,
}

describe('rules read contract', () => {
  it('uses the rule GET and the rule write routes', () => {
    expect(rulesEndpoint).toMatchObject({ method: 'GET', path: '/v1/rule' })
    expect(createRuleEndpoint).toMatchObject({ method: 'POST', path: '/v1/rule', successStatuses: [201] })
    expect(createRuleUpdateEndpoint(9)).toMatchObject({ method: 'PATCH', path: '/v1/rule/9', successStatuses: [200] })
    expect(createRuleDeleteEndpoint(9)).toMatchObject({ method: 'DELETE', path: '/v1/rule/9', successStatuses: [200] })
    expect(createRuleApplyCountEndpoint(9)).toMatchObject({ method: 'POST', path: '/v1/rule/9/apply', successStatuses: [200] })
    expect(createRuleApplyStartEndpoint(9)).toMatchObject({ method: 'POST', path: '/v1/rule/9/apply', successStatuses: [202] })
    expect(createRuleOperationEndpoint('rule.apply:1')).toMatchObject({ method: 'GET', path: '/v1/operations/rule.apply%3A1' })
  })

  it('accepts a rule and strips fields the API adds instead of rejecting the list', () => {
    const parsed = ruleSchema.parse({ ...rule, createdAt: '2026-11-11T10:00:00.000Z', updatedBy: 7 })
    expect(parsed).toEqual({ ...rule, createdAt: '2026-11-11T10:00:00.000Z' })
    expect(ruleSchema.parse({ ...rule, conditions: [{ ...rule.conditions[0], extra: true }] }).conditions[0]).toEqual(rule.conditions[0])
  })

  it('reads a condition or action this build does not know as unsupported instead of failing', () => {
    const unknownCondition = ruleSchema.parse({ ...rule, conditions: [{ field: 'regex', operator: 'matches', value: 'x' }] })
    expect(unknownCondition.conditions[0]).toEqual({ field: 'unsupported', raw: { field: 'regex', operator: 'matches', value: 'x' } })
    // A known field with an operator this build does not know is just as unreadable.
    expect(ruleSchema.parse({ ...rule, conditions: [{ field: 'description', operator: 'regex', value: 'x' }] }).conditions[0]).toMatchObject({ field: 'unsupported' })
    expect(ruleSchema.parse({ ...rule, actions: [{ type: 'set_currency', currencyId: 1 }] }).actions[0]).toEqual({ type: 'unsupported', raw: { type: 'set_currency', currencyId: 1 } })
  })

  it('keeps every field the API can store readable', () => {
    const parsed = ruleSchema.parse({
      ...rule,
      conditions: [
        { field: 'merchant', operator: 'equals', value: 'Corner shop' },
        { field: 'amount', operator: 'between', min: 10, max: 20 },
        { field: 'direction', operator: 'is', value: 'out' },
        { field: 'account', operator: 'in', values: [1, 2] },
        { field: 'category', operator: 'not_in', values: [3, 'uncategorized'] },
      ],
      actions: [
        { type: 'set_merchant', merchantName: 'Netflix' },
        { type: 'set_description', value: 'Streaming' },
        { type: 'set_notes', value: 'Monthly' },
        { type: 'mark_reviewed' },
        { type: 'hide' },
        { type: 'add_tags', tagIds: [7] },
      ],
    })
    expect(parsed.conditions.map((condition) => condition.field)).toEqual(['merchant', 'amount', 'direction', 'account', 'category'])
    expect(parsed.actions.map((action) => action.type)).toEqual(['set_merchant', 'set_description', 'set_notes', 'mark_reviewed', 'hide', 'add_tags'])
  })

  it('rejects a rule without a key, conditions or actions', () => {
    for (const invalid of [
      { ...rule, ruleKey: 0 },
      { ...rule, conditions: [] },
      { ...rule, actions: [] },
      { ...rule, name: '   ' },
    ]) expect(() => ruleSchema.parse(invalid)).toThrow()
  })
})

describe('rule write contract', () => {
  it('accepts only the subset the mobile editor can show', () => {
    const parsed = ruleWriteSchema.parse({
      name: ' Netflix ',
      match: 'any',
      conditions: [
        { field: 'description', operator: 'contains', source: 'cleaned', value: 'NETFLIX' },
        { field: 'amount', operator: 'gte', value: 10 },
      ],
      actions: [{ type: 'set_merchant', merchantName: 'Netflix' }, { type: 'mark_reviewed' }],
    })
    expect(parsed.name).toBe('Netflix')
    expect(parsed.conditions).toHaveLength(2)
  })

  it('refuses a condition, action or field the editor cannot show, so a save can never drop it', () => {
    const base = { name: 'Rule', match: 'all', conditions: [rule.conditions[0]], actions: rule.actions }
    for (const invalid of [
      { ...base, conditions: [{ field: 'account', operator: 'in', values: [1] }] },
      { ...base, conditions: [{ field: 'category', operator: 'in', values: [2] }] },
      { ...base, actions: [{ type: 'add_tags', tagIds: [1] }] },
      { ...base, actions: [{ type: 'hide' }] },
      // Not part of the editor's form: sending it would be a change nobody made.
      { ...base, stopProcessing: true },
      { ...base, active: false },
      { ...base, conditions: [{ field: 'amount', operator: 'eq', value: -1 }] },
    ]) expect(() => ruleWriteSchema.parse(invalid)).toThrow()
    expect(() => freezeRuleInput({ ...base, extra: true } as never)).toThrow()
  })

  it('freezes the exact body that is sent', () => {
    const input = { name: 'Netflix', match: 'all' as const, conditions: [rule.conditions[0]], actions: rule.actions }
    expect(Object.isFrozen(freezeRuleInput(input))).toBe(true)
  })
})

describe('rule preview and ids', () => {
  it('reads the preview count and its sample rows', () => {
    const preview = rulePreviewSchema.parse({
      matchCount: 3,
      changeCount: 1,
      transactions: [{
        transactionKey: 41,
        transactionDate: '2026-07-18T10:00:00.000Z',
        description: 'NETFLIX.COM',
        merchantName: 'Netflix',
        accountName: 'Daily account',
        amount: -12.5,
        currency: 'EUR',
        categoryKey: 9,
        hidden: false,
        changes: { categoryKey: 9, reviewed: true },
      }],
    })
    expect(preview).toMatchObject({ matchCount: 3, changeCount: 1 })
    expect(preview.transactions[0].changes).toEqual({ categoryKey: 9, reviewed: true })
  })

  it('accepts only positive safe rule ids', () => {
    expect(parseRuleId('42')).toBe(42)
    for (const value of [undefined, ['2'], '0', '01', '-1', '1.2', String(Number.MAX_SAFE_INTEGER + 1)]) expect(parseRuleId(value)).toBeNull()
    expect(() => createRuleUpdateEndpoint(0)).toThrow()
  })
})
