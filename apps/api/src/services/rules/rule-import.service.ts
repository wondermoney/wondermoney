import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { Category } from '@entity/Category';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { Tenant } from '@entity/Tenant';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { visibleAccountWhere } from '@service/account/account-access';
import { getRef } from '@utils/em-helpers';
import { BadRequestError } from '@utils/errors';

import {
  type CategoryReference,
  type ExportedRule,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_RULES,
  RULE_EXPORT_FORMAT,
  RULE_EXPORT_VERSION,
  type RulesExportFile,
  rulesExportFileSchema,
} from './rule-export.schema';
import { type RuleAction, ruleActionsSchema, type RuleCondition, ruleConditionsSchema, type RuleMatch, ruleMatchSchema, UNCATEGORIZED } from './rule-schema';
import { type Actor, createRule, MAX_RULES_PER_HOUSEHOLD } from './rule.service';

/**
 * Import a `wondermoney-rules` file into a household.
 *
 * The file is validated against the export schema first, then each rule's names are resolved
 * against the household's own rows. A dry run (the default) answers what would be created,
 * which rules are duplicates of a rule already there, and which references could not be
 * resolved, without writing anything.
 *
 * Resolution rules:
 * - a missing custom category is reported, and created when `createCategories` is confirmed;
 * - a missing system category or tag skips the rule (it cannot be represented);
 * - a missing account imports the rule switched off, without that account condition, because
 *   the account may exist on the other instance but not here.
 *
 * Replace mode removes the household's existing rules in the same transaction that creates the
 * new ones, and only after every rule has been validated, so a failed import leaves the
 * household as it was.
 */
export type RuleImportMode = 'append' | 'replace';
export interface RuleImportOptions {
  /** Replace mode needs this explicit confirmation. */
  confirm: boolean;
  /** Create the missing custom categories the file names. */
  createCategories: boolean;
  dryRun: boolean;
  mode: RuleImportMode;
}

export interface RuleImportResult {
  /** Custom category names the file needs that the household does not have. */
  categoriesToCreate: string[];
  /** Rules that would be (or were) created, in file order. */
  creates: { active: boolean; name: string }[];
  dryRun: boolean;
  /** Rules skipped because a rule with that name already exists. */
  duplicates: { name: string }[];
  /** Rules written, or that would be written. Always 0 on a dry run. */
  imported: number;
  mode: RuleImportMode;
  /** Existing rules replace mode removes (or would remove). */
  removed: number;
  unresolved: RuleImportUnresolved[];
}

export interface RuleImportUnresolved {
  kind: RuleImportUnresolvedKind;
  /** The name (or `system:<key>`) that could not be resolved. */
  reference: string;
  ruleName: string;
}

export type RuleImportUnresolvedKind = 'account' | 'category' | 'tag';

interface ImportPlan {
  categoriesToCreate: string[];
  creates: { active: boolean; name: string }[];
  duplicates: { name: string }[];
  resolvedRules: ResolvedRule[];
  unresolved: RuleImportUnresolved[];
}

interface Lookups {
  accounts: Map<string, Account>;
  customCategories: Map<string, Category>;
  merchants: Map<string, TransactionMerchant>;
  systemCategories: Map<string, Category>;
  tags: Map<string, Tag>;
}

interface ResolvedRule {
  actions: RuleAction[];
  active: boolean;
  conditions: RuleCondition[];
  match: RuleMatch;
  name: string;
  stopProcessing: boolean;
}

type RuleResolution =
  | { kind: 'create'; missingCategories: string[]; rule: ResolvedRule; unresolved: RuleImportUnresolved[] }
  | { kind: 'skip'; missingCategories: string[]; unresolved: RuleImportUnresolved[] };

/** A category the file needs but the household does not have yet. Only valid in a dry run. */
const PENDING_CATEGORY_KEY = Number.MAX_SAFE_INTEGER;

type CategoryResolution =
  | { categoryKey: number; kind: 'resolved' }
  | { kind: 'missing'; name: string }
  | { kind: 'unknown'; reference: string };

export async function importRules(em: EntityManager, actor: Actor, file: unknown, options: RuleImportOptions): Promise<RuleImportResult> {
  const parsed = parseImportFile(file);
  const tenant = getRef(em, Tenant, actor.tenantKey);
  const existingCount = await em.count(Rule, { deletedAt: null, tenantKey: tenant });
  const existingNames = options.mode === 'replace' ? new Set<string>() : new Set((await em.find(Rule, { deletedAt: null, tenantKey: tenant })).map((rule) => normalize(rule.name)));
  const lookups = await loadLookups(em, actor);
  const plan = planImport(parsed.rules, lookups, { createMissingCategories: options.createCategories, existingNames });
  const removed = options.mode === 'replace' ? existingCount : 0;
  const result = toResult(plan, { dryRun: options.dryRun, imported: 0, mode: options.mode, removed });

  if (options.dryRun) return result;

  if (options.mode === 'replace' && !options.confirm) {
    throw new BadRequestError('Replacing the existing rules needs confirmation');
  }

  const resulting = (options.mode === 'replace' ? 0 : existingCount) + plan.creates.length;
  if (resulting > MAX_RULES_PER_HOUSEHOLD) {
    throw new BadRequestError(`A household can have at most ${MAX_RULES_PER_HOUSEHOLD} rules`);
  }

  return em.transactional(async (txEm) => {
    if (options.createCategories) {
      for (const name of plan.categoriesToCreate) {
        txEm.create(Category, {
          bgColor: '#f3f3f3',
          isSystemCategory: false,
          name,
          tenantKey: getRef(txEm, Tenant, actor.tenantKey),
          textColor: '#030303',
        }, { partial: true });
      }
      await txEm.flush();
    }

    // Re-resolve now that the missing categories exist, so the rules carry real keys.
    const finalLookups = await loadLookups(txEm, actor);
    const finalPlan = planImport(parsed.rules, finalLookups, { createMissingCategories: false, existingNames });

    if (options.mode === 'replace') {
      const existing = await txEm.find(Rule, { deletedAt: null, tenantKey: getRef(txEm, Tenant, actor.tenantKey) });
      for (const rule of existing) rule.deletedAt = new Date();
      await txEm.flush();
    }

    for (const rule of finalPlan.resolvedRules) {
      await createRule(txEm, actor, rule);
    }

    return { ...result, imported: finalPlan.resolvedRules.length };
  });
}

/** Validate the uploaded file, with errors a person can act on. */
export function parseImportFile(file: unknown): RulesExportFile {
  let raw = file;

  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > MAX_IMPORT_BYTES) throw new BadRequestError('The file is larger than 1 MB');
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new BadRequestError('The file is not valid JSON');
    }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError('The file is not a WonderMoney rules export');
  }

  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_IMPORT_BYTES) {
    throw new BadRequestError('The file is larger than 1 MB');
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate['format'] !== RULE_EXPORT_FORMAT) throw new BadRequestError('The file is not a WonderMoney rules export');
  if (candidate['version'] !== RULE_EXPORT_VERSION) {
    throw new BadRequestError(`Unsupported rules export version: ${String(candidate['version'])}`);
  }
  if (!Array.isArray(candidate['rules'])) throw new BadRequestError('The file has no rules list');
  if (candidate['rules'].length > MAX_IMPORT_RULES) {
    throw new BadRequestError(`The file has more than ${MAX_IMPORT_RULES} rules`);
  }

  const parsed = rulesExportFileSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'file'}: ${issue.message}`)
      .join('; ');
    throw new BadRequestError(`Invalid rules file: ${details}`);
  }
  return parsed.data;
}

async function loadLookups(em: EntityManager, actor: Actor): Promise<Lookups> {
  const tenant = getRef(em, Tenant, actor.tenantKey);
  const [accounts, categories, merchants, tags] = await Promise.all([
    em.find(Account, { ...visibleAccountWhere(actor.appuserKey), deletedAt: null, tenantKey: tenant }),
    em.find(Category, { $or: [{ tenantKey: tenant }, { tenantKey: null }], deletedAt: null }),
    em.find(TransactionMerchant, { deletedAt: null, tenantKey: tenant }),
    em.find(Tag, { deletedAt: null, tenantKey: tenant }),
  ]);

  const lookup = <T>(rows: T[], key: (row: T) => string | undefined) => {
    const map = new Map<string, T>();
    for (const row of rows) {
      const name = key(row);
      if (name) map.set(normalize(name), row);
    }
    return map;
  };

  return {
    accounts: lookup(accounts, (account) => account.accountName),
    customCategories: lookup(categories.filter((category) => !category.isSystemCategory), (category) => category.name),
    merchants: lookup(merchants, (merchant) => merchant.name),
    systemCategories: lookup(categories.filter((category) => category.isSystemCategory), (category) => category.name),
    tags: lookup(tags, (tag) => tag.name),
  };
}

function planImport(rules: ExportedRule[], lookups: Lookups, options: { createMissingCategories: boolean; existingNames: Set<string> }): ImportPlan {
  const creates: { active: boolean; name: string }[] = [];
  const duplicates: { name: string }[] = [];
  const resolvedRules: ResolvedRule[] = [];
  const unresolved: RuleImportUnresolved[] = [];
  const categoriesToCreate = new Set<string>();
  const seenNames = new Set(options.existingNames);

  for (const rule of rules) {
    const key = normalize(rule.name);
    if (seenNames.has(key)) {
      duplicates.push({ name: rule.name });
      continue;
    }
    seenNames.add(key);

    const resolution = resolveRule(rule, lookups, options.createMissingCategories);
    for (const name of resolution.missingCategories) categoriesToCreate.add(name);

    if (resolution.kind === 'skip') {
      unresolved.push(...resolution.unresolved);
      continue;
    }
    unresolved.push(...resolution.unresolved);
    creates.push({ active: resolution.rule.active, name: resolution.rule.name });
    resolvedRules.push(resolution.rule);
  }

  return { categoriesToCreate: [...categoriesToCreate], creates, duplicates, resolvedRules, unresolved };
}

function resolveCategory(reference: CategoryReference, lookups: Lookups): CategoryResolution {
  if (reference === UNCATEGORIZED) {
    // `set_category` to no category is not a valid action; the export never writes it.
    return { kind: 'unknown', reference: UNCATEGORIZED };
  }
  if ('system' in reference) {
    const category = lookups.systemCategories.get(normalize(reference.system));
    return category ? { categoryKey: category.categoryKey, kind: 'resolved' } : { kind: 'unknown', reference: `system:${reference.system}` };
  }
  const category = lookups.customCategories.get(normalize(reference.name));
  if (category) return { categoryKey: category.categoryKey, kind: 'resolved' };
  return { kind: 'missing', name: reference.name };
}

function resolveRule(rule: ExportedRule, lookups: Lookups, createMissingCategories: boolean): RuleResolution {
  const unresolved: RuleImportUnresolved[] = [];
  const missingCategories = new Set<string>();
  let blockedByOther = false;
  let hardUnresolved = false;
  let inactive = false;

  const conditions: RuleCondition[] = [];
  for (const condition of rule.conditions) {
    if (condition.field === 'account') {
      const values: number[] = [];
      for (const name of condition.values) {
        const account = lookups.accounts.get(normalize(name));
        if (account) values.push(account.accountKey);
        else {
          unresolved.push({ kind: 'account', reference: name, ruleName: rule.name });
          // The account may exist on the other instance but not here: keep the rule, switched off.
          inactive = true;
        }
      }
      if (values.length > 0) conditions.push({ field: 'account', operator: condition.operator, values });
      continue;
    }

    if (condition.field === 'category') {
      const values: (number | typeof UNCATEGORIZED)[] = [];
      for (const reference of condition.values) {
        const resolved = resolveCategory(reference, lookups);
        if (resolved.kind === 'resolved') {
          values.push(resolved.categoryKey);
          continue;
        }
        if (resolved.kind === 'missing') {
          missingCategories.add(resolved.name);
          if (createMissingCategories) values.push(PENDING_CATEGORY_KEY);
          else {
            unresolved.push({ kind: 'category', reference: resolved.name, ruleName: rule.name });
            hardUnresolved = true;
          }
          continue;
        }
        unresolved.push({ kind: 'category', reference: resolved.reference, ruleName: rule.name });
        blockedByOther = true;
        hardUnresolved = true;
      }
      if (values.length > 0) conditions.push({ field: 'category', operator: condition.operator, values });
      continue;
    }

    conditions.push(condition);
  }

  const actions: RuleAction[] = [];
  for (const action of rule.actions) {
    if (action.type === 'set_category') {
      const resolved = resolveCategory(action.category, lookups);
      if (resolved.kind === 'resolved') {
        actions.push({ categoryId: resolved.categoryKey, type: 'set_category' });
        continue;
      }
      if (resolved.kind === 'missing') {
        missingCategories.add(resolved.name);
        if (createMissingCategories) actions.push({ categoryId: PENDING_CATEGORY_KEY, type: 'set_category' });
        else {
          unresolved.push({ kind: 'category', reference: resolved.name, ruleName: rule.name });
          hardUnresolved = true;
        }
        continue;
      }
      unresolved.push({ kind: 'category', reference: resolved.reference, ruleName: rule.name });
      blockedByOther = true;
      hardUnresolved = true;
      continue;
    }

    if (action.type === 'set_merchant') {
      const merchant = lookups.merchants.get(normalize(action.merchant));
      actions.push(merchant ? { merchantId: merchant.transactionMerchantKey, type: 'set_merchant' } : { merchantName: action.merchant, type: 'set_merchant' });
      continue;
    }

    if (action.type === 'add_tags') {
      const tagIds = action.tags.flatMap((name) => {
        const tag = lookups.tags.get(normalize(name));
        if (tag) return [tag.tagKey];
        unresolved.push({ kind: 'tag', reference: name, ruleName: rule.name });
        blockedByOther = true;
        hardUnresolved = true;
        return [];
      });
      if (tagIds.length > 0) actions.push({ tagIds, type: 'add_tags' });
      continue;
    }

    actions.push(action);
  }

  if (hardUnresolved) return { kind: 'skip', missingCategories: blockedByOther ? [] : [...missingCategories], unresolved };

  if (conditions.length === 0 || actions.length === 0) {
    // Only an unresolved account can empty a rule without also being a hard failure.
    if (unresolved.length === 0) throw new BadRequestError(`Rule "${rule.name}" has no conditions or actions left after resolving its references`);
    return { kind: 'skip', missingCategories: [...missingCategories], unresolved };
  }

  const parsedConditions = ruleConditionsSchema.safeParse(conditions);
  const parsedActions = ruleActionsSchema.safeParse(actions);
  const parsedMatch = ruleMatchSchema.safeParse(rule.match);
  if (!parsedConditions.success || !parsedActions.success || !parsedMatch.success) {
    throw new BadRequestError(`Rule "${rule.name}" is not a valid rule`);
  }

  return {
    kind: 'create',
    missingCategories: [...missingCategories],
    rule: {
      actions: parsedActions.data,
      active: inactive ? false : rule.active,
      conditions: parsedConditions.data,
      match: parsedMatch.data,
      name: rule.name,
      stopProcessing: rule.stopProcessing,
    },
    unresolved,
  };
}

function toResult(plan: ImportPlan, extra: Pick<RuleImportResult, 'dryRun' | 'imported' | 'mode' | 'removed'>): RuleImportResult {
  return {
    categoriesToCreate: plan.categoriesToCreate,
    creates: plan.creates,
    dryRun: extra.dryRun,
    duplicates: plan.duplicates,
    imported: extra.imported,
    mode: extra.mode,
    removed: extra.removed,
    unresolved: plan.unresolved,
  };
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();
