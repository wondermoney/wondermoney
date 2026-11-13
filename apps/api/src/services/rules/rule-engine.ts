import { normalizeMerchantName } from '@service/transaction/merchant-normalization';
import { big } from '@utils/money';

import { type RuleAction, type RuleCondition, type RuleMatch, UNCATEGORIZED } from './rule-schema';

/**
 * The rules engine: which of a household's rules match a transaction, and what they would
 * change. A pure function of its inputs, with no database access, so the same call serves
 * applying rules, previewing them and tests. Loading facts and writing the planned changes
 * (with their audit entries) is `rule-application.service.ts`'s job.
 *
 * Semantics:
 * - Rules run in `position` order; inactive rules are skipped.
 * - Every rule is judged against the transaction as it arrived, not as earlier rules left it,
 *   so what a rule matches does not depend on the rules before it.
 * - A later rule overwrites a field an earlier rule set (tags accumulate instead). A matching
 *   rule with `stopProcessing` ends evaluation.
 * - A field the user set by hand is never changed: the category (`user_edit`), the merchant
 *   and the description (their per-field markers), and notes, which only people write.
 *   The rule still counts as matched.
 * - A rule acts only on transactions its owner can see: its own household's, and on a private
 *   account only when the owner is that account's owner. A rule it may not see is skipped as
 *   if absent, so it cannot stop the rules after it either.
 * - Changes are the final difference from the transaction: a field a rule sets to its current
 *   value, or that a later rule sets back, is not a change.
 */

/** What the engine needs to know about one transaction. */
export interface TransactionFacts {
  /** Null for a transaction without an account. */
  account: null | {
    accountKey: number;
    isPrivate: boolean;
    ownerAppuserKey: null | number;
    /** The members a private account is shared with for `write` (an empty list: none, or not loaded). */
    writerAppuserKeys?: readonly number[];
  };
  /** Signed settlement amount, in the account's currency: negative is money out. */
  amount: null | number;
  categoryKey: null | number;
  /** Settlement currency code. */
  currency: null | string;
  /** The tidied description shown in the app. */
  description: null | string;
  hidden: boolean;
  merchant: null | { merchantKey: number; name: string };
  notes: null | string;
  /** The bank's original description text. */
  rawDescription: null | string;
  reviewed: boolean;
  tagKeys: number[];
  tenantKey: number;
  transactionKey: number;
  /** Transaction type name, e.g. `CARD_PAYMENT`. */
  transactionType: null | string;
  /** Fields a person set by hand, which rules never change. */
  userEdited: { category: boolean; description: boolean; merchant: boolean };
}

/** A stored rule, as the engine reads it. */
export interface EvaluableRule {
  actions: RuleAction[];
  active: boolean;
  conditions: RuleCondition[];
  match: RuleMatch;
  /** The member the rule acts for; null once that member is gone. */
  ownerAppuserKey: null | number;
  position: number;
  ruleKey: number;
  stopProcessing: boolean;
  tenantKey: number;
}

/** Each planned change names the rule that made it, for attribution and audit. */
export interface PlannedChanges {
  addTags?: { ruleKey: number; tagKey: number }[];
  category?: { categoryKey: number; ruleKey: number };
  description?: { ruleKey: number; value: string };
  hidden?: { ruleKey: number };
  merchant?: { merchantKey: number; ruleKey: number } | { merchantName: string; ruleKey: number };
  notes?: { ruleKey: number; value: string };
  reviewed?: { ruleKey: number };
}

export interface RuleEvaluation {
  changes: PlannedChanges;
  /** Every rule that matched, in the order it ran, including ones whose actions changed nothing. */
  matchedRuleKeys: number[];
  transactionKey: number;
}

export function evaluateRules(rules: readonly EvaluableRule[], facts: TransactionFacts): RuleEvaluation {
  const ordered = rules.filter((rule) => rule.active && ruleMaySee(rule, facts)).sort((a, b) => a.position - b.position || a.ruleKey - b.ruleKey);
  const planned: PlannedChanges = {};
  const matchedRuleKeys: number[] = [];

  for (const rule of ordered) {
    if (!ruleMatches(rule, facts)) continue;
    matchedRuleKeys.push(rule.ruleKey);
    for (const action of rule.actions) plan(planned, action, rule.ruleKey, facts);
    if (rule.stopProcessing) break;
  }

  return { changes: withoutNoOps(planned, facts), matchedRuleKeys, transactionKey: facts.transactionKey };
}

export function hasChanges(evaluation: RuleEvaluation): boolean {
  return Object.keys(evaluation.changes).length > 0;
}

function conditionMatches(condition: RuleCondition, facts: TransactionFacts): boolean {
  switch (condition.field) {
    case 'account':
      return inList(condition.operator, condition.values, facts.account?.accountKey);
    case 'amount':
      return amountMatches(condition, facts.amount);
    case 'category':
      return inList(condition.operator, condition.values, facts.categoryKey ?? UNCATEGORIZED);
    case 'currency':
      return inList(condition.operator, condition.values, facts.currency?.toUpperCase());
    case 'description': {
      const text = condition.source === 'raw' ? facts.rawDescription ?? facts.description : facts.description ?? facts.rawDescription;
      return textMatches(condition.operator, text, condition.value);
    }
    case 'direction':
      if (facts.amount === null || facts.amount === 0) return false;
      return condition.value === 'out' ? facts.amount < 0 : facts.amount > 0;
    case 'merchant':
      return textMatches(condition.operator, facts.merchant?.name, condition.value);
    case 'transactionType':
      return inList(condition.operator, condition.values, facts.transactionType?.toUpperCase());
  }
}

function ruleMatches(rule: EvaluableRule, facts: TransactionFacts): boolean {
  const test = (condition: RuleCondition) => conditionMatches(condition, facts);
  return rule.match === 'any' ? rule.conditions.some(test) : rule.conditions.every(test);
}

/** A rule changes a row on a private account only when its owner may change that account: they own it, or it is shared with them for `write`. */
function ruleMaySee(rule: EvaluableRule, facts: TransactionFacts): boolean {
  if (rule.tenantKey !== facts.tenantKey) return false;
  const account = facts.account;
  if (!account?.isPrivate) return true;
  if (rule.ownerAppuserKey === null) return false;
  return account.ownerAppuserKey === rule.ownerAppuserKey || (account.writerAppuserKeys ?? []).includes(rule.ownerAppuserKey);
}

/** Lower case, accents removed, spaces collapsed: "  Café  CENTRAL " and "cafe central" are equal. */
const normalizeText = (value: null | string | undefined) => normalizeMerchantName(value ?? '');

function inList<T>(operator: 'in' | 'not_in', values: readonly T[], actual: T | undefined): boolean {
  const found = actual !== undefined && values.includes(actual);
  return operator === 'in' ? found : !found;
}

function textMatches(operator: Extract<RuleCondition, { field: 'merchant' }>['operator'], actual: null | string | undefined, expected: string): boolean {
  const text = normalizeText(actual);
  const needle = normalizeText(expected);
  switch (operator) {
    case 'contains':
      return text.includes(needle);
    case 'ends_with':
      return text.endsWith(needle);
    case 'equals':
      return text === needle;
    case 'not_contains':
      return !text.includes(needle);
    case 'starts_with':
      return text.startsWith(needle);
  }
}

/** Amounts compare without their sign, as exact decimals at the money columns' scale. */
const AMOUNT_SCALE = 4;

function amountMatches(condition: Extract<RuleCondition, { field: 'amount' }>, amount: null | number): boolean {
  if (amount === null) return false;
  const absolute = big(amount).abs().round(AMOUNT_SCALE);
  if (condition.operator === 'between') return absolute.gte(big(condition.min)) && absolute.lte(big(condition.max));
  const bound = big(condition.value);
  switch (condition.operator) {
    case 'eq':
      return absolute.eq(bound);
    case 'gt':
      return absolute.gt(bound);
    case 'gte':
      return absolute.gte(bound);
    case 'lt':
      return absolute.lt(bound);
    case 'lte':
      return absolute.lte(bound);
  }
}

function isCurrentMerchant(merchant: NonNullable<PlannedChanges['merchant']>, current: TransactionFacts['merchant']): boolean {
  if (!current) return false;
  if ('merchantKey' in merchant) return merchant.merchantKey === current.merchantKey;
  return normalizeMerchantName(merchant.merchantName) === normalizeMerchantName(current.name);
}

function plan(planned: PlannedChanges, action: RuleAction, ruleKey: number, facts: TransactionFacts): void {
  switch (action.type) {
    case 'add_tags':
      for (const tagKey of action.tagIds) {
        if (!(planned.addTags ??= []).some((added) => added.tagKey === tagKey)) planned.addTags.push({ ruleKey, tagKey });
      }
      return;
    case 'hide':
      planned.hidden = { ruleKey };
      return;
    case 'mark_reviewed':
      planned.reviewed = { ruleKey };
      return;
    case 'set_category':
      if (!facts.userEdited.category) planned.category = { categoryKey: action.categoryId, ruleKey };
      return;
    case 'set_description':
      if (!facts.userEdited.description) planned.description = { ruleKey, value: action.value };
      return;
    case 'set_merchant':
      if (facts.userEdited.merchant) return;
      planned.merchant = action.merchantId === undefined ? { merchantName: action.merchantName ?? '', ruleKey } : { merchantKey: action.merchantId, ruleKey };
      return;
    case 'set_notes':
      if (!facts.notes?.trim()) planned.notes = { ruleKey, value: action.value };
      return;
  }
}

function withoutNoOps(planned: PlannedChanges, facts: TransactionFacts): PlannedChanges {
  const changes: PlannedChanges = {};
  if (planned.category && planned.category.categoryKey !== facts.categoryKey) changes.category = planned.category;
  if (planned.description && planned.description.value !== facts.description) changes.description = planned.description;
  if (planned.notes && planned.notes.value !== facts.notes) changes.notes = planned.notes;
  if (planned.hidden && !facts.hidden) changes.hidden = planned.hidden;
  if (planned.reviewed && !facts.reviewed) changes.reviewed = planned.reviewed;
  if (planned.merchant && !isCurrentMerchant(planned.merchant, facts.merchant)) changes.merchant = planned.merchant;
  const addTags = planned.addTags?.filter((added) => !facts.tagKeys.includes(added.tagKey));
  if (addTags?.length) changes.addTags = addTags;
  return changes;
}
