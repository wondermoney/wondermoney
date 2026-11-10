import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Appuser } from '@entity/Appuser';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { getRef } from '@utils/em-helpers';

import { toTransactionFacts, TRANSACTION_FACTS_POPULATE } from './rule-application.service';
import { type EvaluableRule, evaluateRules, type PlannedChanges } from './rule-engine';
import type { RuleAction, RuleCondition, RuleMatch } from './rule-schema';
import { type Actor, assertReferencesVisible } from './rule.service';

/**
 * What an unsaved rule would do to the household's existing transactions, for the rule editor.
 * It only reads.
 *
 * The draft is judged alone (not after the household's other rules), as the rule's would-be
 * owner, the member previewing, through the same pure engine and the same transaction facts as
 * `applyRulesToTransactions`: the household's live transactions, hidden ones included, the
 * other member's private accounts excluded, and fields a person set by hand protected. So
 * `changeCount` is exactly how many transactions applying this rule on its own would change.
 *
 * Every transaction is read in batches to count exactly; the sample keeps the most recent
 * matches.
 */

export interface RuleDraft {
  actions: RuleAction[];
  conditions: RuleCondition[];
  match: RuleMatch;
}

/** The final change a row would get. Empty when the rule matches but changes nothing. */
export interface RulePreview {
  /** Matching transactions that would change. */
  changeCount: number;
  /** Matching transactions, including those whose fields are already set or protected. */
  matchCount: number;
  /** The most recent matches, newest first, at most `limit`. */
  transactions: RulePreviewRow[];
}

export interface RulePreviewChanges {
  addTagKeys?: number[];
  categoryKey?: number;
  description?: string;
  hidden?: true;
  /** `merchantKey` is null for a merchant the rule would create by name. */
  merchant?: { merchantKey: null | number; name: string };
  notes?: string;
  reviewed?: true;
}

export interface RulePreviewRow {
  accountName: null | string;
  /** Signed settlement amount: negative is money out. */
  amount: null | number;
  categoryKey: null | number;
  changes: RulePreviewChanges;
  currency: null | string;
  description: null | string;
  hidden: boolean;
  merchantName: null | string;
  transactionDate: Date | null;
  transactionKey: number;
}

export const DEFAULT_PREVIEW_LIMIT = 50;
const BATCH_SIZE = 500;

export async function previewRule(em: EntityManager, actor: Actor, draft: RuleDraft, options: { limit?: number } = {}): Promise<RulePreview> {
  await assertReferencesVisible(em, actor, draft.conditions, draft.actions);
  const limit = options.limit ?? DEFAULT_PREVIEW_LIMIT;
  const rule: EvaluableRule = { ...draft, active: true, ownerAppuserKey: actor.appuserKey, position: 0, ruleKey: 0, stopProcessing: false, tenantKey: actor.tenantKey };
  const merchantName = await targetMerchantName(em, actor.tenantKey, draft.actions);

  const reader = em.fork();
  const tenant = getRef(reader, Tenant, actor.tenantKey);
  const owner = getRef(reader, Appuser, actor.appuserKey);
  let matchCount = 0;
  let changeCount = 0;
  let sample: RulePreviewRow[] = [];
  let after = 0;

  for (;;) {
    const where: FilterQuery<Transaction> = {
      // The engine skips the other member's private accounts too; excluding them here keeps
      // their rows out of memory altogether.
      $or: [{ accountKey: null }, { accountKey: { isPrivate: false } }, { accountKey: { accountOwnerAppuserKey: owner } }],
      deletedAt: null,
      tenantKey: tenant,
      transactionKey: { $gt: after },
    };
    const batch = await reader.find(Transaction, where, {
      filters: { [HIDDEN_FILTER]: false },
      limit: BATCH_SIZE,
      orderBy: { transactionKey: 'asc' },
      populate: [...TRANSACTION_FACTS_POPULATE],
    });
    for (const transaction of batch) {
      const evaluation = evaluateRules([rule], toTransactionFacts(transaction, actor.tenantKey));
      if (evaluation.matchedRuleKeys.length === 0) continue;
      matchCount++;
      const changes = toPreviewChanges(evaluation.changes, merchantName);
      if (Object.keys(changes).length > 0) changeCount++;
      sample.push(toRow(transaction, changes));
    }
    sample = newestFirst(sample).slice(0, limit);
    const last = batch.at(-1);
    if (!last || batch.length < BATCH_SIZE) break;
    after = last.transactionKey;
    reader.clear();
  }

  return { changeCount, matchCount, transactions: sample };
}

/** The name of the merchant a `set_merchant` action names, to show in the preview. */
async function targetMerchantName(em: EntityManager, tenantKey: number, actions: RuleAction[]): Promise<null | string> {
  const action = actions.find((candidate) => candidate.type === 'set_merchant');
  if (!action) return null;
  if (action.merchantName !== undefined) return action.merchantName.trim().replace(/\s+/g, ' ');
  const merchant = await em.findOne(TransactionMerchant, { deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey), transactionMerchantKey: action.merchantId });
  return merchant?.name ?? null;
}

function toPreviewChanges(changes: PlannedChanges, merchantName: null | string): RulePreviewChanges {
  const preview: RulePreviewChanges = {};
  if (changes.category) preview.categoryKey = changes.category.categoryKey;
  if (changes.merchant) preview.merchant = { merchantKey: 'merchantKey' in changes.merchant ? changes.merchant.merchantKey : null, name: merchantName ?? '' };
  if (changes.description) preview.description = changes.description.value;
  if (changes.notes) preview.notes = changes.notes.value;
  if (changes.hidden) preview.hidden = true;
  if (changes.reviewed) preview.reviewed = true;
  if (changes.addTags) preview.addTagKeys = changes.addTags.map((added) => added.tagKey);
  return preview;
}

function toRow(transaction: Transaction, changes: RulePreviewChanges): RulePreviewRow {
  return {
    accountName: transaction.accountKey?.accountName ?? null,
    amount: transaction.settlementAmount ?? null,
    categoryKey: transaction.appuserTransactionCategories.getItems()[0]?.categoryKey.categoryKey ?? null,
    changes,
    currency: transaction.settlementCurrencyKey?.code ?? null,
    description: transaction.description ?? transaction.descriptionDirty ?? null,
    hidden: transaction.hidden,
    merchantName: transaction.transactionMerchantKey?.name ?? null,
    transactionDate: transaction.transactionDate ?? null,
    transactionKey: transaction.transactionKey,
  };
}

/** Newest first; undated rows last; ties by the later key. */
function newestFirst(rows: RulePreviewRow[]): RulePreviewRow[] {
  const time = (row: RulePreviewRow) => row.transactionDate?.getTime() ?? Number.NEGATIVE_INFINITY;
  return [...rows].sort((a, b) => time(b) - time(a) || b.transactionKey - a.transactionKey);
}
