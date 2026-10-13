import { roundMoney } from '@utils/money';
/**
 * Pending→posted matching (RAD-346, Phase 4).
 *
 * When a booked transaction arrives, it may be the settled form of an earlier PENDING row on the
 * same account — usually with a different provider id and date, sometimes a slightly different
 * amount. Matching them lets us promote the pending row in place (preserving the user's edits,
 * category and recurring links) instead of leaving a ghost pending + a duplicate booked row.
 *
 * This module is the *decision* only — deliberately pure and conservative, because a false
 * promotion silently rewrites the wrong transaction's money. Rules:
 *   - exact signed amount (rounded to the currency minor unit), same currency;
 *   - same normalized counterparty when both sides have one;
 *   - transaction dates within a ±N day window (pending/posted dates diverge);
 *   - SINGLE candidate only — if two pending rows match, we refuse and flag `ambiguous` rather
 *     than guess (mirrors the categorization service's ambiguity handling).
 */

export interface MatchableTransaction {
  counterparty?: null | string;
  currencyCode: string;
  settlementAmount: number;
  transactionDate: Date;
  transactionKey?: number;
}

export interface MatchOptions {
  /** ± days the pending and posted transactionDate may differ. Default 5. */
  dateWindowDays?: number;
  /** Currency minor-unit decimal places used to round amounts before comparison. Default 2. */
  minorUnitDecimals?: number;
}

export type PendingMatchResult<T> =
  | { candidates: T[]; status: 'ambiguous' }
  | { pending: T; status: 'promote' }
  | { status: 'no_match' };

const DEFAULT_DATE_WINDOW_DAYS = 5;
const DEFAULT_MINOR_UNIT_DECIMALS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function findPromotablePendingMatch<T extends MatchableTransaction>(
  booked: MatchableTransaction,
  pendings: T[],
  options?: MatchOptions,
): PendingMatchResult<T> {
  const dateWindowDays = options?.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS;
  const decimals = options?.minorUnitDecimals ?? DEFAULT_MINOR_UNIT_DECIMALS;

  const candidates = pendings.filter((pending) => isMatch(booked, pending, dateWindowDays, decimals));

  if (candidates.length === 0) return { status: 'no_match' };
  if (candidates.length > 1) return { candidates, status: 'ambiguous' };
  return { pending: candidates[0]!, status: 'promote' };
}

function isMatch(booked: MatchableTransaction, pending: MatchableTransaction, dateWindowDays: number, decimals: number): boolean {
  if (booked.currencyCode !== pending.currencyCode) return false;
  if (roundTo(booked.settlementAmount, decimals) !== roundTo(pending.settlementAmount, decimals)) return false;
  if (!counterpartyMatches(booked.counterparty, pending.counterparty)) return false;

  const daysApart = Math.abs(booked.transactionDate.getTime() - pending.transactionDate.getTime()) / MS_PER_DAY;
  return daysApart <= dateWindowDays;
}

/** Counterparties must agree only when both are present; a missing side is not disqualifying. */
function counterpartyMatches(a: null | string | undefined, b: null | string | undefined): boolean {
  if (!a || !b) return true;
  return a === b;
}

function roundTo(value: number, decimals: number): number {
  // RAD-audit: float compare could miss a legitimate pending/posted match. Exact.
  return roundMoney(value, decimals);
}
