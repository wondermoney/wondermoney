/**
 * Savings goal solver: given all but one of the goal, the monthly contribution and the time,
 * work out the missing one.
 *
 * The balance grows once a month at the monthly rate equivalent to the annual return,
 * (1 + annual)^(1/12) − 1, so twelve months compound to exactly the annual return. Each
 * month's growth is rounded to the cent and the contribution lands at the end of the month,
 * after that month's growth. Everything runs in whole cents, so every row of the schedule adds
 * up to the totals exactly.
 */

export const SOLVE_FOR_OPTIONS = ["contribution", "time", "finalAmount"] as const;
export type SolveFor = (typeof SOLVE_FOR_OPTIONS)[number];

export const SAVINGS_GOAL_LIMITS = {
  /** Euros, for the goal, the starting savings and the monthly contribution. */
  maxAmount: 100_000_000,
  /** Expected annual return, in percent. */
  maxAnnualReturn: 30,
  /** 100 years: the longest period the calculator saves over or searches for the goal. */
  maxMonths: 1200,
  /**
   * Euros. A balance past this (a very long period at a high return) is reported rather than
   * shown, which also keeps every figure well inside exact integer cents.
   */
  maxBalance: 1_000_000_000_000,
} as const;

export const DEFAULT_ANNUAL_RETURN = 2;

/** The calculator's starting values, which are also the page's worked example. */
export const SAVINGS_GOAL_EXAMPLE = {
  solveFor: "contribution",
  goalAmount: 10_000,
  startingSavings: 1_000,
  monthlyContribution: 250,
  years: 3,
  months: 0,
  annualReturn: DEFAULT_ANNUAL_RETURN,
} as const satisfies SavingsGoalInput;

export type SavingsGoalInput = {
  solveFor: SolveFor;
  /** Euros. Not used when solving for the final amount. */
  goalAmount: number;
  /** Euros already saved. Empty (NaN) reads as none. */
  startingSavings: number;
  /** Euros a month. Not used when solving for the contribution. Empty (NaN) reads as none. */
  monthlyContribution: number;
  /** The saving period is years × 12 + months. Not used when solving for the time. */
  years: number;
  months: number;
  /** Expected annual return in percent (2 means 2%). Empty (NaN) reads as 0%. */
  annualReturn: number;
};

export type SavingsGoalField =
  | "goalAmount"
  | "startingSavings"
  | "monthlyContribution"
  | "period"
  | "annualReturn";

export type SavingsGoalInputError = "required" | "negative" | "tooLarge";

export type SavingsGoalStatus =
  /** Solved: the contribution, the time or the final amount. */
  | "solved"
  /** The starting savings already cover the goal. */
  | "reached"
  /** Solving for the contribution: growth alone reaches the goal within the period. */
  | "growthAlone"
  /** Solving for the time: nothing is added and nothing grows, so the goal is never reached. */
  | "never"
  /** Solving for the time: the goal is not reached within 100 years. */
  | "beyondHorizon"
  /** The balance would pass SAVINGS_GOAL_LIMITS.maxBalance. */
  | "tooLarge";

export type SavingsGoalYear = {
  /** 1-based year of the plan. */
  year: number;
  /** Months since the start at the end of this row; the last row can be a part year. */
  month: number;
  /** Monthly contributions added up to the end of this row, without the starting savings. */
  contributions: number;
  /** Growth added up to the end of this row. */
  growth: number;
  /** Starting savings + contributions + growth at the end of this row. */
  balance: number;
};

export type SavingsGoalResult = {
  status: SavingsGoalStatus;
  solveFor: SolveFor;
  /** The contribution used, or the one solved for. */
  monthlyContribution: number;
  /** The period used, or the months solved for. Null when the goal is not reached. */
  months: number | null;
  startingSavings: number;
  goalAmount: number;
  annualReturn: number;
  /** The equivalent monthly rate, in percent. */
  monthlyRate: number;
  /** Balance at the end of the period, or in the month the goal is reached. */
  finalBalance: number;
  totalContributions: number;
  totalGrowth: number;
  /** One row per year; empty when there is nothing to show. */
  years: SavingsGoalYear[];
};

export type SavingsGoalCalculation =
  | { ok: true; result: SavingsGoalResult }
  | { ok: false; errors: Partial<Record<SavingsGoalField, SavingsGoalInputError>> };

const MAX_BALANCE_CENTS = SAVINGS_GOAL_LIMITS.maxBalance * 100;

function isBlank(value: number): boolean {
  return Number.isNaN(value);
}

function amountError(value: number, { required }: { required: boolean }) {
  if (isBlank(value) || value === 0) return required ? "required" : undefined;
  if (value < 0) return "negative";
  if (value > SAVINGS_GOAL_LIMITS.maxAmount) return "tooLarge";
  return undefined;
}

function periodMonths(input: SavingsGoalInput): number {
  const years = isBlank(input.years) ? 0 : input.years;
  const months = isBlank(input.months) ? 0 : input.months;
  return Math.round(years * 12 + months);
}

function validate(
  input: SavingsGoalInput,
): Partial<Record<SavingsGoalField, SavingsGoalInputError>> {
  const errors: Partial<Record<SavingsGoalField, SavingsGoalInputError>> = {};
  const set = (field: SavingsGoalField, error: SavingsGoalInputError | undefined) => {
    if (error) errors[field] = error;
  };

  if (input.solveFor !== "finalAmount") {
    set("goalAmount", amountError(input.goalAmount, { required: true }));
  }
  set("startingSavings", amountError(input.startingSavings, { required: false }));
  if (input.solveFor !== "contribution") {
    set("monthlyContribution", amountError(input.monthlyContribution, { required: false }));
  }
  if (input.solveFor !== "time") {
    if (input.years < 0 || input.months < 0) set("period", "negative");
    else if (periodMonths(input) < 1) set("period", "required");
    else if (periodMonths(input) > SAVINGS_GOAL_LIMITS.maxMonths) set("period", "tooLarge");
  }
  if (input.annualReturn < 0) set("annualReturn", "negative");
  else if (input.annualReturn > SAVINGS_GOAL_LIMITS.maxAnnualReturn) set("annualReturn", "tooLarge");

  return errors;
}

function toCents(value: number): number {
  return isBlank(value) ? 0 : Math.round(value * 100);
}

/** The monthly rate that compounds to `annualReturn` percent over twelve months, as a fraction. */
export function monthlyRateFor(annualReturn: number): number {
  return Math.pow(1 + annualReturn / 100, 1 / 12) - 1;
}

type Simulation = {
  /** Months actually run. */
  months: number;
  balanceCents: number;
  contributionCents: number;
  growthCents: number;
  rows: { month: number; balanceCents: number; contributionCents: number; growthCents: number }[];
  overflow: boolean;
};

/**
 * Runs the plan month by month for up to `months` months, stopping early once the balance
 * reaches `stopAtCents` (when given) or passes the largest balance the calculator shows.
 */
function simulate(
  startCents: number,
  contributionCents: number,
  rate: number,
  months: number,
  stopAtCents?: number,
): Simulation {
  let balanceCents = startCents;
  let totalContributionCents = 0;
  let growthCents = 0;
  const rows: Simulation["rows"] = [];
  let month = 0;

  while (month < months) {
    month += 1;
    const growth = Math.round(balanceCents * rate);
    growthCents += growth;
    totalContributionCents += contributionCents;
    balanceCents += growth + contributionCents;

    if (balanceCents > MAX_BALANCE_CENTS) {
      return {
        months: month,
        balanceCents,
        contributionCents: totalContributionCents,
        growthCents,
        rows,
        overflow: true,
      };
    }

    const reached = stopAtCents !== undefined && balanceCents >= stopAtCents;
    if (month % 12 === 0 || month === months || reached) {
      rows.push({
        month,
        balanceCents,
        contributionCents: totalContributionCents,
        growthCents,
      });
    }
    if (reached) break;
  }

  return {
    months: month,
    balanceCents,
    contributionCents: totalContributionCents,
    growthCents,
    rows,
    overflow: false,
  };
}

/** Whether `contributionCents` a month reaches the goal within `months` months. */
function reaches(
  startCents: number,
  contributionCents: number,
  rate: number,
  months: number,
  goalCents: number,
): boolean {
  return simulate(startCents, contributionCents, rate, months, goalCents).balanceCents >= goalCents;
}

/**
 * The smallest whole-cent monthly contribution that reaches the goal within `months` months.
 * The closed form gives the estimate (with 0% return it is a plain division, so nothing divides
 * by zero); the month-by-month rounding of growth can move the true answer by a cent, so the
 * estimate is then nudged until it is the smallest one that reaches the goal.
 */
function solveContributionCents(
  startCents: number,
  goalCents: number,
  rate: number,
  months: number,
): number {
  const growthFactor = Math.pow(1 + rate, months);
  const annuityFactor = rate === 0 ? months : (growthFactor - 1) / rate;
  let cents = Math.max(0, Math.ceil((goalCents - startCents * growthFactor) / annuityFactor));

  while (!reaches(startCents, cents, rate, months, goalCents)) cents += 1;
  while (cents > 0 && reaches(startCents, cents - 1, rate, months, goalCents)) cents -= 1;
  return cents;
}

function toYears(simulation: Simulation): SavingsGoalYear[] {
  return simulation.rows.map((row) => ({
    year: Math.ceil(row.month / 12),
    month: row.month,
    contributions: row.contributionCents / 100,
    growth: row.growthCents / 100,
    balance: row.balanceCents / 100,
  }));
}

export function computeSavingsGoal(input: SavingsGoalInput): SavingsGoalCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const { solveFor } = input;
  const startCents = toCents(input.startingSavings);
  const goalCents = solveFor === "finalAmount" ? 0 : toCents(input.goalAmount);
  const annualReturn = isBlank(input.annualReturn) ? 0 : input.annualReturn;
  const rate = monthlyRateFor(annualReturn);

  const base = {
    solveFor,
    startingSavings: startCents / 100,
    goalAmount: goalCents / 100,
    annualReturn,
    monthlyRate: rate * 100,
  };

  const finish = (
    status: SavingsGoalStatus,
    contributionCents: number,
    simulation: Simulation | null,
    months: number | null,
  ): SavingsGoalCalculation => {
    if (simulation?.overflow) {
      return {
        ok: true,
        result: {
          ...base,
          status: "tooLarge",
          monthlyContribution: contributionCents / 100,
          months,
          finalBalance: 0,
          totalContributions: 0,
          totalGrowth: 0,
          years: [],
        },
      };
    }
    return {
      ok: true,
      result: {
        ...base,
        status,
        monthlyContribution: contributionCents / 100,
        months,
        finalBalance: (simulation?.balanceCents ?? startCents) / 100,
        totalContributions: (simulation?.contributionCents ?? 0) / 100,
        totalGrowth: (simulation?.growthCents ?? 0) / 100,
        years: simulation ? toYears(simulation) : [],
      },
    };
  };

  if (solveFor === "finalAmount") {
    const months = periodMonths(input);
    const contributionCents = toCents(input.monthlyContribution);
    return finish("solved", contributionCents, simulate(startCents, contributionCents, rate, months), months);
  }

  if (solveFor === "contribution") {
    const months = periodMonths(input);
    if (startCents >= goalCents) {
      return finish("reached", 0, simulate(startCents, 0, rate, months), months);
    }
    const contributionCents = solveContributionCents(startCents, goalCents, rate, months);
    return finish(
      contributionCents === 0 ? "growthAlone" : "solved",
      contributionCents,
      simulate(startCents, contributionCents, rate, months),
      months,
    );
  }

  // Solving for the time.
  const contributionCents = toCents(input.monthlyContribution);
  if (startCents >= goalCents) return finish("reached", contributionCents, null, 0);
  if (contributionCents === 0 && (startCents === 0 || rate === 0)) {
    return finish("never", 0, null, null);
  }
  const simulation = simulate(
    startCents,
    contributionCents,
    rate,
    SAVINGS_GOAL_LIMITS.maxMonths,
    goalCents,
  );
  if (simulation.balanceCents < goalCents) return finish("beyondHorizon", contributionCents, null, null);
  return finish("solved", contributionCents, simulation, simulation.months);
}
