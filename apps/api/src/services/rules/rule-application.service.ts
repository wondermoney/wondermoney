import type { EntityManager as CoreEntityManager, FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import type { Category } from '@entity/Category';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { Tenant } from '@entity/Tenant';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { linkTags } from '@service/tag/tag.service';
import { findAssignableCategory } from '@service/transaction/household-category';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

import { type EvaluableRule, evaluateRules, hasChanges, type PlannedChanges, type RuleEvaluation, type TransactionFacts } from './rule-engine';
import { ruleActionsSchema, ruleConditionsSchema, ruleMatchSchema } from './rule-schema';

/**
 * The edge around the pure rules engine: load a household's rules and transactions, evaluate,
 * and write what the engine planned, with one audit entry per changed transaction.
 *
 * New transactions go through {@link applyRulesToNewTransactions}: bank sync, file import and
 * manual or OCR entry call it once per batch, right after the rows are stored and before learned
 * categorization (which skips a transaction that already has a category, so a rule's category
 * wins). A rule's category is high confidence, which keeps the transaction out of AI enrichment.
 * Rules never learn merchant mappings.
 *
 * Scoping: every query names the tenant explicitly, so it holds in a worker (no tenant filter)
 * as in a request. Which rules may act on which transaction (private accounts) is decided by
 * the engine from the facts loaded here.
 */

type AuditChanges = Record<string, { from: unknown; to: unknown }>;

/** Relations `toTransactionFacts` reads. */
export const TRANSACTION_FACTS_POPULATE = ['accountKey', 'appuserTransactionCategories.categoryKey', 'settlementCurrencyKey', 'transactionMerchantKey', 'transactionTags', 'transactionTypeKey'] as const;

/**
 * The household's active rules, as the engine reads them. A stored rule whose conditions or
 * actions no longer read as the current shape is skipped (and logged), so one broken row cannot
 * stop the others.
 */
export async function loadRuleSet(em: EntityManager, tenantKey: number): Promise<EvaluableRule[]> {
  const rules = await em.find(Rule, { active: true, deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey) }, { orderBy: { position: 'asc', ruleKey: 'asc' } });
  return toEvaluableRules(rules, tenantKey);
}

/**
 * One of the household's live rules, as the engine reads it, to be judged on its own: it counts
 * as active even when switched off. Null when the household has no such rule, or it no longer
 * reads as a valid rule.
 */
export async function loadSingleRule(em: EntityManager, tenantKey: number, ruleKey: number): Promise<EvaluableRule | null> {
  const rule = await em.findOne(Rule, { deletedAt: null, ruleKey, tenantKey: getRef(em, Tenant, tenantKey) });
  if (!rule) return null;
  const [evaluable] = toEvaluableRules([rule], tenantKey);
  return evaluable ? { ...evaluable, active: true } : null;
}

function toEvaluableRules(rules: Rule[], tenantKey: number): EvaluableRule[] {
  return rules.flatMap((rule) => {
    const conditions = ruleConditionsSchema.safeParse(rule.conditions);
    const actions = ruleActionsSchema.safeParse(rule.actions);
    const match = ruleMatchSchema.safeParse(rule.match);
    if (!conditions.success || !actions.success || !match.success) {
      logger.warn({ ruleKey: rule.ruleKey, tenantKey }, 'Skipping a stored rule that does not read as a valid rule');
      return [];
    }
    return [{
      actions: actions.data,
      active: rule.active,
      conditions: conditions.data,
      match: match.data,
      ownerAppuserKey: rule.ownerAppuserKey?.appuserKey ?? null,
      position: rule.position,
      ruleKey: rule.ruleKey,
      stopProcessing: rule.stopProcessing,
      tenantKey,
    }];
  });
}

/** A transaction loaded with {@link TRANSACTION_FACTS_POPULATE}, as the engine reads it. */
export function toTransactionFacts(transaction: Transaction, tenantKey: number): TransactionFacts {
  const account = transaction.accountKey;
  return {
    account: account ? { accountKey: account.accountKey, isPrivate: account.isPrivate, ownerAppuserKey: account.accountOwnerAppuserKey?.appuserKey ?? null } : null,
    amount: transaction.settlementAmount ?? null,
    categoryKey: currentCategory(transaction)?.categoryKey ?? null,
    currency: transaction.settlementCurrencyKey?.code ?? null,
    description: transaction.description ?? null,
    hidden: transaction.hidden,
    merchant: transaction.transactionMerchantKey ? { merchantKey: transaction.transactionMerchantKey.transactionMerchantKey, name: transaction.transactionMerchantKey.name } : null,
    notes: transaction.notes ?? null,
    rawDescription: transaction.descriptionDirty ?? null,
    reviewed: transaction.reviewed,
    tagKeys: transaction.transactionTags.getItems().map((link) => link.tagKey.tagKey),
    tenantKey,
    transactionKey: transaction.transactionKey,
    transactionType: transaction.transactionTypeKey?.name ?? null,
    userEdited: {
      category: transaction.categorizationReason === 'user_edit',
      description: transaction.descriptionEditedByUser,
      merchant: transaction.merchantEditedByUser,
    },
  };
}

/**
 * Run the household's rules over these transactions and write the changes. Keys that are not
 * the household's live transactions are ignored. Returns the evaluations that changed
 * something, with only the changes actually written (a category or tag deleted since the rule
 * was saved is skipped).
 */
export async function applyRulesToTransactions(em: EntityManager, tenantKey: number, transactionKeys: number[]): Promise<RuleEvaluation[]> {
  if (transactionKeys.length === 0) return [];
  return em.transactional(async (txEm) => {
    const rules = await loadRuleSet(txEm, tenantKey);
    if (rules.length === 0) return [];
    const transactions = await txEm.find(
      Transaction,
      { deletedAt: null, tenantKey: getRef(txEm, Tenant, tenantKey), transactionKey: { $in: [...new Set(transactionKeys)] } },
      // A hidden transaction is still the household's; rules may change it.
      { filters: { [HIDDEN_FILTER]: false }, populate: [...TRANSACTION_FACTS_POPULATE] },
    );

    const applied = await evaluateAndWrite(new ChangeWriter(txEm, tenantKey, rules), rules, transactions, tenantKey);
    await txEm.flush();
    return applied;
  });
}

/** Which rules a batch runs, over what, and as whom. */
export interface RuleBatchInput {
  /** Only transactions with a greater key; the batch takes the next `limit` by key. */
  afterKey: number;
  /**
   * `false` runs in a database transaction and writes; `true` only counts what would be written.
   * The same lookups decide both, so a dry run's count is what the real run changes.
   */
  dryRun: boolean;
  limit: number;
  rules: EvaluableRule[];
  tenantKey: number;
  /**
   * The member the run is for: the other member's private accounts are left out of the batch
   * altogether, whatever a rule's owner could see.
   */
  viewerAppuserKey: number;
}

export interface RuleBatchResult {
  changed: number;
  /** The last key read; null when no transaction was left. */
  lastKey: null | number;
  scanned: number;
}

/**
 * The household's live transactions the viewer can see, hidden ones included: the rows a rule
 * run goes through.
 */
export function ruleRunTransactionsWhere(em: EntityManager, tenantKey: number, viewerAppuserKey: number): FilterQuery<Transaction> {
  return {
    $or: [{ accountKey: null }, { accountKey: { isPrivate: false } }, { accountKey: { accountOwnerAppuserKey: getRef(em, Appuser, viewerAppuserKey) } }],
    deletedAt: null,
    tenantKey: getRef(em, Tenant, tenantKey),
  };
}

/**
 * Run `rules` over the next batch of the household's transactions, by key. A real run writes
 * inside one database transaction; `beforeCommit` runs in it last, with the batch's result, so
 * whatever it records commits or rolls back with the batch's changes.
 */
export async function applyRulesToBatch(
  em: EntityManager,
  input: RuleBatchInput,
  beforeCommit?: (txEm: EntityManager, result: RuleBatchResult) => Promise<void>,
): Promise<RuleBatchResult> {
  const run = async (batchEm: EntityManager): Promise<RuleBatchResult> => {
    const transactions = await batchEm.find(
      Transaction,
      { $and: [ruleRunTransactionsWhere(batchEm, input.tenantKey, input.viewerAppuserKey), { transactionKey: { $gt: input.afterKey } }] },
      { filters: { [HIDDEN_FILTER]: false }, limit: input.limit, orderBy: { transactionKey: 'asc' }, populate: [...TRANSACTION_FACTS_POPULATE] },
    );
    const writer = new ChangeWriter(batchEm, input.tenantKey, input.rules, { dryRun: input.dryRun });
    const applied = await evaluateAndWrite(writer, input.rules, transactions, input.tenantKey);
    const result = { changed: applied.length, lastKey: transactions.at(-1)?.transactionKey ?? null, scanned: transactions.length };
    if (!input.dryRun) {
      await batchEm.flush();
      await beforeCommit?.(batchEm, result);
    }
    return result;
  };
  return input.dryRun ? run(em.fork()) : em.fork().transactional(run);
}

async function evaluateAndWrite(writer: ChangeWriter, rules: EvaluableRule[], transactions: Transaction[], tenantKey: number): Promise<RuleEvaluation[]> {
  const applied: RuleEvaluation[] = [];
  for (const transaction of transactions) {
    const evaluation = evaluateRules(rules, toTransactionFacts(transaction, tenantKey));
    if (!hasChanges(evaluation)) continue;
    const written = await writer.write(transaction, evaluation);
    if (written) applied.push(written);
  }
  return applied;
}

/** Where new transactions came from, for the log. */
export type NewTransactionSource = 'account-initial-sync' | 'manual-transaction' | 'transaction-import';

/**
 * Run the household's rules over transactions that were just stored, once for the batch. Called
 * by every path that creates transactions, after the rows are flushed and before learned
 * categorization. Only rows created now are passed, so a re-sync or re-import never applies rules
 * again to a transaction the user may have changed since.
 *
 * Never throws: a failure is logged and the batch is left as stored, because a rule must never
 * fail the sync or import that brought the transactions in. The rules run on a fork, inside the
 * caller's transaction when there is one (a savepoint), so a failure leaves nothing half-written
 * in the caller's unit of work. The caller's copies of the changed transactions are refreshed
 * afterwards, so learned categorization reads what the rules wrote.
 */
export async function applyRulesToNewTransactions(em: CoreEntityManager, tenantKey: number, transactionKeys: number[], source: NewTransactionSource): Promise<RuleEvaluation[]> {
  if (transactionKeys.length === 0) return [];
  let applied: RuleEvaluation[];
  try {
    // Every EntityManager in this app is the PostgreSQL driver's; the core type is what callers hold.
    applied = await applyRulesToTransactions(em.fork({ keepTransactionContext: true }) as EntityManager, tenantKey, transactionKeys);
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error), source, tenantKey, transactions: transactionKeys.length }, 'Applying rules to new transactions failed; left as stored');
    return [];
  }
  if (applied.length === 0) return applied;
  try {
    await em.find(Transaction, { transactionKey: { $in: applied.map((evaluation) => evaluation.transactionKey) } }, { filters: { [HIDDEN_FILTER]: false }, refresh: true });
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error), source, tenantKey }, 'Reloading transactions after rules failed');
  }
  logger.info({ changed: applied.length, source, tenantKey, transactions: transactionKeys.length }, 'Applied rules to new transactions');
  return applied;
}

function currentCategory(transaction: Transaction): Category | undefined {
  return transaction.appuserTransactionCategories.getItems()[0]?.categoryKey;
}

/** Writes planned changes onto loaded transactions, resolving each target within the household. */
class ChangeWriter {
  private readonly categories = new Map<number, Category | null>();
  private readonly dryRun: boolean;
  private readonly merchantsByName = new Map<string, TransactionMerchant>();
  private readonly ownerByRule: Map<number, null | number>;

  /**
   * With `dryRun`, nothing is changed or audited: each change is only checked the way a real
   * write checks it (its category, merchant or tags still exist), so `write` returns exactly what
   * a real write would have written.
   */
  constructor(private readonly em: EntityManager, private readonly tenantKey: number, rules: EvaluableRule[], options: { dryRun?: boolean } = {}) {
    this.ownerByRule = new Map(rules.map((rule) => [rule.ruleKey, rule.ownerAppuserKey]));
    this.dryRun = options.dryRun ?? false;
  }

  async write(transaction: Transaction, evaluation: RuleEvaluation): Promise<null | RuleEvaluation> {
    const { changes } = evaluation;
    const written: PlannedChanges = {};
    const audit: AuditChanges = {};

    if (changes.category && (await this.writeCategory(transaction, changes.category, audit))) written.category = changes.category;
    if (changes.merchant && (await this.writeMerchant(transaction, changes.merchant, audit))) written.merchant = changes.merchant;
    if (changes.description) {
      audit['description'] = { from: transaction.description ?? null, to: changes.description.value };
      if (!this.dryRun) transaction.description = changes.description.value;
      written.description = changes.description;
    }
    if (changes.notes) {
      audit['notes'] = { from: transaction.notes ?? null, to: changes.notes.value };
      if (!this.dryRun) transaction.notes = changes.notes.value;
      written.notes = changes.notes;
    }
    if (changes.reviewed) {
      audit['reviewed'] = { from: transaction.reviewed, to: true };
      if (!this.dryRun) transaction.reviewed = true;
      written.reviewed = changes.reviewed;
    }
    if (changes.hidden) {
      audit['hidden'] = { from: transaction.hidden, to: true };
      if (!this.dryRun) transaction.hidden = true;
      written.hidden = changes.hidden;
    }
    if (changes.addTags) {
      const added = await this.writeTags(transaction, changes.addTags, audit);
      if (added.length > 0) written.addTags = added;
    }

    if (Object.keys(written).length === 0) return null;
    if (!this.dryRun) await this.audit(transaction, evaluation, audit, written);
    return { ...evaluation, changes: written };
  }

  private async audit(transaction: Transaction, evaluation: RuleEvaluation, changes: AuditChanges, written: PlannedChanges): Promise<void> {
    const ruleKeys = [...new Set(Object.values(written).flatMap((change: { ruleKey: number } | { ruleKey: number }[]) => (Array.isArray(change) ? change : [change]).map((item) => item.ruleKey)))].sort((a, b) => a - b);
    const appuserKey = transaction.appuserKey?.appuserKey ?? evaluation.matchedRuleKeys.map((key) => this.ownerByRule.get(key)).find((key) => key != null);
    if (appuserKey == null) return;
    await TransactionAuditService.log(
      this.em,
      {
        accountKey: transaction.accountKey?.accountKey ?? null,
        actorType: TransactionAuditActorType.SYSTEM,
        appuserKey,
        changes: { ...changes, ruleKeys: { from: null, to: ruleKeys } },
        eventType: written.category ? TransactionAuditEventType.CATEGORIZED : TransactionAuditEventType.SYSTEM_EDIT,
        source: 'rule',
        tenantKey: this.tenantKey,
        transactionKey: transaction.transactionKey,
      },
      { flush: false },
    );
  }

  private async writeCategory(transaction: Transaction, change: NonNullable<PlannedChanges['category']>, audit: AuditChanges): Promise<boolean> {
    if (!this.categories.has(change.categoryKey)) this.categories.set(change.categoryKey, await findAssignableCategory(this.em, this.tenantKey, change.categoryKey));
    const category = this.categories.get(change.categoryKey);
    if (!category) return false;
    const assignment = transaction.appuserTransactionCategories.getItems()[0];
    if (this.dryRun) return assignment !== undefined || (transaction.appuserKey?.appuserKey ?? this.ownerByRule.get(change.ruleKey)) != null;
    audit['categoryKey'] = { from: assignment?.categoryKey.categoryKey ?? null, to: category.categoryKey };
    if (assignment) {
      assignment.categoryKey = category;
      assignment.source = Source.RULE;
    } else {
      const appuserKey = transaction.appuserKey?.appuserKey ?? this.ownerByRule.get(change.ruleKey);
      if (appuserKey == null) return false;
      const created = new AppuserTransactionCategory();
      created.appuserKey = transaction.appuserKey ?? getRef(this.em, Appuser, appuserKey);
      created.categoryKey = category;
      created.source = Source.RULE;
      created.transactionKey = transaction;
      this.em.persist(created);
    }
    transaction.categorizationConfidence = CategorizationConfidence.HIGH;
    transaction.categorizationReason = `rule:${change.ruleKey}`;
    return true;
  }

  private async writeMerchant(transaction: Transaction, change: NonNullable<PlannedChanges['merchant']>, audit: AuditChanges): Promise<boolean> {
    const tenant = getRef(this.em, Tenant, this.tenantKey);
    let merchant: null | TransactionMerchant;
    if ('merchantKey' in change) {
      merchant = await this.em.findOne(TransactionMerchant, { deletedAt: null, tenantKey: tenant, transactionMerchantKey: change.merchantKey });
    } else {
      const normalizedName = normalizeMerchantName(change.merchantName);
      merchant = this.merchantsByName.get(normalizedName) ?? (await this.em.findOne(TransactionMerchant, { deletedAt: null, normalizedName, tenantKey: tenant }));
      // A merchant a rule names is created when missing, so this write always succeeds.
      if (this.dryRun) return true;
      if (!merchant) {
        merchant = new TransactionMerchant();
        merchant.name = change.merchantName.trim().replace(/\s+/g, ' ');
        merchant.normalizedName = normalizedName;
        merchant.tenantKey = tenant;
        // Flushed now so the audit entry can name the new merchant's key.
        await this.em.persist(merchant).flush();
      }
      this.merchantsByName.set(normalizedName, merchant);
    }
    if (!merchant) return false;
    if (this.dryRun) return true;
    audit['transactionMerchantKey'] = { from: transaction.transactionMerchantKey?.transactionMerchantKey ?? null, to: merchant.transactionMerchantKey };
    transaction.transactionMerchantKey = merchant;
    return true;
  }

  private async writeTags(transaction: Transaction, additions: NonNullable<PlannedChanges['addTags']>, audit: AuditChanges): Promise<NonNullable<PlannedChanges['addTags']>> {
    const tags = await this.em.find(Tag, { deletedAt: null, tagKey: { $in: additions.map((added) => added.tagKey) }, tenantKey: getRef(this.em, Tenant, this.tenantKey) });
    const live = new Set(tags.map((tag) => tag.tagKey));
    if (tags.length === 0) return [];
    if (this.dryRun) return additions.filter((added) => live.has(added.tagKey));
    linkTags(this.em, transaction, tags);
    const before = transaction.transactionTags.getItems().map((link) => link.tagKey.tagKey).filter((key) => !live.has(key)).sort((a, b) => a - b);
    audit['tagKeys'] = { from: before, to: [...before, ...live].sort((a, b) => a - b) };
    return additions.filter((added) => live.has(added.tagKey));
  }
}
