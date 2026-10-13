import { calculateRemainingTermMonths } from '@service/loan/loan-calculation.service';
import { roundDisplay } from '@utils/money';

/**
 * Pure debt payoff projection helpers for debt-paydown goals.
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
  // RAD-audit: was `Math.round((value + Number.EPSILON) * 100) / 100`. The EPSILON term is
  // cargo-cult — it fixes nothing at realistic money magnitudes — and Math.round is
  // asymmetric for negatives. Delegates to the shared half-even helper.
  return roundDisplay(value);
}

/**
 * Project the amortisation schedule for a single debt paid with a fixed monthly amount.
 * Returns `paysOff: false` (months null, empty schedule) when the payment cannot cover
 * the monthly interest, i.e. the balance would never reach zero.
 */
export interface StrategyDebtResult {
  id: number;
  months: null | number;
  totalInterest: number;
}

export interface StrategyResult {
  months: number;
  order: number[];
  perDebt: StrategyDebtResult[];
  totalInterest: number;
}

interface DebtInput {
  annualInterestRateBps: number;
  balance: number;
  id: number;
  minimumPayment: number;
}

interface SimDebt {
  balance: number;
  cleared: boolean;
  id: number;
  minimumPayment: number;
  months: null | number;
  rate: number;
  totalInterest: number;
}

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

/**
 * Simulate paying a set of debts in a fixed priority order. Every debt pays its minimum
 * each month; the pooled `extraBudget` plus the minimums freed by already-cleared debts
 * are thrown at the highest-priority active debt (the "rolldown"/"snowball" effect).
 */
function simulate(order: DebtInput[], extraBudget: number): StrategyResult {
  const debts: SimDebt[] = order.map((debt) => ({
    balance: debt.balance,
    cleared: debt.balance <= 0,
    id: debt.id,
    minimumPayment: debt.minimumPayment,
    months: debt.balance <= 0 ? 0 : null,
    rate: monthlyRate(debt.annualInterestRateBps),
    totalInterest: 0,
  }));

  let month = 0;
  while (debts.some((debt) => !debt.cleared) && month < MAX_MONTHS) {
    month += 1;

    // Accrue interest on every active debt.
    for (const debt of debts) {
      if (debt.cleared) continue;
      const interest = round2(debt.balance * debt.rate);
      debt.balance = round2(debt.balance + interest);
      debt.totalInterest = round2(debt.totalInterest + interest);
    }

    // Freed minimums from cleared debts roll into the extra pool.
    const freed = debts.filter((debt) => debt.cleared).reduce((sum, debt) => sum + debt.minimumPayment, 0);
    let pool = extraBudget + freed;

    // Highest-priority active debt receives the pool on top of its minimum.
    const targetId = debts.find((debt) => !debt.cleared)?.id;
    for (const debt of debts) {
      if (debt.cleared) continue;
      let payment = debt.minimumPayment;
      if (debt.id === targetId) {
        payment += pool;
        pool = 0;
      }
      payment = Math.min(payment, debt.balance);
      debt.balance = round2(debt.balance - payment);
      if (debt.balance <= 0) {
        debt.balance = 0;
        debt.cleared = true;
        debt.months = month;
      }
    }
  }

  const months = debts.reduce((max, debt) => Math.max(max, debt.months ?? MAX_MONTHS), 0);
  return {
    months,
    order: debts.map((debt) => debt.id),
    perDebt: debts.map((debt) => ({ id: debt.id, months: debt.months, totalInterest: round2(debt.totalInterest) })),
    totalInterest: round2(debts.reduce((sum, debt) => sum + debt.totalInterest, 0)),
  };
}

/**
 * Compare the avalanche (highest interest rate first) and snowball (lowest balance first)
 * payoff strategies across a set of debts sharing a pooled extra monthly budget.
 */
export function compareStrategies(input: {
  debts: DebtInput[];
  extraBudget: number;
}): { avalanche: StrategyResult; snowball: StrategyResult } {
  const avalancheOrder = [...input.debts].sort((a, b) => b.annualInterestRateBps - a.annualInterestRateBps || a.balance - b.balance);
  const snowballOrder = [...input.debts].sort((a, b) => a.balance - b.balance || b.annualInterestRateBps - a.annualInterestRateBps);

  return {
    avalanche: simulate(avalancheOrder, input.extraBudget),
    snowball: simulate(snowballOrder, input.extraBudget),
  };
}
