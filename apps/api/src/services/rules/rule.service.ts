import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { Tenant } from '@entity/Tenant';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionType } from '@entity/TransactionType';
import { visibleAccountWhere } from '@service/account/account-access';
import { findAssignableCategory } from '@service/transaction/household-category';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import type { CreateRuleInput, UpdateRuleInput } from '@validators/rule';

import { RULE_DEFINITION_VERSION, type RuleAction, type RuleCondition, type RuleMatch, UNCATEGORIZED } from './rule-schema';

/**
 * Managing a household's rules: create, change, delete and reorder.
 *
 * Every read and write is scoped by the explicit tenant passed in (and, in a request, by the
 * tenant filter too). Whatever a rule names (accounts, categories, merchants, tags) must be
 * something its owner can see in the household; a reference that is not is refused with a 400
 * naming the condition or action, whether it is unknown, deleted, another household's or the
 * other member's private account. Running rules lives elsewhere (`rule-application.service.ts`).
 */

/** Bounds the rules evaluated per transaction. */
export const MAX_RULES_PER_HOUSEHOLD = 200;
const CREATE_ATTEMPTS = 3;

export interface Actor {
  appuserKey: number;
  tenantKey: number;
}

export interface RuleDto {
  actions: RuleAction[];
  active: boolean;
  conditions: RuleCondition[];
  createdAt: Date;
  match: RuleMatch;
  name: string;
  /** The member the rule acts for: it only touches transactions they can see. */
  ownerAppuserKey: null | number;
  position: number;
  ruleKey: number;
  stopProcessing: boolean;
  updatedAt: Date;
}

const toRuleDto = (rule: Rule): RuleDto => ({
  actions: rule.actions,
  active: rule.active,
  conditions: rule.conditions,
  createdAt: rule.createdAt,
  match: rule.match,
  name: rule.name,
  ownerAppuserKey: rule.ownerAppuserKey?.appuserKey ?? null,
  position: rule.position,
  ruleKey: rule.ruleKey,
  stopProcessing: rule.stopProcessing,
  updatedAt: rule.updatedAt,
});

/** The household's live rules in run order. */
export async function listRules(em: EntityManager, tenantKey: number): Promise<RuleDto[]> {
  return (await findLiveRules(em, tenantKey)).map(toRuleDto);
}

async function findLiveRules(em: EntityManager, tenantKey: number): Promise<Rule[]> {
  return em.find(Rule, { deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey) }, { orderBy: { position: 'asc', ruleKey: 'asc' } });
}

/** A new rule runs after every existing one. */
export async function createRule(em: EntityManager, actor: Actor, input: CreateRuleInput): Promise<RuleDto> {
  await assertReferencesVisible(em, actor, input.conditions, input.actions);
  for (let attempt = 1; ; attempt++) {
    const existing = await findLiveRules(em, actor.tenantKey);
    if (existing.length >= MAX_RULES_PER_HOUSEHOLD) throw new BadRequestError(`A household can have at most ${MAX_RULES_PER_HOUSEHOLD} rules`);
    const rule = new Rule();
    rule.actions = input.actions;
    rule.active = input.active;
    rule.conditions = input.conditions;
    rule.match = input.match === 'any' ? RuleMatchMode.ANY : RuleMatchMode.ALL;
    rule.name = input.name;
    rule.ownerAppuserKey = getRef(em, Appuser, actor.appuserKey);
    rule.position = Math.max(-1, ...existing.map((other) => other.position)) + 1;
    rule.stopProcessing = input.stopProcessing;
    rule.tenantKey = getRef(em, Tenant, actor.tenantKey);
    rule.version = RULE_DEFINITION_VERSION;
    try {
      await em.persist(rule).flush();
      return toRuleDto(rule);
    } catch (error) {
      // Two rules created at once took the same position: try again at the new end.
      if (!(error instanceof UniqueConstraintViolationException) || attempt >= CREATE_ATTEMPTS) throw error;
      em.clear();
    }
  }
}

/**
 * Change a rule. Changing its conditions or actions makes the actor its owner, and the whole
 * resulting rule must then name only what the actor can see.
 */
export async function updateRule(em: EntityManager, actor: Actor, ruleKey: number, input: UpdateRuleInput): Promise<RuleDto> {
  const rule = await findLiveRule(em, actor.tenantKey, ruleKey);
  if (input.conditions !== undefined || input.actions !== undefined) {
    const conditions = input.conditions ?? rule.conditions;
    const actions = input.actions ?? rule.actions;
    await assertReferencesVisible(em, actor, conditions, actions);
    rule.conditions = conditions;
    rule.actions = actions;
    rule.ownerAppuserKey = getRef(em, Appuser, actor.appuserKey);
    rule.version = RULE_DEFINITION_VERSION;
  }
  if (input.active !== undefined) rule.active = input.active;
  if (input.match !== undefined) rule.match = input.match === 'any' ? RuleMatchMode.ANY : RuleMatchMode.ALL;
  if (input.name !== undefined) rule.name = input.name;
  if (input.stopProcessing !== undefined) rule.stopProcessing = input.stopProcessing;
  await em.flush();
  return toRuleDto(rule);
}

/** Soft delete. The positions of the rules left keep their order; gaps are fine. */
export async function deleteRule(em: EntityManager, actor: Actor, ruleKey: number): Promise<void> {
  const rule = await findLiveRule(em, actor.tenantKey, ruleKey);
  rule.deletedAt = new Date();
  await em.flush();
}

/**
 * Put the household's rules in the order of `ruleKeys`, which must be exactly its live rules.
 * Positions are unique per household, so they move in two steps inside one transaction: first
 * to negative placeholders, then to their new values, never colliding on the way.
 */
export async function reorderRules(em: EntityManager, actor: Actor, ruleKeys: number[]): Promise<RuleDto[]> {
  return em.transactional(async (txEm) => {
    const rules = await findLiveRules(txEm, actor.tenantKey);
    const byKey = new Map(rules.map((rule) => [rule.ruleKey, rule]));
    if (ruleKeys.length !== rules.length || ruleKeys.some((key) => !byKey.has(key))) {
      throw new ConflictError('The list must name every rule of the household exactly once', ERROR_CODE.RULE_ORDER_STALE);
    }
    const ordered = ruleKeys.flatMap((key) => byKey.get(key) ?? []);
    ordered.forEach((rule, index) => (rule.position = -(index + 1)));
    await txEm.flush();
    ordered.forEach((rule, index) => (rule.position = index));
    await txEm.flush();
    return ordered.map(toRuleDto);
  });
}

async function findLiveRule(em: EntityManager, tenantKey: number, ruleKey: number): Promise<Rule> {
  const rule = await em.findOne(Rule, { deletedAt: null, ruleKey, tenantKey: getRef(em, Tenant, tenantKey) });
  if (!rule) throw new NotFoundError('Rule not found');
  return rule;
}

/**
 * Refuse a rule naming anything the actor cannot see in their household. The message names the
 * offending condition or action, like a validation error.
 */
export async function assertReferencesVisible(em: EntityManager, actor: Actor, conditions: RuleCondition[], actions: RuleAction[]): Promise<void> {
  const refuse = (path: string, what: string) => {
    throw new BadRequestError(`Validation error: ${what} not found at "${path}"`);
  };

  for (const [index, condition] of conditions.entries()) {
    const path = `body.conditions[${index}].values`;
    switch (condition.field) {
      case 'account':
        if (!(await accountsVisible(em, actor, condition.values))) refuse(path, 'Account');
        break;
      case 'category':
        for (const value of condition.values) {
          if (value !== UNCATEGORIZED && !(await findAssignableCategory(em, actor.tenantKey, value))) refuse(path, 'Category');
        }
        break;
      case 'currency': {
        const found = await em.count(Currency, { code: { $in: condition.values } });
        if (found !== condition.values.length) refuse(path, 'Currency');
        break;
      }
      case 'transactionType': {
        const known = new Set((await em.find(TransactionType, {})).map((type) => type.name.toUpperCase()));
        if (condition.values.some((value) => !known.has(value))) refuse(path, 'Transaction type');
        break;
      }
      default:
        break;
    }
  }

  const tenant = getRef(em, Tenant, actor.tenantKey);
  for (const [index, action] of actions.entries()) {
    const path = `body.actions[${index}]`;
    switch (action.type) {
      case 'add_tags': {
        const found = await em.count(Tag, { deletedAt: null, tagKey: { $in: action.tagIds }, tenantKey: tenant });
        if (found !== action.tagIds.length) refuse(`${path}.tagIds`, 'Tag');
        break;
      }
      case 'set_category':
        if (!(await findAssignableCategory(em, actor.tenantKey, action.categoryId))) refuse(`${path}.categoryId`, 'Category');
        break;
      case 'set_merchant':
        if (action.merchantId !== undefined) {
          const merchant = await em.findOne(TransactionMerchant, { deletedAt: null, tenantKey: tenant, transactionMerchantKey: action.merchantId });
          if (!merchant) refuse(`${path}.merchantId`, 'Merchant');
        }
        break;
      default:
        break;
    }
  }
}

/** Accounts of the household that are shared or the actor's own: the `Account` filter's rule, stated explicitly. */
async function accountsVisible(em: EntityManager, actor: Actor, accountKeys: number[]): Promise<boolean> {
  const found = await em.count(Account, {
    ...visibleAccountWhere(actor.appuserKey),
    accountKey: { $in: accountKeys },
    deletedAt: null,
    tenantKey: getRef(em, Tenant, actor.tenantKey),
  });
  return found === accountKeys.length;
}
