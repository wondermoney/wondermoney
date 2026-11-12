import { calculateRemainingTermMonths } from '@service/loan/loan-calculation.service';
import { roundDisplay } from '@utils/money';

import { addMonthsClamped } from './amortization-schedule';
import { type LoanRatePeriodInput, resolveLoanRate } from './rate-resolver';

/**
 * Pure debt payoff projection helpers shared by debt-paydown goals and loan payoff
 * projections.
 *
 * Interest rates are integer basis points (bps), matching Loan
 * (`annualInterestRateBps`): 19.99% => 1999. Money amounts are rounded to 2dp,
 * consistent with the loan repayment allocation math.
 */

const MAX_MONTHS = 1200; // 100-year guard against runaway simulations.

export interface PayoffProjection {
  months: null | number;
  paysOff: boolean;
  schedule: PayoffScheduleEntry[];
  totalInterest: number;
}

export interface PayoffScheduleEntry {
  endingBalance: number;
  interest: number;
  month: number;
  principal: number;
  startingBalance: number;
}

function monthlyRate(annualInterestRateBps: number): number {
  return annualInterestRateBps / 10000 / 12;
}

function round2(value: number): number {
  // Not `Math.round((value + Number.EPSILON) * 100) / 100`: the EPSILON term fixes nothing at
  // realistic money magnitudes, and Math.round is asymmetric for negatives. Delegates to the
  // shared half-even helper.
  return roundDisplay(value);
}

/**
 * The calendar a loan projection walks: month `m` is paid on `firstPaymentDate` plus `m - 1`
 * calendar months (on `dayOfMonth`, clamped to short months), and its interest is charged at the
 * rate in force when its period opened, one month before the payment.
 */
export interface PayoffCalendar {
  /** The contract's payment day; defaults to `firstPaymentDate`'s, which a short month clamps. */
  dayOfMonth?: number;
  firstPaymentDate: Date;
  /**
   * The payment due on `date`, given the balance the month starts with. Defaults to
   * `monthlyPayment`. Called once per month, in order. `Infinity` pays whatever is left, as a
   * final instalment that absorbs rounding does.
   */
  paymentOn?: (date: Date, startingBalance: number) => number;
  ratePeriods?: readonly LoanRatePeriodInput[];
}

/**
 * Project the amortisation schedule for a single debt.
 *
 * Without a `calendar` (debt-paydown goals) the debt is paid a fixed `monthlyPayment` at a fixed
 * rate; `paysOff: false` (months null, empty schedule) when that payment cannot cover the monthly
 * interest, i.e. the balance would never reach zero.
 *
 * With a `calendar` (loans) each month's rate and payment come from its dates, so a payment
 * below one month's interest need not be final: a later rate cut or a resized payment can still
 * clear the debt. `paysOff: false` then means the balance is not cleared within 100 years.
 */
export function projectPayoff(input: {
  annualInterestRateBps: number;
  balance: number;
  calendar?: PayoffCalendar;
  monthlyPayment: number;
}): PayoffProjection {
  if (input.balance <= 0) return { months: 0, paysOff: true, schedule: [], totalInterest: 0 };
  const { calendar } = input;

  if (!calendar) {
    const termMonths = calculateRemainingTermMonths({
      annualInterestRateBps: input.annualInterestRateBps,
      outstandingPrincipal: input.balance,
      regularPaymentAmount: input.monthlyPayment,
    });
    if (termMonths === null) return { months: null, paysOff: false, schedule: [], totalInterest: 0 };
  }

  const dayOfMonth = calendar?.dayOfMonth ?? calendar?.firstPaymentDate.getUTCDate() ?? 1;
  const schedule: PayoffScheduleEntry[] = [];
  let balance = input.balance;
  let totalInterest = 0;
  let month = 0;

  while (balance > 0 && month < MAX_MONTHS) {
    month += 1;
    const startingBalance = round2(balance);
    let rate = input.annualInterestRateBps;
    let monthlyPayment = input.monthlyPayment;
    if (calendar) {
      const opened = addMonthsClamped(calendar.firstPaymentDate, month - 2, dayOfMonth);
      rate = resolveLoanRate(calendar.ratePeriods ?? [], opened, input.annualInterestRateBps);
      const due = addMonthsClamped(calendar.firstPaymentDate, month - 1, dayOfMonth);
      monthlyPayment = calendar.paymentOn?.(due, startingBalance) ?? input.monthlyPayment;
    }
    const interest = round2(startingBalance * monthlyRate(rate));
    // Final payment clamps to whatever is left so the balance lands exactly on zero.
    const payment = Math.min(monthlyPayment, startingBalance + interest);
    const principal = round2(payment - interest);
    const endingBalance = round2(startingBalance - principal);

    schedule.push({ endingBalance, interest, month, principal, startingBalance });
    totalInterest = round2(totalInterest + interest);
    balance = endingBalance;
  }

  if (balance > 0 && calendar) return { months: null, paysOff: false, schedule: [], totalInterest: 0 };
  return { months: schedule.length, paysOff: true, schedule, totalInterest: round2(totalInterest) };
}
