import { createHash } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { sql } from 'kysely';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { sqlQuery } from '@app/database/sql';
import { Appuser } from '@entity/Appuser';
import { AppuserMerchantCategory } from '@entity/AppuserMerchantCategory';
import type { Category } from '@entity/Category';
import { RuleSuggestionDismissal } from '@entity/RuleSuggestionDismissal';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { visibleAccountSql } from '@service/account/account-visibility-sql';
import { MANUAL_CATEGORIZATION_SOURCE } from '@service/transaction/transaction-audit.service';
import { learnedMappingRecognises } from '@service/transaction/transaction-deterministic-categorization.service';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

import { loadRuleSet, toTransactionFacts, TRANSACTION_FACTS_POPULATE } from './rule-application.service';
import { evaluateRules } from './rule-engine';
import { MAX_TEXT_LENGTH, type RuleAction, type RuleCondition } from './rule-schema';
import { descriptionPrefixCandidates, RULE_SUGGESTION_POLICY } from './rule-suggestion-pattern';

/**
 * "Always categorize transactions like this as Groceries?": after a member recategorizes by
 * hand, offer the rule that would have done it for them.
 *
 * A pattern is the same merchant, or the same cleaned description prefix
 * (`rule-suggestion-pattern.ts`), moved to the same category by this member's own manual changes
 * at least {@link RULE_SUGGESTION_POLICY}`.minMatches` times within `windowDays`. A bulk change
 * counts once per transaction. Each transaction counts once, by its latest manual change, and
 * only while it is still in that category.
 *
 * Manual means the member did it themselves: the audit entries the transaction edit and the bulk
 * update write (`MANUAL_CATEGORIZATION_SOURCE`). A confirmed assistant proposal, a rule, learned
 * or AI categorization, and imports write other sources or none, so they never count.
 *
 * A pattern is not suggested when the household's active rules would already categorize every
 * transaction in it that way, when the member's learned merchant mapping already would (the
 * description is exactly the merchant's name, which is all learned categorization recognises),
 * or when the member dismissed the same suggestion.
 *
 * Scoping: the history is the member's own audit entries in this household, on transactions
 * they can still see: the other member's private-account transactions never count, even ones
 * categorized before the account was made private.
 */

export interface RuleSuggestion {
  category: { categoryKey: number; name: string };
  /** Identifies the suggestion (pattern and category) for `POST /v1/rule/suggestions/dismiss`. */
  fingerprint: string;
  kind: RuleSuggestionKind;
  /** How many transactions the member moved this way within the window, this change included. */
  matchCount: number;
  /** A rule ready for `POST /v1/rule` (or the editor, to preview first). */
  rule: { actions: RuleAction[]; conditions: RuleCondition[]; match: 'all'; name: string; stopProcessing: false };
  windowDays: number;
}

export interface RuleSuggestionInput {
  appuserKey: number;
  /** Already resolved through `findAssignableCategory`. */
  category: Category;
  now?: Date;
  tenantKey: number;
  /** The transactions this change moved into `category` (not ones that already had it). */
  transactionKeys: number[];
}

export type RuleSuggestionKind = 'description' | 'merchant';

interface Candidate {
  /** The pattern's grouping key: a merchant key or a normalized description prefix. */
  key: string;
  kind: RuleSuggestionKind;
  rows: HistoryRow[];
  rule: RuleSuggestion['rule'];
}

interface HistoryRow {
  description: null | string;
  merchantKey: null | number;
  merchantName: null | string;
  transactionKey: number;
}

/** Suggestions checked against rules, mappings and dismissals before giving up, best first. */
const MAX_CANDIDATES_CHECKED = 10;
const RULE_NAME_MAX_LENGTH = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Best-effort: a failure here never fails the category change it follows. */
export async function suggestRuleAfterRecategorization(em: EntityManager, input: RuleSuggestionInput): Promise<null | RuleSuggestion> {
  if (input.transactionKeys.length === 0) return null;
  try {
    return await findSuggestion(em, input);
  } catch (error) {
    logger.warn({ errorMessage: error instanceof Error ? error.message : 'Unknown error', tenantKey: input.tenantKey }, 'Rule suggestion failed');
    return null;
  }
}

/** "Don't suggest this again", for this member. Idempotent. */
export async function dismissRuleSuggestion(em: EntityManager, appuserKey: number, fingerprint: string): Promise<void> {
  await em.execute(
    `insert into "rule_suggestion_dismissal" ("appuser_key", "fingerprint", "created_at") values (?, ?, now())
     on conflict ("appuser_key", "fingerprint") do nothing`,
    [appuserKey, fingerprint],
  );
}

async function findSuggestion(em: EntityManager, input: RuleSuggestionInput): Promise<null | RuleSuggestion> {
  const { appuserKey, category, tenantKey } = input;
  const history = await loadHistory(em, input);
  const changed = new Set(input.transactionKeys);
  const current = history.filter((row) => changed.has(row.transactionKey));
  if (current.length === 0) return null;

  const candidates = buildCandidates(current, history, category).slice(0, MAX_CANDIDATES_CHECKED);
  if (candidates.length === 0) return null;

  const fingerprinted = candidates.map((candidate) => ({ candidate, fingerprint: fingerprintOf(candidate.kind, candidate.key, category.categoryKey) }));
  const dismissed = new Set((await em.find(RuleSuggestionDismissal, { appuserKey: getRef(em, Appuser, appuserKey), fingerprint: { $in: fingerprinted.map((entry) => entry.fingerprint) } })).map((row) => row.fingerprint));

  for (const { candidate, fingerprint } of fingerprinted) {
    if (dismissed.has(fingerprint)) continue;
    if (await coveredAlready(em, { appuserKey, category, rows: candidate.rows, tenantKey })) continue;
    return {
      category: { categoryKey: category.categoryKey, name: category.name },
      fingerprint,
      kind: candidate.kind,
      matchCount: candidate.rows.length,
      rule: candidate.rule,
      windowDays: RULE_SUGGESTION_POLICY.windowDays,
    };
  }
  return null;
}

/**
 * The transactions this member moved into `category` by hand within the window: one row per
 * transaction, by its latest manual change that actually changed its category, still in that
 * category, and still visible to the member. Raw SQL, so tenant and privacy are explicit.
 */
async function loadHistory(em: EntityManager, input: RuleSuggestionInput): Promise<HistoryRow[]> {
  const { appuserKey, category, tenantKey } = input;
  const since = new Date((input.now ?? new Date()).getTime() - RULE_SUGGESTION_POLICY.windowDays * DAY_MS);
  const sources = Object.values(MANUAL_CATEGORIZATION_SOURCE);
  const result = await sql<{ description: null | string; merchant_key: null | number; merchant_name: null | string; transaction_key: number }>`
    with latest as (
      select distinct on (l.transaction_key) l.transaction_key, l.changes -> 'categoryKey' ->> 'to' as to_category
        from transaction_audit_log l
       where l.tenant_key = ${tenantKey}
         and l.appuser_key = ${appuserKey}
         and l.actor_appuser_key = ${appuserKey}
         and l.actor_type = ${TransactionAuditActorType.USER}
         and l.event_type = ${TransactionAuditEventType.CATEGORIZED}
         and l.source = any(${sources})
         and l.created_at >= ${since}
         and (l.changes -> 'categoryKey' ->> 'from') is distinct from (l.changes -> 'categoryKey' ->> 'to')
       order by l.transaction_key, l.created_at desc, l.transaction_audit_log_key desc
    )
    select t.transaction_key, coalesce(t.description, t.description_dirty) as description,
           m.transaction_merchant_key as merchant_key, m.name as merchant_name
      from latest
      join transaction t on t.transaction_key = latest.transaction_key
      left join account a on a.account_key = t.account_key
      left join transaction_merchant m on m.transaction_merchant_key = t.transaction_merchant_key and m.deleted_at is null
     where latest.to_category = ${String(category.categoryKey)}
       and t.tenant_key = ${tenantKey}
       and t.deleted_at is null
       and (t.account_key is null or (a.deleted_at is null and ${sql.raw(visibleAccountSql('a', appuserKey))}))
       and exists (
         select 1 from appuser_transaction_category atc
          where atc.transaction_key = t.transaction_key and atc.category_key = ${category.categoryKey} and atc.deleted_at is null
       )
  `.execute(sqlQuery(em));
  return result.rows.map((row) => ({ description: row.description, merchantKey: row.merchant_key, merchantName: row.merchant_name, transactionKey: row.transaction_key }));
}

/**
 * The patterns among the changed transactions with enough history, best first: more matches,
 * then a merchant before a description, then a longer (more specific) prefix.
 */
function buildCandidates(current: HistoryRow[], history: HistoryRow[], category: Category): Candidate[] {
  const { minMatches } = RULE_SUGGESTION_POLICY;
  const setCategory: RuleAction = { categoryId: category.categoryKey, type: 'set_category' };

  // One pass over the history: its rows by merchant and by every description prefix they have, so
  // a bulk change of thousands of rows never compares each with every other.
  const byMerchant = new Map<number, HistoryRow[]>();
  const byPrefix = new Map<string, { anchored: boolean; rows: HistoryRow[] }>();
  for (const row of history) {
    if (row.merchantKey !== null) byMerchant.set(row.merchantKey, [...(byMerchant.get(row.merchantKey) ?? []), row]);
    for (const prefix of descriptionPrefixCandidates(row.description)) {
      const group = byPrefix.get(prefix.key) ?? { anchored: true, rows: [] };
      group.rows.push(row);
      group.anchored &&= prefix.operator === 'starts_with';
      byPrefix.set(prefix.key, group);
    }
  }

  const byKey = new Map<string, Candidate>();
  for (const row of current) {
    if (row.merchantKey !== null && row.merchantName && !byKey.has(`merchant:${row.merchantKey}`)) {
      const value = row.merchantName.slice(0, MAX_TEXT_LENGTH);
      byKey.set(`merchant:${row.merchantKey}`, { key: String(row.merchantKey), kind: 'merchant', rows: byMerchant.get(row.merchantKey) ?? [], rule: ruleOf(value, [{ field: 'merchant', operator: 'equals', value }], setCategory) });
    }
    for (const prefix of descriptionPrefixCandidates(row.description)) {
      if (byKey.has(`description:${prefix.key}`)) continue;
      const group = byPrefix.get(prefix.key) ?? { anchored: true, rows: [] };
      // `starts_with` only when the prefix opens every description; a header before it needs `contains`.
      const operator = group.anchored ? 'starts_with' : 'contains';
      byKey.set(`description:${prefix.key}`, { key: prefix.key, kind: 'description', rows: group.rows, rule: ruleOf(prefix.value, [{ field: 'description', operator, source: 'cleaned', value: prefix.value }], setCategory) });
    }
  }

  return [...byKey.values()]
    .filter((candidate) => candidate.rows.length >= minMatches)
    .sort((a, b) => b.rows.length - a.rows.length || kindRank(a.kind) - kindRank(b.kind) || b.key.length - a.key.length);
}

const kindRank = (kind: RuleSuggestionKind) => (kind === 'merchant' ? 0 : 1);

function ruleOf(name: string, conditions: RuleCondition[], action: RuleAction): RuleSuggestion['rule'] {
  return { actions: [action], conditions, match: 'all', name: name.slice(0, RULE_NAME_MAX_LENGTH), stopProcessing: false };
}

/** The same pattern and category always give the same fingerprint, for any member. */
function fingerprintOf(kind: RuleSuggestionKind, key: string, categoryKey: number): string {
  return createHash('sha256').update(`rule-suggestion:v1:${kind}:${categoryKey}:${key}`).digest('hex');
}

/**
 * Whether a new transaction like each of these would get `category` without the member: from the
 * household's active rules (judged as on arrival, uncategorized and untouched by hand), or from
 * the member's learned merchant mapping.
 */
async function coveredAlready(em: EntityManager, input: { appuserKey: number; category: Category; rows: HistoryRow[]; tenantKey: number }): Promise<boolean> {
  const { appuserKey, category, rows, tenantKey } = input;
  if (await mappingCovers(em, appuserKey, category, rows)) return true;
  const rules = await loadRuleSet(em, tenantKey);
  if (rules.length === 0) return false;
  const transactions = await em.find(
    Transaction,
    { deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey), transactionKey: { $in: rows.map((row) => row.transactionKey) } },
    { filters: { [HIDDEN_FILTER]: false }, populate: [...TRANSACTION_FACTS_POPULATE] },
  );
  return transactions.length > 0 && transactions.every((transaction) => {
    const facts = toTransactionFacts(transaction, tenantKey);
    const arriving = { ...facts, categoryKey: null, userEdited: { ...facts.userEdited, category: false } };
    return evaluateRules(rules, arriving).changes.category?.categoryKey === category.categoryKey;
  });
}

async function mappingCovers(em: EntityManager, appuserKey: number, category: Category, rows: HistoryRow[]): Promise<boolean> {
  const merchantKeys: number[] = [];
  for (const row of rows) {
    if (row.merchantKey === null || !row.merchantName || !learnedMappingRecognises(row.description, row.merchantName)) return false;
    if (!merchantKeys.includes(row.merchantKey)) merchantKeys.push(row.merchantKey);
  }
  const mappings = await em.find(AppuserMerchantCategory, { appuserKey: getRef(em, Appuser, appuserKey), deletedAt: null, transactionMerchantKey: { $in: merchantKeys.map((key) => getRef(em, TransactionMerchant, key)) } }, { filters: false });
  return merchantKeys.every((merchantKey) => {
    const active = mappings.filter((mapping) => mapping.transactionMerchantKey.transactionMerchantKey === merchantKey);
    // Learned categorization uses a mapping only when it is the merchant's one active mapping.
    return active.length === 1 && active[0]?.categoryKey.categoryKey === category.categoryKey;
  });
}
