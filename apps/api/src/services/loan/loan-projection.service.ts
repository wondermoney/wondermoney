import { calculateNextPaymentDate } from '@service/loan/loan-calculation.service';
import { roundDisplay } from '@utils/money';

import { addMonthsClamped, buildAmortizationSchedule } from './amortization-schedule';
import type { LoanAmortizationMethod } from './loan-types';
import { projectPayoff } from './payoff-projection';

/**
 * A loan's payoff projection: the contract instalment, plus an optional extra payment,
 * walked forward from the current outstanding principal.
 *
 * The single-debt engine is `projectPayoff` (shared with debt-paydown goals). This module
 * adds the loan-specific pieces: the contract instalment from the amortization schedule,
 * the calendar dates behind each month, the contract maturity comparison, and the
 * baseline-vs-extra series the loan page charts.
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
   * The amount the borrower pays each month. Defaults to the contract instalment from the
   * amortization schedule; callers pass the loan's stored regular payment when it differs.
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
    termMonths: input.termMonths,
  });

  const today = startOfUtcDay(input.now);
  const nextRowIndex = schedule.rows.findIndex((row) => row.date.getTime() >= today.getTime());
  const fromIndex = nextRowIndex === -1 ? schedule.rows.length - 1 : nextRowIndex;
  const contractPayment = input.contractPayment ?? schedule.rows[fromIndex]?.payment ?? 0;
  const contractMaturityDate = schedule.rows.at(-1)?.date ?? input.firstPaymentDate;
  const contractMonths = Math.max(schedule.rows.length - fromIndex, 0);
  const contractInterest = roundDisplay(schedule.rows.slice(fromIndex).reduce((sum, row) => sum + row.interest, 0));

  // The projection starts at the next instalment. A loan already past its contract
  // maturity still projects from today's balance, on the next monthly payment date.
  const nextRow = schedule.rows[fromIndex];
  const firstProjectedPaymentDate =
    nextRow && nextRow.date.getTime() >= today.getTime()
      ? nextRow.date
      : calculateNextPaymentDate(today, input.firstPaymentDate.getUTCDate());

  const baseline = projectPayoff({
    annualInterestRateBps: input.annualInterestRateBps,
    balance: input.outstandingPrincipal,
    monthlyPayment: contractPayment,
  });

  const startDate = startOfUtcDay(input.startDate);
  const baselineMonths = baseline.months ?? 0;
  const paymentsBeforeStart = baseline.paysOff ? countPaymentsBefore(baselineMonths, firstProjectedPaymentDate, startDate) : 0;
  const preMonths = Math.min(paymentsBeforeStart, baselineMonths);
  const balanceAtStart = preMonths === 0 ? input.outstandingPrincipal : baseline.schedule[preMonths - 1]?.endingBalance ?? 0;

  const tailPayment = input.frequency === 'monthly' ? contractPayment + input.extraPayment : contractPayment;
  const tailBalance = input.frequency === 'one-off' ? Math.max(balanceAtStart - input.extraPayment, 0) : balanceAtStart;
  const tail = projectPayoff({
    annualInterestRateBps: input.annualInterestRateBps,
    balance: tailBalance,
    monthlyPayment: tailPayment,
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
      date: (month === 0 ? today : paymentDate(firstProjectedPaymentDate, month)).toISOString(),
      month,
      withExtraBalance,
    });
  }

  const payoffDate = withExtraMonths === 0 ? today : paymentDate(firstProjectedPaymentDate, withExtraMonths);

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

function countPaymentsBefore(months: number, firstPaymentDate: Date, startDate: Date): number {
  let count = 0;
  for (let month = 1; month <= months; month += 1) {
    if (paymentDate(firstPaymentDate, month).getTime() < startDate.getTime()) count += 1;
    else break;
  }
  return count;
}

/** The date of projection month `month` (1-based), clamped to a short month's last day. */
function paymentDate(firstPaymentDate: Date, month: number): Date {
  return addMonthsClamped(firstPaymentDate, month - 1, firstPaymentDate.getUTCDate());
}
