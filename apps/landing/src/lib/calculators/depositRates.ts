import { PORTUGAL_CPI } from "./portugalCpi";
import { computeTermDeposit, TERM_DEPOSIT_LIMITS, type TermDepositResult } from "./termDeposit";
import { DEPOSIT_RATES, DEPOSIT_RATES_SOURCE, type DepositRateRow } from "./data/depositRates";

export { DEPOSIT_RATES, DEPOSIT_RATES_SOURCE };

/** IRS withholding on interest paid to residents (taxa liberatória), in percent. */
export const DEPOSIT_TAX_RATE = 28;

export const DEPOSIT_BUCKETS = ["all", "upTo1y", "1to2y", "over2y"] as const;
export type DepositBucket = (typeof DEPOSIT_BUCKETS)[number];
export type DepositArea = "pt" | "ea";

/** Column of each maturity bucket in a data row, Portugal first. */
const COLUMN: Record<DepositArea, Record<DepositBucket, number>> = {
  pt: { all: 1, upTo1y: 2, "1to2y": 3, over2y: 4 },
  ea: { all: 5, upTo1y: 6, "1to2y": 7, over2y: 8 },
};

export const DEPOSIT_BENCHMARK_LIMITS = {
  maxAmount: TERM_DEPOSIT_LIMITS.maxAmount,
  minTermMonths: TERM_DEPOSIT_LIMITS.minTermMonths,
  maxTermMonths: TERM_DEPOSIT_LIMITS.maxTermMonths,
  /** Inflation assumption, in percent a year. */
  minInflation: -10,
  maxInflation: 50,
} as const;

export function rateOf(row: DepositRateRow, area: DepositArea, bucket: DepositBucket): number | null {
  return row[COLUMN[area][bucket]] as number | null;
}

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

/** The real rate after inflation, as an exact ratio rather than a subtraction. In percent. */
export function realRate(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

/** Portuguese consumer price inflation of a calendar year (annual average CPI), in percent. */
export function portugalInflation(year: number): number | null {
  const current = PORTUGAL_CPI[year];
  const previous = PORTUGAL_CPI[year - 1];
  if (!current || !previous) return null;
  return round((current / previous - 1) * 100, 2);
}

export interface LatestRates {
  month: string;
  provisional: boolean;
  /** Rates in percent by bucket; a bucket without new business that month is null. */
  pt: Record<DepositBucket, number | null>;
  ea: Record<DepositBucket, number | null>;
}

export function latestRates(rows: readonly DepositRateRow[] = DEPOSIT_RATES): LatestRates {
  const row = rows[rows.length - 1];
  const pick = (area: DepositArea) =>
    Object.fromEntries(DEPOSIT_BUCKETS.map((bucket) => [bucket, rateOf(row, area, bucket)])) as Record<
      DepositBucket,
      number | null
    >;
  return {
    month: row[0],
    provisional: DEPOSIT_RATES_SOURCE.provisionalMonths.includes(row[0]),
    pt: pick("pt"),
    ea: pick("ea"),
  };
}

export interface YearSummary {
  year: number;
  /** Mean of the twelve monthly averages, in percent. */
  pt: number;
  ea: number;
  inflation: number;
  /** Portuguese average rate after inflation, before tax and after the 28% IRS. */
  realGross: number;
  realNet: number;
}

/**
 * Calendar years with all twelve months of rates and a CPI for the year and the year before.
 * The yearly rate is the plain mean of the monthly averages: it does not weigh months by the
 * amount deposited.
 */
export function yearSummaries(rows: readonly DepositRateRow[] = DEPOSIT_RATES): YearSummary[] {
  const byYear = new Map<number, DepositRateRow[]>();
  for (const row of rows) {
    const year = Number(row[0].slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }
  const summaries: YearSummary[] = [];
  for (const [year, months] of byYear) {
    const inflation = portugalInflation(year);
    if (months.length !== 12 || inflation === null) continue;
    const mean = (area: DepositArea) => months.reduce((sum, row) => sum + (rateOf(row, area, "all") as number), 0) / 12;
    const pt = mean("pt");
    summaries.push({
      year,
      pt: round(pt, 2),
      ea: round(mean("ea"), 2),
      inflation,
      realGross: round(realRate(pt, inflation), 2),
      realNet: round(realRate(pt * (1 - DEPOSIT_TAX_RATE / 100), inflation), 2),
    });
  }
  return summaries.sort((a, b) => a.year - b.year);
}

/** The most recent complete year: the one the page compares inflation with. */
export function latestYearSummary(rows: readonly DepositRateRow[] = DEPOSIT_RATES): YearSummary {
  const summaries = yearSummaries(rows);
  return summaries[summaries.length - 1];
}

/** The maturity bucket a term falls in: up to 12 months, over 12 and up to 24, over 24. */
export function bucketForTerm(termMonths: number): Exclude<DepositBucket, "all"> {
  if (termMonths <= 12) return "upTo1y";
  if (termMonths <= 24) return "1to2y";
  return "over2y";
}

/** What the calculator opens with: the latest complete year's inflation and a one-year deposit. */
export const DEPOSIT_RATES_EXAMPLE = {
  amount: 10_000,
  termMonths: 12,
  inflation: latestYearSummary().inflation,
} as const;

export interface DepositBenchmarkInput {
  /** Euros. NaN asks for a value. */
  amount: number;
  /** Whole months. NaN asks for a value. */
  termMonths: number;
  /** Assumed yearly inflation over the term, in percent. NaN asks for a value. */
  inflation: number;
}

export type DepositBenchmarkField = "amount" | "termMonths" | "inflation";
export type DepositBenchmarkError = "required" | "negative" | "tooLarge" | "notWhole" | "outOfRange";

export interface DepositBenchmarkResult {
  bucket: DepositBucket;
  /** True when the bucket had no new business in the latest month and the all-maturities rate stands in. */
  fellBack: boolean;
  ratePct: number;
  month: string;
  deposit: TermDepositResult;
  /** What the money loses to prices over the term at the assumed inflation, in euros. */
  inflationCost: number;
  /** Net interest minus the inflation cost: the change in purchasing power, in euros. */
  realGain: number;
  /** Net yearly yield after tax, and after inflation too, in percent. */
  netYieldPct: number;
  realNetYieldPct: number;
}

export type DepositBenchmarkOutcome =
  | { ok: true; result: DepositBenchmarkResult }
  | { ok: false; errors: Partial<Record<DepositBenchmarkField, DepositBenchmarkError>> };

/**
 * Interest on an amount held to maturity at the latest average new-deposit rate for the term's
 * maturity bucket, with the 28% IRS withheld, set against an assumed inflation. The deposit
 * itself is worked by `computeTermDeposit` (simple interest paid at maturity, whole cents).
 */
export function computeDepositBenchmark(
  input: DepositBenchmarkInput,
  rows: readonly DepositRateRow[] = DEPOSIT_RATES,
): DepositBenchmarkOutcome {
  const errors: Partial<Record<DepositBenchmarkField, DepositBenchmarkError>> = {};
  const { minInflation, maxInflation } = DEPOSIT_BENCHMARK_LIMITS;
  if (Number.isNaN(input.inflation)) errors.inflation = "required";
  else if (input.inflation < minInflation || input.inflation > maxInflation) errors.inflation = "outOfRange";

  const latest = rows[rows.length - 1];
  const wanted = bucketForTerm(input.termMonths);
  const bucketRate = rateOf(latest, "pt", wanted);
  const bucket: DepositBucket = bucketRate === null ? "all" : wanted;
  const ratePct = (bucketRate ?? rateOf(latest, "pt", "all")) as number;

  const deposit = computeTermDeposit({
    amount: input.amount,
    annualRate: ratePct,
    termMonths: input.termMonths,
    payout: "maturity",
    reinvest: false,
    taxRate: DEPOSIT_TAX_RATE,
  });
  if (!deposit.ok) {
    for (const field of ["amount", "termMonths"] as const) {
      const error = deposit.errors[field];
      if (error) errors[field] = error;
    }
  }
  if (!deposit.ok || Object.keys(errors).length > 0) return { ok: false, errors };

  const { result } = deposit;
  const cents = Math.round(input.amount * 100);
  const inflationCost = Math.round(cents * (Math.pow(1 + input.inflation / 100, input.termMonths / 12) - 1)) / 100;
  const netYieldPct = result.effectiveAnnualNetYield;
  return {
    ok: true,
    result: {
      bucket,
      fellBack: bucket !== wanted,
      ratePct,
      month: latest[0],
      deposit: result,
      inflationCost,
      realGain: Math.round((result.netInterest - inflationCost) * 100) / 100,
      netYieldPct,
      realNetYieldPct: realRate(netYieldPct, input.inflation),
    },
  };
}

/** The first day of a "YYYY-MM" month, in UTC, for formatting. */
export function monthToDate(month: string): Date {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1));
}
