/**
 * Compound interest with monthly contributions, shown in nominal euros and in
 * today's money.
 *
 * Assumptions, stated on the page: the annual return is constant and split
 * into twelve equal monthly rates; each contribution goes in at the end of
 * the month; there are no taxes or fees. Inflation is a constant annual rate,
 * used only to restate future euros in today's purchasing power.
 *
 * The balance runs in integer cents, with each month's growth rounded to the
 * cent. Displayed totals are whole euros, and growth is always the final value
 * minus what went in, so the three figures on screen add up.
 */

/** Largest initial amount or monthly contribution the calculator accepts, in euros. */
export const MAX_AMOUNT = 1_000_000_000;
/** Longest period, in whole years. */
export const MAX_YEARS = 60;
/** Highest annual return or inflation rate, in percent. */
export const MAX_RATE = 50;
/**
 * Past this balance, in euros, the calculation stops and reports `tooLarge`.
 * In cents it stays far inside Number.MAX_SAFE_INTEGER, so every cent is exact.
 */
export const MAX_RESULT = 1_000_000_000_000;

/** The comparison starts this much above the current monthly contribution. */
export const COMPARISON_UPLIFT = 0.5;
/** The comparison's starting amount when there is no current contribution. */
export const COMPARISON_FALLBACK = 100;

export type CompoundInterestParams = {
  principal: number;
  monthlyContribution: number;
  /** Expected annual return, in percent. */
  annualRate: number;
  /** Expected annual inflation, in percent. */
  inflationRate: number;
  years: number;
};

/** The calculator's starting values, which are also the page's worked example. */
export const EXAMPLE_INPUTS = {
  principal: 10000,
  monthlyContribution: 200,
  annualRate: 7,
  inflationRate: 2,
  years: 20,
} as const satisfies CompoundInterestParams;

/** Whole euros; `growth` is always `finalValue - contributed`. */
export type CompoundInterestTotals = {
  contributed: number;
  growth: number;
  finalValue: number;
};

/** The balance at the end of a year (year 0 is the starting amount), in whole euros. */
export type CompoundInterestYear = {
  year: number;
  contributed: number;
  growth: number;
  value: number;
  /** `value` in today's money. */
  realValue: number;
};

export type CompoundInterestStatus =
  /** A projection over at least one year. */
  | "ok"
  /** A period of 0 years: the final value is the starting amount. */
  | "noPeriod"
  /** No initial amount and no monthly contribution. */
  | "nothingInvested"
  /** The balance passes MAX_RESULT, so no figures are shown. */
  | "tooLarge"
  /** The annual return or the period is empty (NaN), so there is nothing to project yet. */
  | "incomplete";

type ResultBase = {
  /** The inputs actually used, after clamping to their ranges. */
  inputs: CompoundInterestParams;
  /** True when an input was negative or above its range and was adjusted. */
  adjusted: boolean;
  /**
   * True when there is inflation and it is at or above what the return earns
   * over a year once compounded monthly (7% earns 7.23%), so both rates are annual.
   */
  inflationAtOrAboveReturn: boolean;
};

export type CompoundInterestResult = ResultBase &
  (
    | {
        status: Exclude<CompoundInterestStatus, "tooLarge" | "incomplete">;
        nominal: CompoundInterestTotals;
        /** The same totals in today's money. */
        real: CompoundInterestTotals;
        schedule: CompoundInterestYear[];
      }
    | { status: "tooLarge"; nominal: null; real: null; schedule: [] }
    | { status: "incomplete"; nominal: null; real: null; schedule: [] }
  );

export type ContributionComparison = {
  current: CompoundInterestResult;
  comparison: CompoundInterestResult;
  /** Comparison minus current; null when either side is too large to show. */
  difference: {
    monthlyContribution: number;
    nominal: CompoundInterestTotals;
    real: CompoundInterestTotals;
  } | null;
};

type Clamped = { value: number; adjusted: boolean };

function clamp(value: number, max: number, min = 0): Clamped {
  // An empty amount or inflation (NaN) reads as 0, which is in range. An empty return or
  // period is caught before this and reported as `incomplete`.
  if (Number.isNaN(value)) return { value: 0, adjusted: false };
  if (value < min) return { value: min, adjusted: true };
  if (value > max) return { value: max, adjusted: true };
  return { value, adjusted: false };
}

function clampYears(value: number): Clamped {
  const { value: clamped, adjusted } = clamp(value, MAX_YEARS);
  return { value: Math.round(clamped), adjusted };
}

/** The yearly growth, in percent, of an annual rate compounded monthly. */
export function effectiveAnnualRate(annualRate: number): number {
  return ((1 + annualRate / 100 / 12) ** 12 - 1) * 100;
}

const toEuros = (cents: number) => Math.round(cents / 100);

function totalsFromCents(contributedCents: number, finalCents: number): CompoundInterestTotals {
  const contributed = toEuros(contributedCents);
  const finalValue = toEuros(finalCents);
  return { contributed, growth: finalValue - contributed, finalValue };
}

export function computeCompoundInterest(
  params: CompoundInterestParams,
  { allowNegativeReturn = false } = {},
): CompoundInterestResult {
  const principal = clamp(params.principal, MAX_AMOUNT);
  const contribution = clamp(params.monthlyContribution, MAX_AMOUNT);
  // The lowest nominal rate allowed in a loss scenario is -100%, safely above a total monthly loss.
  const annualRate = clamp(params.annualRate, MAX_RATE, allowNegativeReturn ? -100 : 0);
  const inflationRate = clamp(params.inflationRate, MAX_RATE);
  const years = clampYears(params.years);

  const base: ResultBase = {
    inputs: {
      principal: principal.value,
      monthlyContribution: contribution.value,
      annualRate: annualRate.value,
      inflationRate: inflationRate.value,
      years: years.value,
    },
    adjusted: [principal, contribution, annualRate, inflationRate, years].some((c) => c.adjusted),
    inflationAtOrAboveReturn:
      inflationRate.value > 0 && inflationRate.value >= effectiveAnnualRate(annualRate.value),
  };

  if (Number.isNaN(params.annualRate) || Number.isNaN(params.years)) {
    return { ...base, status: "incomplete", nominal: null, real: null, schedule: [] };
  }

  const monthlyRate = annualRate.value / 100 / 12;
  const monthlyInflation = (1 + inflationRate.value / 100) ** (1 / 12);
  const contributionCents = Math.round(contribution.value * 100);
  const maxCents = MAX_RESULT * 100;

  const principalCents = Math.round(principal.value * 100);
  let balanceCents = principalCents;
  let contributedCents = balanceCents;
  // Each euro paid in, restated in today's money at the month it is paid.
  let realContributedCents = balanceCents;

  const row = (year: number): CompoundInterestYear => {
    const totals = totalsFromCents(contributedCents, balanceCents);
    return {
      year,
      contributed: totals.contributed,
      growth: totals.growth,
      value: totals.finalValue,
      realValue: toEuros(balanceCents / monthlyInflation ** (year * 12)),
    };
  };

  const schedule: CompoundInterestYear[] = [row(0)];

  for (let month = 1; month <= years.value * 12; month += 1) {
    balanceCents += Math.round(balanceCents * monthlyRate) + contributionCents;
    contributedCents += contributionCents;
    realContributedCents += contributionCents / monthlyInflation ** month;

    if (balanceCents > maxCents) {
      return { ...base, status: "tooLarge", nominal: null, real: null, schedule: [] };
    }
    if (month % 12 === 0) schedule.push(row(month / 12));
  }

  const realFinalCents = balanceCents / monthlyInflation ** (years.value * 12);
  // Judged in cents: amounts that round to nothing invest nothing.
  const status =
    principalCents === 0 && contributionCents === 0
      ? "nothingInvested"
      : years.value === 0
        ? "noPeriod"
        : "ok";

  return {
    ...base,
    status,
    nominal: totalsFromCents(contributedCents, balanceCents),
    real: totalsFromCents(realContributedCents, realFinalCents),
    schedule,
  };
}

/**
 * The comparison's starting amount: 50% above the current contribution,
 * rounded up to whole euros so it never starts below it, or COMPARISON_FALLBACK
 * when there is no contribution to the cent.
 */
export function defaultComparisonContribution(monthlyContribution: number): number {
  const current = clamp(monthlyContribution, MAX_AMOUNT).value;
  if (Math.round(current * 100) === 0) return COMPARISON_FALLBACK;
  return Math.min(MAX_AMOUNT, Math.max(current, Math.ceil(current * (1 + COMPARISON_UPLIFT))));
}

const subtract = (a: CompoundInterestTotals, b: CompoundInterestTotals): CompoundInterestTotals => ({
  contributed: a.contributed - b.contributed,
  growth: a.growth - b.growth,
  finalValue: a.finalValue - b.finalValue,
});

/**
 * The same plan at the current and at a second monthly contribution. An empty comparison
 * contribution (NaN) leaves the comparison `incomplete` rather than comparing against 0.
 */
export function compareContributions(
  params: CompoundInterestParams,
  comparisonContribution: number,
): ContributionComparison {
  const current = computeCompoundInterest(params);
  const projected = computeCompoundInterest({
    ...params,
    monthlyContribution: comparisonContribution,
  });
  const comparison: CompoundInterestResult = Number.isNaN(comparisonContribution)
    ? { ...projected, status: "incomplete", nominal: null, real: null, schedule: [] }
    : projected;

  const difference =
    current.nominal && comparison.nominal && current.real && comparison.real
      ? {
          monthlyContribution:
            comparison.inputs.monthlyContribution - current.inputs.monthlyContribution,
          nominal: subtract(comparison.nominal, current.nominal),
          real: subtract(comparison.real, current.real),
        }
      : null;

  return { current, comparison, difference };
}
