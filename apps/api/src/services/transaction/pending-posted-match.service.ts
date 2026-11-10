import { roundMoney } from '@utils/money';

import { normalizeMerchantForMatch } from './merchant-normalization';

/**
 * Pending→posted matching.
 *
 * When a booked transaction arrives, it may be the settled form of an earlier PENDING row on the
 * same account — usually with a different provider id and date, sometimes a slightly different
 * amount or merchant name. Matching them lets us promote the pending row in place (preserving the
 * user's edits, category and recurring links) instead of leaving a ghost pending + a duplicate
 * booked row.
 *
 * This module is the *decision* only — deliberately pure and conservative, because a false
 * promotion silently rewrites the wrong transaction's money. It runs two passes:
 *
 *   1. exact — same signed amount (rounded to the currency minor unit), same currency, same
 *      normalised counterparty when both sides have one, dates within a ±N day window.
 *   2. loose — only when the exact pass found nothing: same sign and currency, amount within 20%
 *      of the pending authorization (or a small absolute margin), and a normalised counterparty
 *      on both sides that matches. Amount alone is never enough.
 *
 * Both passes require a SINGLE candidate — if two pending rows match, we refuse and flag
 * `ambiguous` rather than guess (mirrors the categorization service's ambiguity handling).
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
  /** Loose pass: maximum absolute difference in major units. Default 1. */
  looseAbsoluteMargin?: number;
  /** Loose pass: maximum relative difference from the pending amount. Default 0.2 (20%). */
  looseAmountPercent?: number;
  /** Currency minor-unit decimal places used to round amounts before comparison. Default 2. */
  minorUnitDecimals?: number;
}

/** Which pass found the candidate. Recorded on the audit entry. */
export type PendingMatchPass = 'exact' | 'loose';

/** The public result shape of the exact-only matcher (kept stable for callers and tests). */
export type PendingMatchResult<T> =
  | { candidates: T[]; status: 'ambiguous' }
  | { pending: T; status: 'promote' }
  | { status: 'no_match' };

/** The detailed result, including the pass and the amount difference for the audit trail. */
export type PendingMatchOutcome<T> =
  | { amountDifference: number; pass: PendingMatchPass; pending: T; status: 'promote' }
  | { candidates: T[]; pass: PendingMatchPass; status: 'ambiguous' }
  | { status: 'no_match' };

const DEFAULT_DATE_WINDOW_DAYS = 5;
const DEFAULT_LOOSE_ABSOLUTE_MARGIN = 1;
const DEFAULT_LOOSE_AMOUNT_PERCENT = 0.2;
const DEFAULT_MINOR_UNIT_DECIMALS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Exact-pass matcher. Kept as the narrow, exact-only entry point; `findPendingMatch` adds the
 * loose pass on top.
 */
export function findPromotablePendingMatch<T extends MatchableTransaction>(
  booked: MatchableTransaction,
  pendings: T[],
  options?: MatchOptions,
): PendingMatchResult<T> {
  const result = findPendingMatchInPass(booked, pendings, 'exact', options);
  if (result.status === 'ambiguous') return { candidates: result.candidates, status: 'ambiguous' };
  if (result.status === 'promote') return { pending: result.pending, status: 'promote' };
  return { status: 'no_match' };
}

/** Exact pass first; the loose pass only when the exact pass found nothing. */
export function findPendingMatch<T extends MatchableTransaction>(
  booked: MatchableTransaction,
  pendings: T[],
  options?: MatchOptions,
): PendingMatchOutcome<T> {
  const exact = findPendingMatchInPass(booked, pendings, 'exact', options);
  if (exact.status !== 'no_match') return exact;
  return findPendingMatchInPass(booked, pendings, 'loose', options);
}

/** Run one pass. The planner calls this directly so it can run every exact match before any loose one. */
export function findPendingMatchInPass<T extends MatchableTransaction>(
  booked: MatchableTransaction,
  pendings: T[],
  pass: PendingMatchPass,
  options?: MatchOptions,
): PendingMatchOutcome<T> {
  const dateWindowDays = options?.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS;
  const decimals = options?.minorUnitDecimals ?? DEFAULT_MINOR_UNIT_DECIMALS;
  const candidates = pendings.filter((pending) =>
    pass === 'exact'
      ? isExactMatch(booked, pending, dateWindowDays, decimals)
      : isLooseMatch(booked, pending, dateWindowDays, decimals, options),
  );

  if (candidates.length === 0) return { status: 'no_match' };
  if (candidates.length > 1) return { candidates, pass, status: 'ambiguous' };

  const [pending] = candidates;
  if (!pending) return { status: 'no_match' };
  return {
    amountDifference: amountDifference(booked.settlementAmount, pending.settlementAmount, decimals),
    pass,
    pending,
    status: 'promote',
  };
}

function amountDifference(bookedAmount: number, pendingAmount: number, decimals: number): number {
  return roundTo(Math.abs(bookedAmount - pendingAmount), decimals);
}

function isExactMatch(booked: MatchableTransaction, pending: MatchableTransaction, dateWindowDays: number, decimals: number): boolean {
  if (booked.currencyCode !== pending.currencyCode) return false;
  if (roundTo(booked.settlementAmount, decimals) !== roundTo(pending.settlementAmount, decimals)) return false;
  if (!counterpartyMatches(booked.counterparty, pending.counterparty)) return false;
  return withinDateWindow(booked, pending, dateWindowDays);
}

function isLooseMatch(booked: MatchableTransaction, pending: MatchableTransaction, dateWindowDays: number, decimals: number, options?: MatchOptions): boolean {
  if (booked.currencyCode !== pending.currencyCode) return false;
  // Never promote on amount alone: both sides must name the same merchant after normalisation.
  if (!booked.counterparty || !pending.counterparty) return false;
  if (!counterpartyMatches(booked.counterparty, pending.counterparty)) return false;

  const bookedAmount = roundTo(booked.settlementAmount, decimals);
  const pendingAmount = roundTo(pending.settlementAmount, decimals);
  if (Math.sign(bookedAmount) !== Math.sign(pendingAmount)) return false;
  if (!withinLooseAmount(bookedAmount, pendingAmount, options)) return false;
  return withinDateWindow(booked, pending, dateWindowDays);
}

/**
 * Counterparties must agree only when both are present; a missing side is not disqualifying for
 * the exact pass. The loose pass checks presence itself.
 */
function counterpartyMatches(a: null | string | undefined, b: null | string | undefined): boolean {
  if (!a || !b) return true;
  return normalizeMerchantForMatch(a) === normalizeMerchantForMatch(b);
}

function roundTo(value: number, decimals: number): number {
  // RAD-audit: float compare could miss a legitimate pending/posted match. Exact.
  return roundMoney(value, decimals);
}

function withinDateWindow(booked: MatchableTransaction, pending: MatchableTransaction, dateWindowDays: number): boolean {
  const daysApart = Math.abs(booked.transactionDate.getTime() - pending.transactionDate.getTime()) / MS_PER_DAY;
  return daysApart <= dateWindowDays;
}

function withinLooseAmount(bookedAmount: number, pendingAmount: number, options?: MatchOptions): boolean {
  const percent = options?.looseAmountPercent ?? DEFAULT_LOOSE_AMOUNT_PERCENT;
  const margin = options?.looseAbsoluteMargin ?? DEFAULT_LOOSE_ABSOLUTE_MARGIN;
  const difference = Math.abs(bookedAmount - pendingAmount);
  // The pending amount is the authorization the user saw; a settled amount within 20% of it (or a
  // small absolute margin) is a plausible tip/FX adjustment.
  return difference <= Math.abs(pendingAmount) * percent || difference <= margin;
}
