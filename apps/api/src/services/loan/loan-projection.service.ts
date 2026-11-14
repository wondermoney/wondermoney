import { calculateNextPaymentDate } from '@service/loan/loan-calculation.service';
import { roundDisplay } from '@utils/money';

import { addMonthsClamped, type AmortizationScheduleRow, buildAmortizationSchedule, resizedLevelPayment } from './amortization-schedule';
import { LoanAmortizationMethod } from './loan-types';
import { projectPayoff } from './payoff-projection';
import { type LoanRatePeriodInput, resolveLoanRate } from './rate-resolver';

/**
 * A loan's payoff projection: the contract instalment, plus an optional extra payment,
 * walked forward from the current outstanding principal.
 *
 * The single-debt engine is `projectPayoff` (shared with debt-paydown goals). This module
 * adds the loan-specific pieces: the instalment due on each date, the calendar dates behind
 * each month, the contract maturity comparison, and the baseline-vs-extra series the loan
 * page charts.
 *
 * The instalment due on a date:
 * - with no `contractPayment`, the contract schedule's own instalment for that date, so a
 *   variable-rate loan follows its resized payments (and a constant-principal loan its falling
 *   ones) exactly as the schedule does. Past maturity, the last instalment repeats.
 * - with a `contractPayment` (what the borrower pays now), that amount, held fixed. A French
 *   loan resizes it when the rate in force on a due date changes, from the projected balance
 *   over the months left to maturity, as the schedule does. With no rate change ahead it never
 *   moves, so a payment below the interest reports `PAYMENT_BELOW_INTEREST`.
 */

export interface LoanProjection {
  /** Months the projected payoff is before (positive) or after (negative) contract maturity. */
  aheadOrBehindMonths: null | number;
  /** Interest left on the contract schedule from the next instalment to maturity. */
  contractInterest: number;
  /** Instalments left on the contract schedule from the next one to maturity. */
  contractMonths: number;
  interestSaved: number;
  months: null | number;
  monthsSaved: number;
  payoffDate: null | string;
  paysOff: boolean;
  reason: 'PAYMENT_BELOW_INTEREST' | null;
  series: LoanProjectionPoint[];
  totalInterest: number;
}

export interface LoanProjectionInput {
  amortizationMethod: LoanAmortizationMethod;
  annualInterestRateBps: number;
  /**
   * What the borrower pays each month now, normally the loan's stored regular payment. Without
   * it the projection pays the contract schedule's dated instalments (see the module comment).
   */
  contractPayment?: number;
  extraPayment: number;
  /** The first instalment's due date, as the contract schedule uses. */
  firstPaymentDate: Date;
  frequency: ProjectionFrequency;
  now: Date;
  /** The amount the contract amortizes, normally `originalPrincipal`. */
  originalPrincipal: number;
  outstandingPrincipal: number;
  /** Dated rate changes, as the amortization schedule reads them. */
  ratePeriods?: readonly LoanRatePeriodInput[];
  /** When the extra starts; already-past dates apply from the first projected month. */
  startDate: Date;
  termMonths: number;
}

export interface LoanProjectionPoint {
  baselineBalance: number;
  /** ISO calendar day of the instalment this point follows. */
  date: string;
  month: number;
  withExtraBalance: number;
}

export type ProjectionFrequency = 'monthly' | 'one-off';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Whole months from `from` to `to`; positive when `to` is later. */
function monthsBetween(from: Date, to: Date): number {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

/** Projects the loan's payoff from the current outstanding principal. */
export function buildLoanProjection(input: LoanProjectionInput): LoanProjection {
  const schedule = buildAmortizationSchedule({
    annualInterestRateBps: input.annualInterestRateBps,
    firstPaymentDate: input.firstPaymentDate,
    method: input.amortizationMethod,
    principal: input.originalPrincipal,
    ratePeriods: input.ratePeriods,
    termMonths: input.termMonths,
  });

  const today = startOfUtcDay(input.now);
  const dayOfMonth = input.firstPaymentDate.getUTCDate();
  const nextRowIndex = schedule.rows.findIndex((row) => row.date.getTime() >= today.getTime());
  const fromIndex = nextRowIndex === -1 ? schedule.rows.length - 1 : nextRowIndex;
  const contractMaturityDate = schedule.rows.at(-1)?.date ?? input.firstPaymentDate;
  const contractMonths = Math.max(schedule.rows.length - fromIndex, 0);
  const contractInterest = roundDisplay(schedule.rows.slice(fromIndex).reduce((sum, row) => sum + row.interest, 0));

  // The projection starts at the next instalment. A loan already past its contract
  // maturity still projects from today's balance, on the next monthly payment date.
  const nextRow = schedule.rows[fromIndex];
  const firstProjectedPaymentDate =
    nextRow && nextRow.date.getTime() >= today.getTime()
      ? nextRow.date
      : calculateNextPaymentDate(today, dayOfMonth);
  const paymentDate = (month: number) => addMonthsClamped(firstProjectedPaymentDate, month - 1, dayOfMonth);
  const plan = { input, rows: schedule.rows, today };
  const calendar = (firstPaymentDate: Date, extra: number) => ({
    dayOfMonth,
    firstPaymentDate,
    paymentOn: instalments(plan, extra),
    ratePeriods: input.ratePeriods,
  });
  // `monthlyPayment` only names the opening payment here; the calendar sets every month's.
  const openingPayment = input.contractPayment ?? nextRow?.payment ?? 0;

  const baseline = projectPayoff({
    annualInterestRateBps: input.annualInterestRateBps,
    balance: input.outstandingPrincipal,
    calendar: calendar(firstProjectedPaymentDate, 0),
    monthlyPayment: openingPayment,
  });

  const startDate = startOfUtcDay(input.startDate);
  const baselineMonths = baseline.months ?? 0;
  const paymentsBeforeStart = baseline.paysOff ? countPaymentsBefore(baselineMonths, paymentDate, startDate) : 0;
  const preMonths = Math.min(paymentsBeforeStart, baselineMonths);
  const balanceAtStart = preMonths === 0 ? input.outstandingPrincipal : baseline.schedule[preMonths - 1]?.endingBalance ?? 0;

  const monthlyExtra = input.frequency === 'monthly' ? input.extraPayment : 0;
  const tailBalance = input.frequency === 'one-off' ? Math.max(balanceAtStart - input.extraPayment, 0) : balanceAtStart;
  const tail = projectPayoff({
    annualInterestRateBps: input.annualInterestRateBps,
    balance: tailBalance,
    calendar: calendar(paymentDate(preMonths + 1), monthlyExtra),
    monthlyPayment: openingPayment + monthlyExtra,
  });

  if (!tail.paysOff) {
    return {
      aheadOrBehindMonths: null,
      contractInterest,
      contractMonths,
      interestSaved: 0,
      months: null,
      monthsSaved: 0,
      payoffDate: null,
      paysOff: false,
      reason: 'PAYMENT_BELOW_INTEREST',
      series: [],
      totalInterest: 0,
    };
  }

  const preInterest = roundDisplay(baseline.schedule.slice(0, preMonths).reduce((sum, entry) => sum + entry.interest, 0));
  const withExtraMonths = preMonths + (tail.months ?? 0);
  const withExtraInterest = roundDisplay(preInterest + tail.totalInterest);
  const totalMonths = Math.max(baselineMonths, withExtraMonths);

  const series: LoanProjectionPoint[] = [];
  for (let month = 0; month <= totalMonths; month += 1) {
    // Without the extra the contract payment never clears the loan; the line stays at the
    // starting balance rather than inventing a payoff.
    const baselineBalance =
      month === 0
        ? input.outstandingPrincipal
        : baseline.paysOff
          ? baseline.schedule[month - 1]?.endingBalance ?? 0
          : input.outstandingPrincipal;
    const withExtraBalance =
      month <= preMonths ? baselineBalance : tail.schedule[month - preMonths - 1]?.endingBalance ?? 0;
    series.push({
      baselineBalance,
      date: (month === 0 ? today : paymentDate(month)).toISOString(),
      month,
      withExtraBalance,
    });
  }

  const payoffDate = withExtraMonths === 0 ? today : paymentDate(withExtraMonths);

  return {
    aheadOrBehindMonths: monthsBetween(payoffDate, contractMaturityDate),
    contractInterest,
    contractMonths,
    interestSaved: baseline.paysOff ? roundDisplay(baseline.totalInterest - withExtraInterest) : 0,
    months: withExtraMonths,
    monthsSaved: baseline.paysOff ? baselineMonths - withExtraMonths : 0,
    payoffDate: payoffDate.toISOString().slice(0, 10),
    paysOff: true,
    reason: null,
    series,
    totalInterest: withExtraInterest,
  };
}

function countPaymentsBefore(months: number, paymentDate: (month: number) => Date, startDate: Date): number {
  let count = 0;
  for (let month = 1; month <= months; month += 1) {
    if (paymentDate(month).getTime() < startDate.getTime()) count += 1;
    else break;
  }
  return count;
}

/**
 * The instalment due on each projected date, plus `extra`, as the module comment describes.
 * Stateful (a resized payment carries forward), so each projection walk takes a fresh one.
 */
function instalments(
  plan: { input: LoanProjectionInput; rows: readonly AmortizationScheduleRow[]; today: Date },
  extra: number,
): (date: Date, startingBalance: number) => number {
  const { input, rows, today } = plan;
  const periods = input.ratePeriods ?? [];
  const rateOn = (date: Date) => resolveLoanRate(periods, date, input.annualInterestRateBps);

  if (input.contractPayment == null) {
    const byDate = new Map(rows.map((row) => [row.date.getTime(), row.payment]));
    const lastPayment = rows.at(-1)?.payment ?? 0;
    return (date) => (byDate.get(date.getTime()) ?? lastPayment) + extra;
  }

  let payment = input.contractPayment;
  let resized = false;
  let previousRate = rateOn(today);
  const maturity = rows.at(-1)?.date.getTime();
  const resizes = input.amortizationMethod === LoanAmortizationMethod.FRENCH;
  return (date, startingBalance) => {
    const rate = rateOn(date);
    if (resizes && rate !== previousRate && startingBalance > 0) {
      const monthsLeft = rows.filter((row) => row.date.getTime() >= date.getTime()).length;
      const openingRate = rateOn(addMonthsClamped(date, -1, input.firstPaymentDate.getUTCDate()));
      if (monthsLeft > 0) {
        payment = resizedLevelPayment(startingBalance, openingRate, rate, monthsLeft);
        resized = true;
      }
    }
    previousRate = rate;
    // A resized instalment is sized to clear the loan at maturity; like the schedule's last
    // row, the last one absorbs the rounding of the level amount.
    if (resized && date.getTime() === maturity) return Number.POSITIVE_INFINITY;
    return payment + extra;
  };
}
