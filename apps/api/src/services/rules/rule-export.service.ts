import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { Category } from '@entity/Category';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { Tenant } from '@entity/Tenant';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { visibleAccountWhere } from '@service/account/account-access';
import { getRef } from '@utils/em-helpers';

import {
  type CategoryReference,
  type ExportedAction,
  type ExportedCondition,
  type ExportedRule,
  RULE_EXPORT_FORMAT,
  RULE_EXPORT_VERSION,
  type RulesExportFile,
} from './rule-export.schema';
import { type RuleAction, type RuleCondition, UNCATEGORIZED } from './rule-schema';
import type { Actor } from './rule.service';

interface ActionLookups {
  categoryById: Map<number, Category>;
  merchantNameById: Map<number, string>;
  tagNameById: Map<number, string>;
}

interface ConditionLookups {
  accountNameById: Map<number, string>;
  categoryById: Map<number, Category>;
}

/**
 * Serialize a household's rules into the portable `wondermoney-rules` file.
 *
 * Nothing internal leaves: accounts, merchants and tags are named, a system category by its
 * seeded key and a household category by its own name. Names are resolved through the actor's
 * visibility, so an export never reveals the other member's private account: a rule condition
 * naming one is exported without that value (and the condition is dropped when nothing is left).
 *
 * A rule that cannot be represented at all (every value resolved away, or a reference to a row
 * that no longer exists) is left out rather than exported broken.
 */
export async function exportRules(em: EntityManager, actor: Actor): Promise<RulesExportFile> {
  const tenant = getRef(em, Tenant, actor.tenantKey);
  const [rules, categories, accounts, merchants, tags] = await Promise.all([
    em.find(Rule, { deletedAt: null, tenantKey: tenant }, { orderBy: { position: 'asc', ruleKey: 'asc' } }),
    em.find(Category, { $or: [{ tenantKey: tenant }, { tenantKey: null }], deletedAt: null }),
    em.find(Account, { ...visibleAccountWhere(actor.appuserKey), deletedAt: null, tenantKey: tenant }),
    em.find(TransactionMerchant, { deletedAt: null, tenantKey: tenant }),
    em.find(Tag, { deletedAt: null, tenantKey: tenant }),
  ]);

  const categoryById = new Map(categories.map((category) => [category.categoryKey, category]));
  const accountNameById = new Map(accounts.map((account) => [account.accountKey, account.accountName ?? `Account ${account.accountKey}`]));
  const merchantNameById = new Map(merchants.map((merchant) => [merchant.transactionMerchantKey, merchant.name]));
  const tagNameById = new Map(tags.map((tag) => [tag.tagKey, tag.name]));

  const serialized = rules.flatMap((rule) => {
    const conditions = rule.conditions.flatMap((condition) => serializeCondition(condition, { accountNameById, categoryById }));
    const actions = rule.actions.flatMap((action) => serializeAction(action, { categoryById, merchantNameById, tagNameById }));
    if (conditions.length === 0 || actions.length === 0) return [];
    return [{
      actions,
      active: rule.active,
      conditions,
      match: rule.match,
      name: rule.name,
      stopProcessing: rule.stopProcessing,
    } satisfies ExportedRule];
  });

  return {
    exportedAt: new Date().toISOString(),
    format: RULE_EXPORT_FORMAT,
    rules: serialized,
    version: RULE_EXPORT_VERSION,
  };
}

function serializeAction(action: RuleAction, lookups: ActionLookups): ExportedAction[] {
  switch (action.type) {
    case 'add_tags': {
      const tags = action.tagIds.flatMap((key) => {
        const name = lookups.tagNameById.get(key);
        return name === undefined ? [] : [name];
      });
      return tags.length === 0 ? [] : [{ tags, type: 'add_tags' }];
    }
    case 'set_category': {
      const category = categoryReference(lookups.categoryById.get(action.categoryId));
      return category === undefined ? [] : [{ category, type: 'set_category' }];
    }
    case 'set_merchant': {
      const name = action.merchantName ?? (action.merchantId === undefined ? undefined : lookups.merchantNameById.get(action.merchantId));
      return name === undefined ? [] : [{ merchant: name, type: 'set_merchant' }];
    }
    default:
      return [action];
  }
}

function serializeCondition(condition: RuleCondition, lookups: ConditionLookups): ExportedCondition[] {
  switch (condition.field) {
    case 'account': {
      const values = condition.values.flatMap((key) => {
        const name = lookups.accountNameById.get(key);
        return name === undefined ? [] : [name];
      });
      return values.length === 0 ? [] : [{ ...condition, values }];
    }
    case 'category': {
      const values: CategoryReference[] = [];
      for (const value of condition.values) {
        if (value === UNCATEGORIZED) {
          values.push(UNCATEGORIZED);
          continue;
        }
        const reference = categoryReference(lookups.categoryById.get(value));
        if (reference !== undefined) values.push(reference);
      }
      return values.length === 0 ? [] : [{ ...condition, values }];
    }
    default:
      return [condition];
  }
}

/** A system category by its seeded key; a household's own category by its name. */
function categoryReference(category: Category | undefined): CategoryReference | undefined {
  if (!category) return undefined;
  return category.isSystemCategory ? { system: category.name } : { name: category.name };
}
