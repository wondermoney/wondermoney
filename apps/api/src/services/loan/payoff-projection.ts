import { calculateRemainingTermMonths } from '@service/loan/loan-calculation.service';
import { roundDisplay } from '@utils/money';

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
 * Project the amortisation schedule for a single debt paid with a fixed monthly amount.
 * Returns `paysOff: false` (months null, empty schedule) when the payment cannot cover
 * the monthly interest, i.e. the balance would never reach zero.
 */
export function projectPayoff(input: {
  annualInterestRateBps: number;
  balance: number;
  monthlyPayment: number;
}): PayoffProjection {
  const termMonths = calculateRemainingTermMonths({
    annualInterestRateBps: input.annualInterestRateBps,
    outstandingPrincipal: input.balance,
    regularPaymentAmount: input.monthlyPayment,
  });

  if (termMonths === null || input.balance <= 0) {
    return { months: input.balance <= 0 ? 0 : null, paysOff: input.balance <= 0, schedule: [], totalInterest: 0 };
  }

  const rate = monthlyRate(input.annualInterestRateBps);
  const schedule: PayoffScheduleEntry[] = [];
  let balance = input.balance;
  let totalInterest = 0;
  let month = 0;

  while (balance > 0 && month < MAX_MONTHS) {
    month += 1;
    const startingBalance = round2(balance);
    const interest = round2(startingBalance * rate);
    // Final payment clamps to whatever is left so the balance lands exactly on zero.
    const payment = Math.min(input.monthlyPayment, startingBalance + interest);
    const principal = round2(payment - interest);
    const endingBalance = round2(startingBalance - principal);

    schedule.push({ endingBalance, interest, month, principal, startingBalance });
    totalInterest = round2(totalInterest + interest);
    balance = endingBalance;
  }

  return { months: schedule.length, paysOff: true, schedule, totalInterest: round2(totalInterest) };
}
