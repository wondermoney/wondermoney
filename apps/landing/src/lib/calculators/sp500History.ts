import { SP500_HISTORY, SP500_HISTORY_SOURCE, type Sp500HistoryRow } from "./data/sp500History";

export { SP500_HISTORY, SP500_HISTORY_SOURCE };

export const SP500_HISTORY_LIMITS = {
  firstYear: SP500_HISTORY_SOURCE.firstYear,
  lastYear: SP500_HISTORY_SOURCE.lastYear,
  maxAmount: 1_000_000_000,
} as const;

/**
 * Widely published S&P 500 total returns (year-end to year-end closes, rounded to whole percent)
 * the guide sets beside this data's own figures, so the method difference is on the page.
 */
export const SP500_HISTORY_SPOT_CHECKS = [
  { year: 2008, published: -37 },
  { year: 2013, published: 32 },
] as const;

export interface Sp500HistoryInput {
  /** The money goes in on 1 January of this year. */
  startYear: number;
  /** The last calendar year of the range, counted in full. */
  endYear: number;
  initial: number;
  /** Added on 1 January of every year of the range, the first included. */
  annualContribution: number;
  /** Total return (dividends reinvested) when true, price return when false. */
  reinvestDividends: boolean;
  /** Values in the start year's money when true, nominal dollars when false. */
  inflationAdjusted: boolean;
}

export type Sp500HistoryField = "startYear" | "endYear" | "initial" | "annualContribution";
export type Sp500HistoryError =
  | "required"
  | "whole"
  | "outOfRange"
  | "tooSmall"
  | "tooLarge"
  | "beforeStart"
  | "nothingInvested";

export const SP500_HISTORY_EXAMPLE: Sp500HistoryInput = {
  startYear: 2000,
  endYear: 2024,
  initial: 10_000,
  annualContribution: 0,
  reinvestDividends: true,
  inflationAdjusted: false,
};

export interface Sp500HistoryYear {
  year: number;
  /** The year's return in the selected terms (price or total, nominal or real), in percent. */
  returnPct: number;
  inflationPct: number;
  contribution: number;
  /** Value at the end of the year, in the selected terms. */
  endValue: number;
}

export interface Sp500HistoryResult {
  years: Sp500HistoryYear[];
  finalValue: number;
  /** The initial amount plus every contribution, in the selected terms. */
  contributed: number;
  gain: number;
  /** Geometric mean of the yearly returns, whatever the contributions. In percent. */
  cagrPct: number;
  best: { year: number; returnPct: number };
  worst: { year: number; returnPct: number };
}

export type Sp500HistoryOutcome =
  | { ok: true; result: Sp500HistoryResult }
  | { ok: false; errors: Partial<Record<Sp500HistoryField, Sp500HistoryError>> };

const MAX_RESULT = 1e18;

function validate(input: Sp500HistoryInput) {
  const errors: Partial<Record<Sp500HistoryField, Sp500HistoryError>> = {};
  const { firstYear, lastYear, maxAmount } = SP500_HISTORY_LIMITS;

  for (const field of ["startYear", "endYear"] as const) {
    const value = input[field];
    if (!Number.isFinite(value)) errors[field] = "required";
    else if (!Number.isInteger(value)) errors[field] = "whole";
    else if (value < firstYear || value > lastYear) errors[field] = "outOfRange";
  }
  if (!errors.startYear && !errors.endYear && input.endYear < input.startYear) {
    errors.endYear = "beforeStart";
  }
  for (const field of ["initial", "annualContribution"] as const) {
    const value = input[field];
    if (!Number.isFinite(value)) errors[field] = "required";
    else if (value < 0) errors[field] = "tooSmall";
    else if (value > maxAmount) errors[field] = "tooLarge";
  }
  if (!errors.initial && !errors.annualContribution && !input.initial && !input.annualContribution) {
    errors.initial = "nothingInvested";
  }
  return errors;
}

export function computeSp500History(
  input: Sp500HistoryInput,
  history: readonly Sp500HistoryRow[] = SP500_HISTORY,
): Sp500HistoryOutcome {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const range = history.filter(([year]) => year >= input.startYear && year <= input.endYear);
  if (range.length !== input.endYear - input.startYear + 1) {
    return { ok: false, errors: { endYear: "outOfRange" } };
  }

  let nominal = 0;
  // Consumer prices at the start of the current year, with the start year's level at 1.
  let priceLevel = 1;
  let contributed = 0;
  let logGrowth = 0;
  const years: Sp500HistoryYear[] = [];

  for (const [year, price, total, inflation] of range) {
    const growth = 1 + (input.reinvestDividends ? total : price) / 100;
    const inflationFactor = 1 + inflation / 100;
    nominal = (nominal + (year === input.startYear ? input.initial : 0) + input.annualContribution) * growth;
    const contribution = year === input.startYear ? input.initial + input.annualContribution : input.annualContribution;
    const levelAtEnd = priceLevel * inflationFactor;
    // In real terms every dollar is deflated by the prices of the day it moved: contributions at
    // the start of the year, the balance at the end of it.
    contributed += input.inflationAdjusted ? contribution / priceLevel : contribution;
    const yearGrowth = input.inflationAdjusted ? growth / inflationFactor : growth;
    logGrowth += Math.log(yearGrowth);
    years.push({
      year,
      returnPct: (yearGrowth - 1) * 100,
      inflationPct: inflation,
      contribution: input.inflationAdjusted ? contribution / priceLevel : contribution,
      endValue: input.inflationAdjusted ? nominal / levelAtEnd : nominal,
    });
    priceLevel = levelAtEnd;
  }

  const finalValue = years[years.length - 1].endValue;
  if (!Number.isFinite(finalValue) || finalValue > MAX_RESULT) {
    return { ok: false, errors: { initial: "tooLarge" } };
  }
  let best = years[0];
  let worst = years[0];
  for (const row of years) {
    if (row.returnPct > best.returnPct) best = row;
    if (row.returnPct < worst.returnPct) worst = row;
  }

  return {
    ok: true,
    result: {
      years,
      finalValue,
      contributed,
      gain: finalValue - contributed,
      cagrPct: (Math.exp(logGrowth / years.length) - 1) * 100,
      best: { year: best.year, returnPct: best.returnPct },
      worst: { year: worst.year, returnPct: worst.returnPct },
    },
  };
}
