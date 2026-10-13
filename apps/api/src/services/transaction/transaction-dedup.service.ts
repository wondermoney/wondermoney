import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/core';
import { generateInternalTransactionId } from '@wondermoney/shared';

import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';

/**
 * Centralized transaction dedup (RAD-346, Phase 2).
 *
 * Historically only the GoCardless sync path did an existence check before insert (an inline
 * `$or` over provider ids + the generated fingerprint). The manual, CSV and portfolio ingest
 * paths did none. This service is the single place that decides "have we already ingested this
 * exact transaction on this account?" so every path can call it consistently.
 *
 * Identity is deterministic only: provider ids first, then the generated `internalTransactionId`
 * fingerprint (date+amount). Fuzzy matching (amount±tolerance, date window, merchant) is NOT done
 * here — that belongs to the pending→posted bridge (Phase 4) and the manual "possible duplicate"
 * hint, never to silent auto-merge of two booked rows.
 */
export interface DedupCriteria {
  accountKey: Account | number;
  // Enable Banking's replacement identity for `nordigenInternalTransactionId` (Phase 1d, plan
  // §2/§3) — kept as a separate optional field rather than unifying with the Nordigen one, same
  // rationale as the underlying `Transaction` columns: a provider-swap seam, not a rename.
  enableBankingTransactionId?: null | string;
  externalTransactionId?: null | string;
  internalTransactionId?: null | string;
  nordigenInternalTransactionId?: null | string;
}

type FindOneCapableEm = Pick<EntityManager, 'findOne'>;

type IdentityTerm = { enableBankingTransactionId: string } | { externalTransactionId: string } | { internalTransactionId: string } | { nordigenInternalTransactionId: string };

/**
 * Returns the existing transaction that matches any supplied identity on the same (non-deleted)
 * account, or null. Returns null without querying when no identity criteria are supplied — there
 * is nothing to dedup on, and an unscoped `$or: []` would match the whole account.
 */
export async function findExistingTransaction(em: FindOneCapableEm, criteria: DedupCriteria): Promise<null | Transaction> {
  const hasProviderId = Boolean(criteria.externalTransactionId || criteria.nordigenInternalTransactionId || criteria.enableBankingTransactionId);
  const orTerms = [
    criteria.externalTransactionId ? { externalTransactionId: criteria.externalTransactionId } : undefined,
    criteria.nordigenInternalTransactionId ? { nordigenInternalTransactionId: criteria.nordigenInternalTransactionId } : undefined,
    criteria.enableBankingTransactionId ? { enableBankingTransactionId: criteria.enableBankingTransactionId } : undefined,
    // RAD-393: the synthetic date+amount `internalTransactionId` fingerprint is a fallback identity
    // ONLY for rows with no provider id (manual/CSV). When a bank id is present it is authoritative —
    // a fingerprint collision must never skip a row that a distinct provider id proves is a separate
    // transaction (the class-A false-positive-skip / data-loss case). See
    // docs/plans/2026-08-01-rad-393-fingerprint-tolerance-design.md.
    !hasProviderId && criteria.internalTransactionId ? { internalTransactionId: criteria.internalTransactionId } : undefined,
  ].filter((term): term is IdentityTerm => term !== undefined);

  if (orTerms.length === 0) return null;

  return em.findOne(Transaction, { $or: orTerms, accountKey: criteria.accountKey, deletedAt: undefined } as FilterQuery<Transaction>);
}

/** Which identity branch of the `findExistingTransaction` $or matched. RAD-394 telemetry. */
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
 * Same result as `findExistingTransaction` but reports which identity branch matched. RAD-394:
 * lets the caller emit a `DEDUP_SKIPPED` audit row with the `matchedOn` field, so we can
 * measure the rate of false-positive skips caused by the synthetic `internalTransactionId`
 * fingerprint colliding with distinct real transactions (the design issue called out in
 * RAD-393). Use the fast `findExistingTransaction` when you don't need the matched-on
 * provenance.
 *
 * Cost: a single `$or` lookup — it delegates to `findExistingTransaction` and derives the matched
 * branch from the returned row, so it adds no extra queries on the sync hot path.
 */
export async function findExistingTransactionWithProvenance(
  em: FindOneCapableEm,
  criteria: DedupCriteria,
): Promise<ExistingTransactionMatch | null> {
  const existing = await findExistingTransaction(em, criteria);
  if (!existing) return null;
  return { existing, matchedOn: matchedBranch(existing, criteria) };
}

/** Feature flag gating application-level dedup detection at ingest. Live by default; set to `off` to disable. */
export const TRANSACTION_DEDUP_FLAG = 'TRANSACTION_DEDUP_ENABLED';

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
 * identity branch matched (RAD-394). Manual entries carry no provider id, so the only identity is
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

/** Boolean convenience over {@link findManualDuplicate} for callers that only need the hint. */
export async function isPossibleManualDuplicate(em: FindOneCapableEm, input: ManualDedupInput): Promise<boolean> {
  return (await findManualDuplicate(em, input)) !== null;
}
