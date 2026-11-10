import { describe, expect, it } from 'vitest';

import { type EvaluableRule, evaluateRules, hasChanges, type TransactionFacts } from '@service/rules/rule-engine';
import type { RuleAction, RuleCondition } from '@service/rules/rule-schema';

const TENANT = 1;
const OWNER = 10;
const PARTNER = 11;

function facts(overrides: Partial<TransactionFacts> = {}): TransactionFacts {
  return {
    account: { accountKey: 100, isPrivate: false, ownerAppuserKey: OWNER },
    amount: -12.5,
    categoryKey: null,
    currency: 'EUR',
    description: 'Netflix.com',
    hidden: false,
    merchant: { merchantKey: 7, name: 'Netflix' },
    notes: null,
    rawDescription: 'COMPRA 1234 NETFLIX.COM AMSTERDAM',
    reviewed: false,
    tagKeys: [],
    tenantKey: TENANT,
    transactionKey: 500,
    transactionType: 'CARD_PAYMENT',
    userEdited: { category: false, description: false, merchant: false },
    ...overrides,
  };
}

let nextKey = 1;
function rule(conditions: RuleCondition[], actions: RuleAction[], overrides: Partial<EvaluableRule> = {}): EvaluableRule {
  const ruleKey = nextKey++;
  return { actions, active: true, conditions, match: 'all', ownerAppuserKey: OWNER, position: ruleKey, ruleKey, stopProcessing: false, tenantKey: TENANT, ...overrides };
}

const setCategory = (categoryId: number): RuleAction => ({ categoryId, type: 'set_category' });
const SET_CATEGORY_42 = setCategory(42);

/** Does a rule with this one condition match the transaction? */
const matches = (condition: RuleCondition, overrides: Partial<TransactionFacts> = {}) =>
  evaluateRules([rule([condition], [SET_CATEGORY_42])], facts(overrides)).matchedRuleKeys.length === 1;

describe('evaluateRules', () => {
  describe('text conditions', () => {
    it.each([
      ['contains', 'flix', true],
      ['contains', 'spotify', false],
      ['not_contains', 'spotify', true],
      ['not_contains', 'flix', false],
      ['equals', 'netflix.com', true],
      ['equals', 'netflix', false],
      ['starts_with', 'NETF', true],
      ['starts_with', 'flix', false],
      ['ends_with', '.COM', true],
      ['ends_with', 'netflix', false],
    ] as const)('description %s "%s" → %s', (operator, value, expected) => {
      expect(matches({ field: 'description', operator, source: 'cleaned', value })).toBe(expected);
    });

    it('ignores case, accents and repeated spaces', () => {
      expect(matches({ field: 'description', operator: 'contains', source: 'cleaned', value: 'cafe  central' }, { description: 'CAFÉ CENTRAL Lisboa' })).toBe(true);
      expect(matches({ field: 'description', operator: 'equals', source: 'cleaned', value: 'Pão de Açúcar' }, { description: '  pao de   acucar ' })).toBe(true);
    });

    it('reads the raw bank text when asked to', () => {
      expect(matches({ field: 'description', operator: 'contains', source: 'raw', value: 'amsterdam' })).toBe(true);
      expect(matches({ field: 'description', operator: 'contains', source: 'cleaned', value: 'amsterdam' })).toBe(false);
    });

    it('falls back to the other description when one is missing', () => {
      expect(matches({ field: 'description', operator: 'contains', source: 'cleaned', value: 'amsterdam' }, { description: null })).toBe(true);
      expect(matches({ field: 'description', operator: 'contains', source: 'raw', value: 'netflix.com' }, { rawDescription: null })).toBe(true);
    });

    it('matches the merchant name', () => {
      expect(matches({ field: 'merchant', operator: 'equals', value: 'netflix' })).toBe(true);
      expect(matches({ field: 'merchant', operator: 'equals', value: 'netflix' }, { merchant: null })).toBe(false);
    });

    it('treats a missing value as empty text, so only negative operators match it', () => {
      expect(matches({ field: 'merchant', operator: 'not_contains', value: 'netflix' }, { merchant: null })).toBe(true);
      expect(matches({ field: 'description', operator: 'contains', source: 'cleaned', value: 'x' }, { description: null, rawDescription: null })).toBe(false);
    });
  });

  describe('amount conditions', () => {
    it.each([
      ['eq', 12.5, true],
      ['eq', 12.49, false],
      ['gt', 12.49, true],
      ['gt', 12.5, false],
      ['gte', 12.5, true],
      ['gte', 12.51, false],
      ['lt', 12.51, true],
      ['lt', 12.5, false],
      ['lte', 12.5, true],
      ['lte', 12.49, false],
    ] as const)('%s %d against a 12.50 payment → %s', (operator, value, expected) => {
      expect(matches({ field: 'amount', operator, value })).toBe(expected);
    });

    it('compares the amount without its sign, for money in and out alike', () => {
      expect(matches({ field: 'amount', operator: 'lt', value: 20 }, { amount: -19.99 })).toBe(true);
      expect(matches({ field: 'amount', operator: 'lt', value: 20 }, { amount: 19.99 })).toBe(true);
      expect(matches({ field: 'amount', operator: 'gt', value: 20 }, { amount: -19.99 })).toBe(false);
    });

    it('includes both bounds of between', () => {
      const between = { field: 'amount', max: 20, min: 10, operator: 'between' } as const;
      expect(matches(between, { amount: -10 })).toBe(true);
      expect(matches(between, { amount: -20 })).toBe(true);
      expect(matches(between, { amount: -20.0001 })).toBe(false);
      expect(matches(between, { amount: -9.9999 })).toBe(false);
    });

    it('compares exact decimals, not floating-point noise', () => {
      expect(matches({ field: 'amount', operator: 'eq', value: 0.3 }, { amount: -(0.1 + 0.2) })).toBe(true);
      expect(matches({ field: 'amount', operator: 'lte', value: 0.3 }, { amount: 0.1 + 0.2 })).toBe(true);
      expect(matches({ field: 'amount', operator: 'gt', value: 0.3 }, { amount: 0.1 + 0.2 })).toBe(false);
    });

    it('never matches a transaction without an amount', () => {
      expect(matches({ field: 'amount', operator: 'gte', value: 0 }, { amount: null })).toBe(false);
      expect(matches({ field: 'amount', max: 1, min: 0, operator: 'between' }, { amount: null })).toBe(false);
    });
  });

  describe('other conditions', () => {
    it('tells money in from money out by the sign, and a zero amount is neither', () => {
      expect(matches({ field: 'direction', operator: 'is', value: 'out' }, { amount: -1 })).toBe(true);
      expect(matches({ field: 'direction', operator: 'is', value: 'in' }, { amount: -1 })).toBe(false);
      expect(matches({ field: 'direction', operator: 'is', value: 'in' }, { amount: 1 })).toBe(true);
      expect(matches({ field: 'direction', operator: 'is', value: 'in' }, { amount: 0 })).toBe(false);
      expect(matches({ field: 'direction', operator: 'is', value: 'out' }, { amount: 0 })).toBe(false);
    });

    it.each([
      [{ field: 'account', operator: 'in', values: [100, 101] }, true],
      [{ field: 'account', operator: 'not_in', values: [100] }, false],
      [{ field: 'category', operator: 'in', values: ['uncategorized'] }, true],
      [{ field: 'category', operator: 'not_in', values: ['uncategorized'] }, false],
      [{ field: 'category', operator: 'in', values: [3] }, false],
      [{ field: 'transactionType', operator: 'in', values: ['CARD_PAYMENT'] }, true],
      [{ field: 'transactionType', operator: 'not_in', values: ['CARD_PAYMENT', 'ATM'] }, false],
      [{ field: 'currency', operator: 'in', values: ['USD'] }, false],
      [{ field: 'currency', operator: 'not_in', values: ['USD'] }, true],
    ] as const)('%o → %s', (condition, expected) => {
      expect(matches(condition as unknown as RuleCondition)).toBe(expected);
    });

    it('matches a categorized transaction by its category', () => {
      expect(matches({ field: 'category', operator: 'in', values: [3, 'uncategorized'] }, { categoryKey: 3 })).toBe(true);
      expect(matches({ field: 'category', operator: 'in', values: ['uncategorized'] }, { categoryKey: 3 })).toBe(false);
    });

    it('compares transaction types ignoring case', () => {
      expect(matches({ field: 'transactionType', operator: 'in', values: ['CARD_PAYMENT'] }, { transactionType: 'card_payment' })).toBe(true);
    });

    it('treats a missing account, type or currency as matching no value', () => {
      expect(matches({ field: 'account', operator: 'in', values: [100] }, { account: null })).toBe(false);
      expect(matches({ field: 'account', operator: 'not_in', values: [100] }, { account: null })).toBe(true);
      expect(matches({ field: 'currency', operator: 'in', values: ['EUR'] }, { currency: null })).toBe(false);
      expect(matches({ field: 'transactionType', operator: 'not_in', values: ['ATM'] }, { transactionType: null })).toBe(true);
    });
  });

  describe('all and any', () => {
    const netflix: RuleCondition = { field: 'merchant', operator: 'contains', value: 'netflix' };
    const big: RuleCondition = { field: 'amount', operator: 'gt', value: 100 };

    it('needs every condition with all', () => {
      expect(evaluateRules([rule([netflix, big], [SET_CATEGORY_42])], facts()).matchedRuleKeys).toEqual([]);
    });

    it('needs one condition with any', () => {
      const anyRule = rule([netflix, big], [SET_CATEGORY_42], { match: 'any' });
      expect(evaluateRules([anyRule], facts()).matchedRuleKeys).toEqual([anyRule.ruleKey]);
    });
  });

  describe('actions', () => {
    const always: RuleCondition = { field: 'merchant', operator: 'contains', value: 'netflix' };
    const plan = (actions: RuleAction[], overrides: Partial<TransactionFacts> = {}) => {
      const only = rule([always], actions);
      return { plan: evaluateRules([only], facts(overrides)), ruleKey: only.ruleKey };
    };

    it('sets the category', () => {
      const { plan: result, ruleKey } = plan([setCategory(42)]);
      expect(result.changes.category).toEqual({ categoryKey: 42, ruleKey });
    });

    it('sets the merchant by id or by a new name', () => {
      const byId = plan([{ merchantId: 9, type: 'set_merchant' }]);
      const byName = plan([{ merchantName: 'Netflix International', type: 'set_merchant' }]);
      expect(byId.plan.changes.merchant).toEqual({ merchantKey: 9, ruleKey: byId.ruleKey });
      expect(byName.plan.changes.merchant).toEqual({ merchantName: 'Netflix International', ruleKey: byName.ruleKey });
    });

    it('sets the description and the notes', () => {
      const { plan: result, ruleKey } = plan([{ type: 'set_description', value: 'Rent' }, { type: 'set_notes', value: 'Monthly' }]);
      expect(result.changes.description).toEqual({ ruleKey, value: 'Rent' });
      expect(result.changes.notes).toEqual({ ruleKey, value: 'Monthly' });
    });

    it('marks reviewed and hides', () => {
      const { plan: result, ruleKey } = plan([{ type: 'mark_reviewed' }, { type: 'hide' }]);
      expect(result.changes.reviewed).toEqual({ ruleKey });
      expect(result.changes.hidden).toEqual({ ruleKey });
    });

    it('adds only the tags the transaction does not carry yet', () => {
      const { plan: result, ruleKey } = plan([{ tagIds: [1, 2, 3], type: 'add_tags' }], { tagKeys: [2] });
      expect(result.changes.addTags).toEqual([{ ruleKey, tagKey: 1 }, { ruleKey, tagKey: 3 }]);
    });

    it('plans nothing when the transaction already looks like that', () => {
      const { plan: result } = plan(
        [setCategory(42), { merchantName: 'NETFLIX', type: 'set_merchant' }, { type: 'set_description', value: 'Netflix.com' }, { type: 'mark_reviewed' }, { type: 'hide' }, { tagIds: [2], type: 'add_tags' }],
        { categoryKey: 42, hidden: true, reviewed: true, tagKeys: [2] },
      );
      expect(result.matchedRuleKeys).toHaveLength(1);
      expect(hasChanges(result)).toBe(false);
    });

    it('does not set the same merchant again by id', () => {
      expect(hasChanges(plan([{ merchantId: 7, type: 'set_merchant' }]).plan)).toBe(false);
    });
  });

  describe('order and stop processing', () => {
    const netflix: RuleCondition = { field: 'merchant', operator: 'contains', value: 'netflix' };

    it('runs rules by position and lets a later rule overwrite an earlier one', () => {
      const later = rule([netflix], [setCategory(2), { type: 'set_notes', value: 'later' }], { position: 20 });
      const earlier = rule([netflix], [setCategory(1), { type: 'hide' }], { position: 10 });

      const result = evaluateRules([later, earlier], facts());

      expect(result.matchedRuleKeys).toEqual([earlier.ruleKey, later.ruleKey]);
      expect(result.changes.category).toEqual({ categoryKey: 2, ruleKey: later.ruleKey });
      expect(result.changes.hidden).toEqual({ ruleKey: earlier.ruleKey });
      expect(result.changes.notes).toEqual({ ruleKey: later.ruleKey, value: 'later' });
    });

    it('ends evaluation after a matching rule that stops processing', () => {
      const first = rule([netflix], [setCategory(1)], { position: 1, stopProcessing: true });
      const second = rule([netflix], [setCategory(2)], { position: 2 });

      const result = evaluateRules([second, first], facts());

      expect(result.matchedRuleKeys).toEqual([first.ruleKey]);
      expect(result.changes.category).toEqual({ categoryKey: 1, ruleKey: first.ruleKey });
    });

    it('keeps going past a rule that stops processing but did not match', () => {
      const first = rule([{ field: 'merchant', operator: 'equals', value: 'spotify' }], [setCategory(1)], { position: 1, stopProcessing: true });
      const second = rule([netflix], [setCategory(2)], { position: 2 });

      expect(evaluateRules([first, second], facts()).changes.category).toEqual({ categoryKey: 2, ruleKey: second.ruleKey });
    });

    it('judges every rule against the transaction as it arrived, not as earlier rules left it', () => {
      const rename = rule([netflix], [{ merchantName: 'Streaming', type: 'set_merchant' }], { position: 1 });
      const byNewName = rule([{ field: 'merchant', operator: 'equals', value: 'streaming' }], [setCategory(9)], { position: 2 });

      expect(evaluateRules([rename, byNewName], facts()).matchedRuleKeys).toEqual([rename.ruleKey]);
    });

    it('drops a change a later rule undoes', () => {
      const first = rule([netflix], [setCategory(5)], { position: 1 });
      const back = rule([netflix], [setCategory(42)], { position: 2 });

      expect(hasChanges(evaluateRules([first, back], facts({ categoryKey: 42 })))).toBe(false);
    });

    it('skips inactive rules', () => {
      const inactive = rule([netflix], [setCategory(1)], { active: false });
      expect(evaluateRules([inactive], facts()).matchedRuleKeys).toEqual([]);
    });

    it('adds tags from every matching rule, each once', () => {
      const first = rule([netflix], [{ tagIds: [1, 2], type: 'add_tags' }], { position: 1 });
      const second = rule([netflix], [{ tagIds: [2, 3], type: 'add_tags' }], { position: 2 });

      expect(evaluateRules([first, second], facts()).changes.addTags).toEqual([
        { ruleKey: first.ruleKey, tagKey: 1 },
        { ruleKey: first.ruleKey, tagKey: 2 },
        { ruleKey: second.ruleKey, tagKey: 3 },
      ]);
    });
  });

  describe('fields the user set by hand', () => {
    const netflix: RuleCondition = { field: 'merchant', operator: 'contains', value: 'netflix' };
    const everything: RuleAction[] = [setCategory(1), { merchantName: 'Other', type: 'set_merchant' }, { type: 'set_description', value: 'Other' }, { type: 'set_notes', value: 'Other' }];

    it('never changes a category, merchant or description the user set', () => {
      const result = evaluateRules([rule([netflix], everything)], facts({ categoryKey: 3, userEdited: { category: true, description: true, merchant: true } }));

      expect(result.changes.category).toBeUndefined();
      expect(result.changes.merchant).toBeUndefined();
      expect(result.changes.description).toBeUndefined();
    });

    it('protects each field on its own', () => {
      const result = evaluateRules([rule([netflix], everything)], facts({ userEdited: { category: false, description: true, merchant: false } }));

      expect(result.changes.description).toBeUndefined();
      expect(result.changes.category).toBeDefined();
      expect(result.changes.merchant).toBeDefined();
    });

    it('never overwrites notes someone wrote', () => {
      const result = evaluateRules([rule([netflix], everything)], facts({ notes: 'Shared with Ana' }));

      expect(result.changes.notes).toBeUndefined();
    });

    it('still counts the rule as matched, and stop processing still applies', () => {
      const protectedRule = rule([netflix], [setCategory(1)], { position: 1, stopProcessing: true });
      const next = rule([netflix], [{ type: 'hide' }], { position: 2 });

      const result = evaluateRules([protectedRule, next], facts({ categoryKey: 3, userEdited: { category: true, description: false, merchant: false } }));

      expect(result.matchedRuleKeys).toEqual([protectedRule.ruleKey]);
      expect(hasChanges(result)).toBe(false);
    });
  });

  describe('whose transactions a rule may touch', () => {
    const netflix: RuleCondition = { field: 'merchant', operator: 'contains', value: 'netflix' };
    const ownersPrivate = { accountKey: 200, isPrivate: true, ownerAppuserKey: OWNER };

    it('acts on a shared account\'s transaction whoever owns the rule', () => {
      const partners = rule([netflix], [setCategory(1)], { ownerAppuserKey: PARTNER });
      expect(evaluateRules([partners], facts()).matchedRuleKeys).toEqual([partners.ruleKey]);
    });

    it('acts on a private account\'s transaction only for the account owner\'s rules', () => {
      const owners = rule([netflix], [setCategory(1)], { ownerAppuserKey: OWNER, position: 1 });
      const partners = rule([netflix], [{ type: 'hide' }], { ownerAppuserKey: PARTNER, position: 2 });

      const result = evaluateRules([owners, partners], facts({ account: ownersPrivate }));

      expect(result.matchedRuleKeys).toEqual([owners.ruleKey]);
      expect(result.changes.hidden).toBeUndefined();
    });

    it('does not let a rule nobody owns any more touch a private account', () => {
      const orphan = rule([netflix], [setCategory(1)], { ownerAppuserKey: null });
      expect(evaluateRules([orphan], facts({ account: ownersPrivate })).matchedRuleKeys).toEqual([]);
      expect(evaluateRules([orphan], facts()).matchedRuleKeys).toEqual([orphan.ruleKey]);
    });

    it('acts on a transaction without an account within the household', () => {
      const partners = rule([netflix], [setCategory(1)], { ownerAppuserKey: PARTNER });
      expect(evaluateRules([partners], facts({ account: null })).matchedRuleKeys).toEqual([partners.ruleKey]);
    });

    it('never acts on another household\'s transaction', () => {
      const neighbours = rule([netflix], [setCategory(1)], { tenantKey: TENANT + 1 });
      expect(evaluateRules([neighbours], facts()).matchedRuleKeys).toEqual([]);
    });

    it('does not let a skipped rule stop the rules after it', () => {
      const partners = rule([netflix], [{ type: 'hide' }], { ownerAppuserKey: PARTNER, position: 1, stopProcessing: true });
      const owners = rule([netflix], [setCategory(1)], { ownerAppuserKey: OWNER, position: 2 });

      expect(evaluateRules([partners, owners], facts({ account: ownersPrivate })).matchedRuleKeys).toEqual([owners.ruleKey]);
    });
  });
});
