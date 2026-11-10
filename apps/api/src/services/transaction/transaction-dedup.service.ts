import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/core';
import { generateInternalTransactionId } from '@wondermoney/shared';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';

/**
 * Centralized transaction dedup.
 *
 * This service is the single place that decides "have we already ingested this
 * exact transaction on this account?" so every path can call it consistently.
 *
 * Identity is deterministic only: provider ids first, then the generated `internalTransactionId`
 * fingerprint (date+amount). Fuzzy matching (amount±tolerance, date window, merchant) is NOT done
 * here — that belongs to the pending→posted bridge and the manual "possible duplicate"
 * hint, never to silent auto-merge of two booked rows.
 */
export interface DedupCriteria {
  accountKey: Account | number;
  // Enable Banking's provider identity — kept as a separate optional field rather than unified
  // with the legacy `nordigenInternalTransactionId`, same as the underlying `Transaction` columns.
  enableBankingTransactionId?: null | string;
  externalTransactionId?: null | string;
  internalTransactionId?: null | string;
  nordigenInternalTransactionId?: null | string;
}

type FindOneCapableEm = Pick<EntityManager, 'findOne'>;

/**
 * `includeHidden`: also match rows the user hid. The bank sync needs this: a hidden row is
 * still the stored copy of that transaction, and the unique provider-id constraints cover it, so a
 * lookup that cannot see it would either fail to refresh it or store the transaction a second time.
 */
export interface DedupLookupOptions { includeHidden?: boolean }

type IdentityTerm = { enableBankingTransactionId: string } | { externalTransactionId: string } | { internalTransactionId: string } | { nordigenInternalTransactionId: string };

/**
 * Returns the existing transaction that matches any supplied identity on the same (non-deleted)
 * account, or null. Returns null without querying when no identity criteria are supplied — there
 * is nothing to dedup on, and an unscoped `$or: []` would match the whole account.
 */
export async function findExistingTransaction(em: FindOneCapableEm, criteria: DedupCriteria, options: DedupLookupOptions = {}): Promise<null | Transaction> {
  const hasProviderId = Boolean(criteria.externalTransactionId || criteria.nordigenInternalTransactionId || criteria.enableBankingTransactionId);
  const orTerms = [
    criteria.externalTransactionId ? { externalTransactionId: criteria.externalTransactionId } : undefined,
    criteria.nordigenInternalTransactionId ? { nordigenInternalTransactionId: criteria.nordigenInternalTransactionId } : undefined,
    criteria.enableBankingTransactionId ? { enableBankingTransactionId: criteria.enableBankingTransactionId } : undefined,
    // The synthetic date+amount `internalTransactionId` fingerprint is a fallback identity
    // ONLY for rows with no provider id (manual/CSV). When a bank id is present it is authoritative —
    // a fingerprint collision must never skip a row that a distinct provider id proves is a separate
    // transaction (a false-positive skip is data loss).
    !hasProviderId && criteria.internalTransactionId ? { internalTransactionId: criteria.internalTransactionId } : undefined,
  ].filter((term): term is IdentityTerm => term !== undefined);

  if (orTerms.length === 0) return null;

  const where = { $or: orTerms, accountKey: criteria.accountKey, deletedAt: undefined } as FilterQuery<Transaction>;
  return options.includeHidden ? em.findOne(Transaction, where, { filters: { [HIDDEN_FILTER]: false } }) : em.findOne(Transaction, where);
}

/** Which identity branch of the `findExistingTransaction` $or matched, for dedup telemetry. */
export interface ExistingTransactionMatch {
  existing: Transaction;
  matchedOn: MatchedOn;
}

export type MatchedOn = 'enableBankingTransactionId' | 'externalTransactionId' | 'internalTransactionId' | 'nordigenInternalTransactionId';

/**
 * Which identity branch a matched row corresponds to, in the same priority order as the `$or`
 * (external → nordigen → enable banking → internal). `findExistingTransaction` only builds `$or`
 * terms from the supplied non-null identities, so a matched row equals the criteria on at least
 * one of them; if none of the provider ids equal the stored row, the match was the internal
 * fingerprint.
 */
function matchedBranch(existing: Transaction, criteria: DedupCriteria): MatchedOn {
  if (criteria.externalTransactionId && existing.externalTransactionId === criteria.externalTransactionId) return 'externalTransactionId';
  if (criteria.nordigenInternalTransactionId && existing.nordigenInternalTransactionId === criteria.nordigenInternalTransactionId) return 'nordigenInternalTransactionId';
  if (criteria.enableBankingTransactionId && existing.enableBankingTransactionId === criteria.enableBankingTransactionId) return 'enableBankingTransactionId';
  return 'internalTransactionId';
}

/**
 * Same result as `findExistingTransaction` but reports which identity branch matched. Lets
 * the caller emit a `DEDUP_SKIPPED` audit row with the `matchedOn` field, so we can
 * measure the rate of false-positive skips caused by the synthetic `internalTransactionId`
 * fingerprint colliding with distinct real transactions. Use the fast `findExistingTransaction` when you don't need the matched-on
 * provenance.
 *
 * Cost: a single `$or` lookup — it delegates to `findExistingTransaction` and derives the matched
 * branch from the returned row, so it adds no extra queries on the sync hot path.
 */
export async function findExistingTransactionWithProvenance(
  em: FindOneCapableEm,
  criteria: DedupCriteria,
  options: DedupLookupOptions = {},
): Promise<ExistingTransactionMatch | null> {
  const existing = await findExistingTransaction(em, criteria, options);
  if (!existing) return null;
  return { existing, matchedOn: matchedBranch(existing, criteria) };
}

/** Feature flag gating application-level dedup detection at ingest. Live by default; set to `off` to disable. */
const TRANSACTION_DEDUP_FLAG = 'TRANSACTION_DEDUP_ENABLED';

interface ManualDedupInput {
  accountKey: Account | number;
  amount: number;
  nordigenInternalTransactionId?: null | string;
  transactionDate: Date;
}

function isDedupEnabled(): boolean {
  const value = (process.env[TRANSACTION_DEDUP_FLAG] ?? 'on').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

/**
 * Warn-and-allow duplicate detection for user-entered (manual/CSV) transactions, reporting which
 * identity branch matched. Manual entries carry no provider id, so the only identity is
 * the date+amount fingerprint — which legitimately collides (two identical coffees the same day).
 * The caller still creates the transaction and only *hints* at a possible duplicate; we never block.
 * Returns null (without querying) when the dedup flag is disabled.
 */
export async function findManualDuplicate(em: FindOneCapableEm, input: ManualDedupInput): Promise<ExistingTransactionMatch | null> {
  if (!isDedupEnabled()) return null;

  const internalTransactionId = generateInternalTransactionId(input.transactionDate, input.amount);
  return findExistingTransactionWithProvenance(em, {
    accountKey: input.accountKey,
    internalTransactionId,
    nordigenInternalTransactionId: input.nordigenInternalTransactionId,
  });
}

/**
 * For a file import: which of `ids` (each a line's own id, an OFX FITID or a statement line's
 * fingerprint) are already on the account, and as which transaction. A file import stores a
 * line's id both as `internalTransactionId` and as the account-unique
 * `nordigenInternalTransactionId`, so either column matching is the same line. Hidden rows count:
 * a hidden row is still the stored copy, and holds the unique id. One query per call.
 */
export async function findImportedTransactionIds(em: Pick<EntityManager, 'find'>, accountKey: number, ids: readonly string[]): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) return new Map();
  const rows = await em.find(
    Transaction,
    { $or: [{ internalTransactionId: { $in: unique } }, { nordigenInternalTransactionId: { $in: unique } }], accountKey, deletedAt: undefined } as FilterQuery<Transaction>,
    { fields: ['transactionKey', 'internalTransactionId', 'nordigenInternalTransactionId'], filters: { [HIDDEN_FILTER]: false }, orderBy: { transactionKey: 'asc' } },
  );
  const wanted = new Set(unique);
  const found = new Map<string, number>();
  for (const row of rows) {
    for (const id of [row.nordigenInternalTransactionId, row.internalTransactionId]) {
      if (id && wanted.has(id) && !found.has(id)) found.set(id, row.transactionKey);
    }
  }
  return found;
}

/** Boolean convenience over {@link findManualDuplicate} for callers that only need the hint. */
export async function isPossibleManualDuplicate(em: FindOneCapableEm, input: ManualDedupInput): Promise<boolean> {
  return (await findManualDuplicate(em, input)) !== null;
}
