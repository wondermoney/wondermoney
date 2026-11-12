import type { Big } from 'big.js';

import { big, roundDisplay } from '@utils/money';

import { LoanAmortizationMethod } from './loan-types';
import { type LoanRatePeriodInput, resolveLoanRate } from './rate-resolver';

/**
 * Contract amortization schedules for a loan.
 *
 * Two methods, both monthly and both in the loan's currency:
 *
 * - **French** (Price): one level payment for the whole term. The payment comes
 *   from the annuity formula, `P·i / (1 − (1+i)^−n)`, and each month's interest
 *   is charged first; whatever is left of the payment reduces the principal.
 * - **Constant principal** (SAC): the same principal every month, so the
 *   payment starts high and falls as the balance (and its interest) falls.
 *
 * Money arithmetic is exact decimal (`@utils/money`), each row is rounded to
 * 2dp, and the last row absorbs the rounding residue so the balance ends at
 * exactly 0.00 and the principal rows sum to the original principal.
 */

/** 10,000 basis points × 12 months: the denominator for a monthly rate. */
const MONTHLY_RATE_DIVISOR = 120_000;

export interface AmortizationSchedule {
  rows: AmortizationScheduleRow[];
  totalInterest: number;
  totalPaid: number;
}

export interface AmortizationScheduleInput {
  /** The annual rate in basis points, as stored on `Loan.annualInterestRateBps`. */
  annualInterestRateBps: number;
  /** The first instalment's due date; later rows advance by calendar month. */
  firstPaymentDate: Date;
  method: LoanAmortizationMethod;
  /** The amount the contract amortizes, normally `originalPrincipal`. */
  principal: number;
  /**
   * Dated rate changes. A month's interest uses the rate in force when its period opened (one
   * month before its due date); a French payment is resized, from the opening balance over the
   * months left, only when the rate in force on a due date differs from the previous due date's.
   * Before the first period, `annualInterestRateBps` applies.
   */
  ratePeriods?: readonly LoanRatePeriodInput[];
  termMonths: number;
}

export interface AmortizationScheduleRow {
  date: Date;
  endingBalance: number;
  interest: number;
  number: number;
  payment: number;
  principal: number;
}

interface WalkResult {
  rows: AmortizationScheduleRow[];
  totalInterest: number;
  totalPaid: number;
}

/**
 * Interest for one month: `balance × bps / 120,000`, rounded once to 2dp.
 *
 * The division happens at the end, on the exact numerator, rather than
 * pre-dividing the rate: a 40-digit monthly rate still drifts by a couple of
 * cents over 360 rows.
 */
function monthlyInterest(balance: Big, annualInterestRateBps: number): number {
  return roundDisplay(balance.times(big(annualInterestRateBps)).div(MONTHLY_RATE_DIVISOR));
}

/** The French level payment, rounded to 2dp. */
function frenchLevelPayment(principal: number, annualInterestRateBps: number, termMonths: number): number {
  if (annualInterestRateBps === 0) return roundDisplay(big(principal).div(termMonths));

  const monthlyRate = big(annualInterestRateBps).div(MONTHLY_RATE_DIVISOR);
  const growth = monthlyRate.plus(1).pow(termMonths);
  return roundDisplay(big(principal).times(monthlyRate).times(growth).div(growth.minus(1)));
}

/**
 * The level payment that clears `balance` over `monthsLeft` instalments when the first of them
 * is charged at `openingRateBps` (the rate in force when its period opened) and every later one
 * at `paymentRateBps` (the rate in force on its due date, which then opens the next period).
 * With one rate this is the French level payment. Rounded to 2dp.
 *
 * Sizing the change month at the new rate too would overpay it: its interest is charged at the
 * opening rate, so the balance runs ahead and the schedule clears early, leaving negative rows.
 */
export function resizedLevelPayment(balance: number, openingRateBps: number, paymentRateBps: number, monthsLeft: number): number {
  if (openingRateBps === paymentRateBps) return frenchLevelPayment(balance, paymentRateBps, monthsLeft);
  const firstMonthGrowth = big(openingRateBps).div(MONTHLY_RATE_DIVISOR).plus(1);
  const later = monthsLeft - 1;
  if (later === 0) return roundDisplay(big(balance).times(firstMonthGrowth));
  // balance·(1+i₀) = P + P·a(later, i), with a(k, i) the annuity factor (1 − (1+i)^−k) / i.
  const annuityFactor = paymentRateBps === 0
    ? big(later)
    : (() => {
        const rate = big(paymentRateBps).div(MONTHLY_RATE_DIVISOR);
        const growth = rate.plus(1).pow(later);
        return growth.minus(1).div(rate.times(growth));
      })();
  return roundDisplay(big(balance).times(firstMonthGrowth).div(annuityFactor.plus(1)));
}

/**
 * A calendar month later, keeping the original day of month where the target
 * month is long enough and clamping to its last day otherwise (31 Jan → 28/29
 * Feb, then 31 Mar again).
 */
export function addMonthsClamped(date: Date, months: number, dayOfMonth: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastDay)));
}

/*
 * Kept separate from `projectPayoff` in `payoff-projection.ts` on purpose: that walk
 * pays a fixed amount until the balance reaches zero (a projection), while this
 * one has a fixed contractual term and two methods, and its last row is an
 * adjustment. Sharing the loop would couple goal projections to loan contract
 * rules for little gain.
 */
export function buildAmortizationSchedule(input: AmortizationScheduleInput): AmortizationSchedule {
  if (!(input.principal > 0)) throw new RangeError('principal must be greater than zero');
  if (!Number.isInteger(input.termMonths) || input.termMonths <= 0) throw new RangeError('termMonths must be a positive integer');
  if (!Number.isFinite(input.annualInterestRateBps) || input.annualInterestRateBps < 0) {
    throw new RangeError('annualInterestRateBps must be zero or greater');
  }

  if (input.method === LoanAmortizationMethod.CONSTANT_PRINCIPAL) return walkConstantPrincipal(input);

  // A level payment rounded up by half a cent can clear the loan one month
  // early on a tiny balance. Step it down a cent until every non-final row
  // still leaves a positive balance, so the last row is the only adjustment.
  const periods = input.ratePeriods ?? [];
  const firstOpening = addMonthsClamped(input.firstPaymentDate, -1, input.firstPaymentDate.getUTCDate());
  let levelPayment = resizedLevelPayment(
    input.principal,
    resolveLoanRate(periods, firstOpening, input.annualInterestRateBps),
    resolveLoanRate(periods, input.firstPaymentDate, input.annualInterestRateBps),
    input.termMonths,
  );
  let result = walkFrench(input, levelPayment);
  let attempts = 0;
  while (result.rows.some((row, index) => index < result.rows.length - 1 && row.endingBalance < 0) && attempts < 100) {
    levelPayment = roundDisplay(big(levelPayment).minus(0.01));
    result = walkFrench(input, levelPayment);
    attempts += 1;
  }

  return result;
}

function walkConstantPrincipal(input: AmortizationScheduleInput): WalkResult {
  const rows: AmortizationScheduleRow[] = [];
  const firstDay = input.firstPaymentDate.getUTCDate();
  const principalPerMonth = roundDisplay(big(input.principal).div(input.termMonths));
  let balance = big(input.principal);
  let totalInterest = big(0);
  let totalPaid = big(0);

  for (let number = 1; number <= input.termMonths; number += 1) {
    const periodOpen = addMonthsClamped(input.firstPaymentDate, number - 2, firstDay);
    const interest = monthlyInterest(balance, resolveLoanRate(input.ratePeriods ?? [], periodOpen, input.annualInterestRateBps));
    const isLast = number === input.termMonths;
    // The last row takes the remaining balance, which is the residue of
    // rounding the constant principal to 2dp.
    const principal = isLast ? roundDisplay(balance) : principalPerMonth;
    const payment = roundDisplay(big(principal).plus(interest));
    const endingBalance = roundDisplay(balance.minus(principal));

    rows.push({
      date: addMonthsClamped(input.firstPaymentDate, number - 1, firstDay),
      endingBalance,
      interest,
      number,
      payment,
      principal,
    });

    balance = big(endingBalance);
    totalInterest = totalInterest.plus(interest);
    totalPaid = totalPaid.plus(payment);
  }

  return { rows, totalInterest: roundDisplay(totalInterest), totalPaid: roundDisplay(totalPaid) };
}

function walkFrench(input: AmortizationScheduleInput, firstLevelPayment: number): WalkResult {
  const rows: AmortizationScheduleRow[] = [];
  const firstDay = input.firstPaymentDate.getUTCDate();
  const periods = input.ratePeriods ?? [];
  let balance = big(input.principal);
  let levelPayment = firstLevelPayment;
  let previousPaymentRate: null | number = null;
  let totalInterest = big(0);
  let totalPaid = big(0);

  for (let number = 1; number <= input.termMonths; number += 1) {
    const date = addMonthsClamped(input.firstPaymentDate, number - 1, firstDay);
    const periodOpen = addMonthsClamped(input.firstPaymentDate, number - 2, firstDay);
    const openingRate = resolveLoanRate(periods, periodOpen, input.annualInterestRateBps);
    const interest = monthlyInterest(balance, openingRate);
    // The payment changes only when the rate in force on a due date actually changes: a
    // repeated rate, or one dated after maturity, leaves every row as the fixed-rate schedule.
    const paymentRate = resolveLoanRate(periods, date, input.annualInterestRateBps);
    if (previousPaymentRate !== null && paymentRate !== previousPaymentRate) {
      levelPayment = resizedLevelPayment(roundDisplay(balance), openingRate, paymentRate, input.termMonths - number + 1);
    }
    previousPaymentRate = paymentRate;
    const isLast = number === input.termMonths;
    // The last row takes the remaining balance, which is where every earlier
    // row's rounding lands.
    const principal = isLast ? roundDisplay(balance) : roundDisplay(big(levelPayment).minus(interest));
    const payment = isLast ? roundDisplay(big(principal).plus(interest)) : levelPayment;
    const endingBalance = roundDisplay(balance.minus(principal));

    rows.push({ date, endingBalance, interest, number, payment, principal });

    balance = big(endingBalance);
    totalInterest = totalInterest.plus(interest);
    totalPaid = totalPaid.plus(payment);
  }

  return { rows, totalInterest: roundDisplay(totalInterest), totalPaid: roundDisplay(totalPaid) };
}
