/**
 * One-off repair: Enable Banking rows stored as BOOKED although the provider never booked them.
 *
 * An older sync sent a row to pending only when its status was `PEND`, which Enable Banking
 * does not send, so pending (`PDNG`), held, scheduled, other, rejected and cancelled rows were all
 * stored as BOOKED. The provider status was never stored, so the database alone cannot tell which
 * rows they were. The provider can: this planner compares the stored rows of an account with a fresh
 * re-fetch of the same account.
 *
 *   - A stored row the provider still reports, under the id the sync stored it under, takes the
 *     status the sync now gives that row: pending for `PDNG`/`HOLD`/`SCHD`/`OTHR`, EXPIRED for
 *     `RJCT`/`CNCL`. That is exactly what the next sync would do, for rows outside its 5-day window.
 *   - A stored BOOKED row the provider no longer reports, dated inside the range the re-fetch
 *     covered, is not something the bank booked. The common cause is a pending row whose booked
 *     version arrived under a different id and was stored as a second row: a duplicate. It is
 *     expired only when exactly one still-reported booked row, ingested after it, has the same
 *     currency and amount within five days (the pending↔booked matching rules). Anything less
 *     certain, or a row the user edited, is only reported for review.
 *
 * Delete together with `database/scripts/repair-enable-banking-statuses.ts` once the repair has run
 * on every environment.
 */
import type { EnableBankingStatusClass } from '@service/enable-banking/enable-banking-sync-adapter';
import { roundMoney } from '@utils/money';

/** A row as the re-fetch reports it, keyed by the id the sync stores (`enableBankingTransactionIdFor`). */
export interface ReportedRow {
  classification: EnableBankingStatusClass;
  id: string;
  providerStatus?: string;
}

export interface StatusChange {
  reason: string;
  to: 'EXPIRED' | 'PENDING';
  transactionKey: number;
}

export interface StatusRepairPlan {
  changes: StatusChange[];
  review: { reason: 'not_reported_ambiguous_counterpart' | 'not_reported_no_counterpart' | 'not_reported_user_edited'; transactionKey: number }[];
}

export interface StoredStatusRow {
  createdAt: Date;
  currencyCode: string;
  enableBankingTransactionId: string;
  /** An edited amount or notes: never changed automatically. */
  hasUserEdits: boolean;
  settlementAmount: number;
  status: string;
  transactionDate: Date | null;
  transactionKey: number;
}

const COUNTERPART_WINDOW_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `coverageFrom` is the first day the re-fetch is known to cover (the later of the requested start
 * and the oldest reported row). Rows dated on or before it are not judged: a bank may cut the window.
 */
export function planStatusRepair(input: { coverageFrom: Date; reported: ReportedRow[]; stored: StoredStatusRow[] }): StatusRepairPlan {
  const reportedById = new Map(input.reported.map((row) => [row.id, row]));
  const plan: StatusRepairPlan = { changes: [], review: [] };
  const ghosts: StoredStatusRow[] = [];

  for (const row of input.stored) {
    const report = reportedById.get(row.enableBankingTransactionId);
    if (report) {
      const reason = `provider_status:${report.providerStatus ?? 'unknown'}`;
      if (report.classification === 'voided' && row.status !== 'EXPIRED') plan.changes.push({ reason, to: 'EXPIRED', transactionKey: row.transactionKey });
      else if (report.classification === 'pending' && row.status === 'BOOKED') plan.changes.push({ reason, to: 'PENDING', transactionKey: row.transactionKey });
      continue;
    }
    if (row.status === 'BOOKED' && row.transactionDate && row.transactionDate.getTime() > input.coverageFrom.getTime()) ghosts.push(row);
  }

  const counterparts = input.stored.filter((row) => row.status === 'BOOKED' && reportedById.get(row.enableBankingTransactionId)?.classification === 'booked');
  const claimed = new Map<number, number[]>();
  const candidatesByGhost = new Map<number, StoredStatusRow[]>();
  for (const ghost of ghosts) {
    const candidates = counterparts.filter((booked) => isCounterpart(ghost, booked));
    candidatesByGhost.set(ghost.transactionKey, candidates);
    for (const candidate of candidates) claimed.set(candidate.transactionKey, [...(claimed.get(candidate.transactionKey) ?? []), ghost.transactionKey]);
  }

  for (const ghost of ghosts) {
    const candidates = candidatesByGhost.get(ghost.transactionKey) ?? [];
    if (ghost.hasUserEdits) plan.review.push({ reason: 'not_reported_user_edited', transactionKey: ghost.transactionKey });
    else if (candidates.length === 0) plan.review.push({ reason: 'not_reported_no_counterpart', transactionKey: ghost.transactionKey });
    else {
      const [only] = candidates;
      // One booked row accounts for one ghost: a counterpart two ghosts compete for proves neither.
      if (!only || candidates.length > 1 || (claimed.get(only.transactionKey)?.length ?? 0) > 1) plan.review.push({ reason: 'not_reported_ambiguous_counterpart', transactionKey: ghost.transactionKey });
      else plan.changes.push({ reason: `duplicate_of:${only.transactionKey}`, to: 'EXPIRED', transactionKey: ghost.transactionKey });
    }
  }

  return plan;
}

function isCounterpart(ghost: StoredStatusRow, booked: StoredStatusRow): boolean {
  if (booked.transactionKey === ghost.transactionKey || !booked.transactionDate || !ghost.transactionDate) return false;
  if (booked.currencyCode !== ghost.currencyCode) return false;
  if (roundMoney(booked.settlementAmount, 2) !== roundMoney(ghost.settlementAmount, 2)) return false;
  // The booked version of a pending is ingested after it.
  if (booked.createdAt.getTime() <= ghost.createdAt.getTime()) return false;
  return Math.abs(booked.transactionDate.getTime() - ghost.transactionDate.getTime()) / MS_PER_DAY <= COUNTERPART_WINDOW_DAYS;
}
