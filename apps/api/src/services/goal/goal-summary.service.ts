import { projectPayoff } from './debt-projection.service';

export interface DebtProjection {
  currentBalance: number;
  monthlyPayment: number;
  months: null | number;
  originalBalance: number;
  paidOffAmount: number;
  payoffDate: null | string;
  paysOff: boolean;
  progressPercentage: number;
  totalInterest: number;
}

export interface GoalDebtInput {
  annualInterestRateBps?: null | number;
  currentBalance?: null | number;
  extraPayment?: null | number;
  minimumPayment?: null | number;
}

export interface GoalSummary {
  assignedThisMonth: number;
  availableAmount: number;
  debtProjection?: DebtProjection;
  fundedHistorically: number;
  monthlyShortfall: null | number;
  progressPercentage: number;
  remainingToTarget: number;
  requiredMonthlyContribution: null | number;
  spentAmount: number;
  status: GoalSummaryStatus;
}

export interface GoalSummaryInput {
  assignedThisMonth: number;
  availableAmount: number;
  debt?: GoalDebtInput;
  isDebt?: boolean;
  monthlyContributionTarget?: null | number;
  now: Date;
  paused: boolean;
  spentAmount: number;
  targetAmount: number;
  targetDate?: Date | null;
}

export type GoalSummaryStatus = 'behind' | 'funded' | 'on_track' | 'paused';

export function buildGoalSummary(input: GoalSummaryInput): GoalSummary {
  const debtProjection = input.isDebt ? buildDebtProjection(input) : undefined;
  const remainingToTarget = Math.max(input.targetAmount - input.availableAmount, 0);
  const progressPercentage = input.targetAmount > 0 ? Math.min((input.availableAmount / input.targetAmount) * 100, 100) : 0;
  const fundedHistorically = input.availableAmount + input.spentAmount;
  const manualTarget = input.monthlyContributionTarget ?? null;
  const targetBasedRequired =
    manualTarget ??
    (() => {
      const monthsRemaining = getMonthsRemaining(input.now, input.targetDate);
      if (monthsRemaining === null) return null;
      return remainingToTarget / Math.max(monthsRemaining, 1);
    })();
  const requiredMonthlyContribution = targetBasedRequired;
  const monthlyShortfall =
    requiredMonthlyContribution === null ? null : Math.max(requiredMonthlyContribution - input.assignedThisMonth, 0);

  let status: GoalSummaryStatus = 'on_track';
  if (input.paused) status = 'paused';
  else if (input.availableAmount >= input.targetAmount) status = 'funded';
  else if (requiredMonthlyContribution !== null && input.assignedThisMonth < requiredMonthlyContribution) status = 'behind';

  return {
    assignedThisMonth: input.assignedThisMonth,
    availableAmount: input.availableAmount,
    ...(debtProjection ? { debtProjection } : {}),
    fundedHistorically,
    monthlyShortfall,
    progressPercentage,
    remainingToTarget,
    requiredMonthlyContribution,
    spentAmount: input.spentAmount,
    status,
  };
}

function buildDebtProjection(input: GoalSummaryInput): DebtProjection {
  const originalBalance = input.targetAmount;
  // Paid off = (reduction in the user's manual balance snapshot) + (money funded toward the goal).
  // Without folding `availableAmount` in, the projection stays at 0% for debt goals that the user
  // pays down via the goal reserve instead of editing `currentBalance` directly.
  const userReportedBalance = input.debt?.currentBalance ?? null;
  const reportedPaidOff = userReportedBalance !== null ? Math.max(originalBalance - userReportedBalance, 0) : 0;
  const paidOffAmount = originalBalance > 0 ? Math.min(originalBalance, reportedPaidOff + input.availableAmount) : 0;
  // True remaining balance for projection purposes (consistent with paidOffAmount).
  const currentBalance = Math.max(originalBalance - paidOffAmount, 0);
  const annualInterestRateBps = input.debt?.annualInterestRateBps ?? 0;
  const monthlyPayment = (input.debt?.minimumPayment ?? 0) + (input.debt?.extraPayment ?? 0);
  const progressPercentage = originalBalance > 0 ? Math.min((paidOffAmount / originalBalance) * 100, 100) : 0;

  const projection = projectPayoff({ annualInterestRateBps, balance: currentBalance, monthlyPayment });
  let payoffDate: null | string = null;
  if (projection.months !== null) {
    const date = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth() + projection.months, 1));
    payoffDate = date.toISOString().slice(0, 10);
  }

  return {
    currentBalance,
    monthlyPayment,
    months: projection.months,
    originalBalance,
    paidOffAmount,
    payoffDate,
    paysOff: projection.paysOff,
    progressPercentage,
    totalInterest: projection.totalInterest,
  };
}

function getMonthsRemaining(now: Date, targetDate?: Date | null): null | number {
  if (!targetDate) return null;
  return (targetDate.getFullYear() - now.getFullYear()) * 12 + (targetDate.getMonth() - now.getMonth());
}
