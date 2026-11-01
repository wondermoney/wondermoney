import { addQuarters, differenceInCalendarQuarters, isAfter, isBefore, isSameMonth } from 'date-fns';

import logger from '@utils/logger';

/**
 * Certificados de Aforro accrual engine.
 *
 * Pure, dependency-free money math: given a lot's principal, subscription date, the
 * series' published monthly base rates and its loyalty-premium brackets, compute the
 * accrued value at a point in time. No DB access, no I/O — the DB-aware wrapper
 * (`certificado-aforro-holdings.service.ts`) loads the data and calls in here.
 *
 * The product accrues quarterly: every 3 months from the subscription date, interest is
 * credited at (the series-capped/floored base rate for that quarter + the loyalty premium
 * for the holding year), taxed at source unless the holder is exempt, and capitalised into
 * the balance (so subsequent quarters compound on it).
 *
 * Note the ordering: the cap/floor constrain the BASE rate only, and the premium is added
 * afterwards — so the total rate legally exceeds the series cap for older lots.
 */

export interface CertificateSeriesConstants {
  capBps: number;
  floorBps: number;
  termYears: number;
  /**
   * `'accrual'` series compute their value from the quarterly rate/premium formula below.
   * `'static'` series (Séries A/B) are perpetual and have no published formula — their
   * value is whatever the user last declared via a BUY/SELL transaction, so the holdings service
   * skips this whole engine for them and sums `remaining_batch` directly.
   */
  valuationMode: 'accrual' | 'static';
}

/**
 * Cap/floor/term are fixed by the law that created each series (cited Portaria per
 * series) — confirm each figure against the relevant Portaria before launch (design doc
 * risk: "Formula accuracy is the whole point of this feature").
 */
export const CERTIFICADO_AFORRO_SERIES_CONSTANTS: Record<string, CertificateSeriesConstants> = {
  // Séries A/B: perpetual, closed to new subscriptions, no published rate formula —
  // capBps/floorBps/termYears are meaningless here and never read (the holdings service branches
  // on valuationMode before this engine is ever invoked for them).
  'CA-SERIE-A': { capBps: 0, floorBps: 0, termYears: 0, valuationMode: 'static' },
  'CA-SERIE-B': { capBps: 0, floorBps: 0, termYears: 0, valuationMode: 'static' },
  'CA-SERIE-C': { capBps: 350, floorBps: 0, termYears: 10, valuationMode: 'accrual' }, // -- VERIFY cap/floor against Portaria 268-D/2012
  'CA-SERIE-D': { capBps: 350, floorBps: 0, termYears: 10, valuationMode: 'accrual' }, // -- VERIFY against series D's founding Portaria
  'CA-SERIE-E': { capBps: 350, floorBps: 0, termYears: 10, valuationMode: 'accrual' }, // -- VERIFY against series E's founding Portaria
  'CA-SERIE-F': { capBps: 250, floorBps: 0, termYears: 15, valuationMode: 'accrual' }, // cap/floor per Portaria 149-A/2023 (design doc, high confidence)
};

/** 28% flat PT capital-income withholding -- VERIFY against current IRS code before launch. */
export const IRS_WITHHOLDING_RATE_BPS = 2800;

/** One `certificado_aforro_premium_schedule` row, as loaded from the DB. */
export interface PremiumScheduleRow {
  /** `null` for series whose schedule is cohort-independent (e.g. Séries E/F). */
  cohortStartDate?: Date | null;
  premiumBps: number;
  yearFrom: number;
  yearTo: null | number;
}

/** A premium bracket that already belongs to the cohort a given lot was subscribed into. */
export interface PremiumBracket {
  premiumBps: number;
  yearFrom: number;
  yearTo: null | number;
}

/**
 * Picks the premium-bracket set that applies to a lot subscribed on `subscriptionDate`.
 *
 * A series can publish several cohort variants (Série C has four), each keyed by the date
 * from which it applied. The applicable cohort is the latest one that had already started
 * when the lot was subscribed; rows with a `null` cohort are the series' standard schedule
 * and act as the cohort-of-last-resort (they apply to any subscription date).
 *
 * Throws rather than silently returning `[]` when nothing applies: an empty bracket list is
 * indistinguishable from "no premium", which would under-value the holding forever.
 */
export function resolvePremiumBrackets(schedules: PremiumScheduleRow[], subscriptionDate: Date): PremiumBracket[] {
  const cohortTimes = [...new Set(schedules.map((schedule) => schedule.cohortStartDate?.getTime() ?? null))];
  const applicableCohortTime = cohortTimes
    .filter((time) => time === null || time <= subscriptionDate.getTime())
    .sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity))[0];

  if (applicableCohortTime === undefined) {
    throw new Error(`No premium schedule cohort applies to subscription date ${subscriptionDate.toISOString()}`);
  }

  return schedules
    .filter((schedule) => (schedule.cohortStartDate?.getTime() ?? null) === applicableCohortTime)
    .map(({ premiumBps, yearFrom, yearTo }) => ({ premiumBps, yearFrom, yearTo }))
    .sort((a, b) => a.yearFrom - b.yearFrom);
}

/** One `certificado_aforro_rate_period` row: the base rate IGCP published for a given month. */
export interface RatePeriod {
  baseRateBps: number;
  effectiveMonth: Date;
}

/** Minimal structural slice of the Pino logger, so callers (and tests) can inject their own. */
export interface ComputeCertificateLotValueInput {
  /** Valuation date. Interest never accrues past `maturityDate`, however late this is. */
  asOfDate: Date;
  /**
   * Merged into the data object of any warning this call emits. The engine is pure and knows
   * nothing about series or portfolios, so without this a stale-rate warning reads "some month is
   * missing" with no way to tell which of the four series went stale. Callers pass e.g.
   * `{ symbol }`.
   */
  logContext?: Record<string, unknown>;
  logger?: WarnLogger;
  maturityDate: Date;
  /** Already resolved for this lot's cohort — see `resolvePremiumBrackets`. */
  premiumBrackets: PremiumBracket[];
  /** The lot's subscribed capital, in the series' currency (EUR). */
  principal: number;
  /** Series legal cap on the BASE rate (not the total). Omit to leave the base rate uncapped. */
  rateCapBps?: number;
  /** Series legal floor on the BASE rate (not the total). Omit to leave the base rate unfloored. */
  rateFloorBps?: number;
  ratePeriods: RatePeriod[];
  subscriptionDate: Date;
  taxExempt: boolean;
}

export interface ComputeCertificateLotValueResult {
  accruedValue: number;
  /**
   * The quarter the lot is accruing in *right now* — i.e. the one after the last completed
   * quarter, which has not capitalised yet and therefore appears nowhere in `quarters`.
   *
   * This, not `quarters.at(-1)`, is what a "current rate / premium tier / years held" display
   * must read: a lot subscribed last month has zero completed quarters but is very much accruing
   * at a real rate, and a lot that just crossed a year boundary moves onto the next premium tier
   * immediately, not one quarter later.
   *
   * `null` in exactly two cases: the lot has matured (nothing accrues any more), or no published
   * base rate exists on or before the current quarter's start month (unprovisioned series), in
   * which case there is genuinely no rate to report and the caller must not invent one.
   */
  currentQuarter: CurrentQuarterState | null;
  grossInterest: number;
  netInterest: number;
  quarters: QuarterResult[];
}

/** The not-yet-capitalised quarter a lot is currently accruing in. See `currentQuarter`. */
export interface CurrentQuarterState {
  /** Loyalty premium component of `rateBps`, for the holding year this quarter falls in. */
  premiumBps: number;
  /** When this quarter capitalises — i.e. the lot's next capitalisation date. */
  quarterEnd: Date;
  quarterStart: Date;
  /** Clamped base rate + premium, same composition as `QuarterResult.rateBps`. */
  rateBps: number;
  /** 1-based holding year this quarter falls in (quarters 0-3 are year 1). */
  yearsHeld: number;
}

export interface QuarterResult {
  /** Capitalised balance at the end of this quarter (i.e. after `netInterest` is added). */
  balance: number;
  grossInterest: number;
  netInterest: number;
  quarterEnd: Date;
  /**
   * Annualised rate actually applied: the cap/floor-clamped base rate plus the holding-year
   * premium. Can legally exceed the series cap — the cap constrains the base rate alone.
   */
  rateBps: number;
}

interface WarnLogger {
  warn: (data: Record<string, unknown>, msg: string) => void;
}

/**
 * `yearsHeld` is 1-based: the first four quarters are holding year 1. Brackets are published
 * against those holding years ("+0.25% from year 2 to 5"), so year 1 typically matches nothing
 * — which correctly means "no premium yet", not "misconfigured".
 */
function findPremiumBps(brackets: PremiumBracket[], yearsHeld: number): number {
  const bracket = brackets.find((candidate) => yearsHeld >= candidate.yearFrom && (candidate.yearTo == null || yearsHeld <= candidate.yearTo));
  return bracket?.premiumBps ?? 0;
}

/**
 * The base rate for a quarterly period is the one IGCP published for the month that period
 * starts in. If that month is missing (the rate-sync worker skipped a run, or a historic month
 * was never backfilled) we carry the most recent known rate forward and warn — a stale rate is a
 * far smaller error than refusing to value the holding at all. With no prior rate there is
 * nothing to carry forward, so we fail loudly instead of silently valuing at 0%.
 */
function findRateBpsForMonth(sortedRatePeriods: RatePeriod[], month: Date, warn: (msg: string) => void): number {
  const exact = sortedRatePeriods.find((period) => isSameMonth(period.effectiveMonth, month));
  if (exact) return exact.baseRateBps;

  const fallback = sortedRatePeriods.filter((period) => !isAfter(period.effectiveMonth, month)).at(-1);
  if (!fallback) throw new Error(`No rate period available on or before ${month.toISOString()} — cannot value this lot`);

  warn(
    `Missing rate period for ${month.toISOString().slice(0, 7)}, falling back to most recent known rate (${fallback.effectiveMonth.toISOString().slice(0, 7)})`,
  );
  return fallback.baseRateBps;
}

/**
 * Resolves the quarter the lot is accruing in *now* — the one starting where the last completed
 * quarter ended. Deliberately separate from the accrual loop: this quarter has not capitalised, so
 * it contributes nothing to the balance; it exists purely so the UI can report the rate, premium
 * tier and years-held that are actually in force today rather than last quarter's.
 *
 * Returns `null` rather than a guess when there is nothing truthful to report — see
 * `ComputeCertificateLotValueResult.currentQuarter`. In particular the missing-rate case is
 * swallowed here (unlike inside the accrual loop, where it is a hard failure): a display field
 * being absent must never stop an otherwise-valuable lot from being valued.
 */
function resolveCurrentQuarter(
  input: ComputeCertificateLotValueInput,
  completedQuarters: number,
  sortedRatePeriods: RatePeriod[],
  warn: (msg: string) => void,
): CurrentQuarterState | null {
  const { maturityDate, premiumBrackets, rateCapBps, rateFloorBps, subscriptionDate } = input;

  const quarterStart = addQuarters(subscriptionDate, completedQuarters);
  const quarterEnd = addQuarters(subscriptionDate, completedQuarters + 1);
  // A matured lot has stopped accruing entirely — there is no "current" rate to report.
  if (!isBefore(quarterStart, maturityDate)) return null;

  let baseRateBps: number;
  try {
    baseRateBps = findRateBpsForMonth(sortedRatePeriods, quarterStart, warn);
  } catch {
    return null;
  }
  if (rateCapBps != null) baseRateBps = Math.min(baseRateBps, rateCapBps);
  if (rateFloorBps != null) baseRateBps = Math.max(baseRateBps, rateFloorBps);

  const yearsHeld = Math.floor(completedQuarters / 4) + 1;
  const premiumBps = findPremiumBps(premiumBrackets, yearsHeld);

  return { premiumBps, quarterEnd, quarterStart, rateBps: baseRateBps + premiumBps, yearsHeld };
}

/**
 * Accrues a single subscription lot quarter by quarter from `subscriptionDate` up to
 * `min(asOfDate, maturityDate)`. Only *whole* elapsed quarters are credited — a lot valued on
 * its subscription date, or part-way through a quarter, has accrued nothing yet.
 *
 * Pure: no DB, no clock, no rounding. Callers round to currency precision at the edge.
 */
export function computeCertificateLotValue(input: ComputeCertificateLotValueInput): ComputeCertificateLotValueResult {
  const { asOfDate, maturityDate, premiumBrackets, principal, rateCapBps, rateFloorBps, ratePeriods, subscriptionDate, taxExempt } = input;
  const sortedRatePeriods = [...ratePeriods].sort((a, b) => a.effectiveMonth.getTime() - b.effectiveMonth.getTime());
  const warn = (msg: string) => { (input.logger ?? logger).warn({ ...input.logContext, subscriptionDate }, msg); };

  const effectiveEndDate = isBefore(maturityDate, asOfDate) ? maturityDate : asOfDate;
  // Calendar-quarter distance is always >= the number of whole elapsed quarters (adding N quarters
  // shifts the calendar-quarter index by exactly N), so it is a safe upper bound for the loop; the
  // `isAfter` guard below is what actually decides whether a quarter has closed.
  const maxQuarters = Math.max(0, differenceInCalendarQuarters(effectiveEndDate, subscriptionDate));

  let balance = principal;
  let grossInterestTotal = 0;
  let netInterestTotal = 0;
  const quarters: QuarterResult[] = [];

  for (let quarterIndex = 0; quarterIndex < maxQuarters; quarterIndex++) {
    const quarterStart = addQuarters(subscriptionDate, quarterIndex);
    const quarterEnd = addQuarters(subscriptionDate, quarterIndex + 1);
    if (isAfter(quarterEnd, effectiveEndDate)) break;

    const yearsHeld = Math.floor(quarterIndex / 4) + 1;

    // The cap/floor constrain the BASE-rate formula only — never the total. IGCP's fichas técnicas
    // are explicit: "From application of said formula may not result a base rate exceeding 3.5%, nor
    // below 0%" (Série E), "The base rate may not be higher than 2.50% or lower than 0%" (Série F).
    // The loyalty premium is added on top of the already-constrained base, so the total rate legally
    // exceeds the cap for older lots (Série F: 2.50% capped base + 1.75% year-14/15 premium = 4.25%).
    // Clamping the sum instead would silently swallow the premium and under-value every mature lot.
    let baseRateBps = findRateBpsForMonth(sortedRatePeriods, quarterStart, warn);
    if (rateCapBps != null) baseRateBps = Math.min(baseRateBps, rateCapBps);
    if (rateFloorBps != null) baseRateBps = Math.max(baseRateBps, rateFloorBps);

    const rateBps = baseRateBps + findPremiumBps(premiumBrackets, yearsHeld);

    const grossInterest = (balance * rateBps) / 10_000 / 4;
    const netInterest = taxExempt ? grossInterest : grossInterest * (1 - IRS_WITHHOLDING_RATE_BPS / 10_000);
    balance += netInterest;
    grossInterestTotal += grossInterest;
    netInterestTotal += netInterest;

    quarters.push({ balance, grossInterest, netInterest, quarterEnd, rateBps });
  }

  return {
    accruedValue: balance,
    currentQuarter: resolveCurrentQuarter(input, quarters.length, sortedRatePeriods, warn),
    grossInterest: grossInterestTotal,
    netInterest: netInterestTotal,
    quarters,
  };
}
