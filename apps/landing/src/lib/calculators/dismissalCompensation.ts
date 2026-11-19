import { REFERENCE_DATE, RMMG_2026_CENTS } from "./unemploymentBenefit";

/**
 * Compensation for a collective dismissal, the extinction of a post or the unsuitability of the worker, on a permanent
 * contract (Código do Trabalho, art. 366, as amended by Lei n.º 69/2013, and its transitional regime, art. 5).
 * Amounts in cents, dates as ISO `YYYY-MM-DD` strings.
 */
export { REFERENCE_DATE, RMMG_2026_CENTS };

/** The monthly base used cannot exceed 20 times the minimum wage (art. 366 CT and art. 5(4) of Lei 69/2013). */
export const BASE_CAP_RMMG_MULTIPLE = 20;
/** The whole compensation is capped at 12 monthly bases (or 240 minimum wages). */
export const TOTAL_CAP_MONTHS = 12;

/** First day each rule applies. */
export const OCT_2013 = "2013-10-01";
export const NOV_2011 = "2011-11-01";
const NOV_2012 = "2012-11-01";

/** The only year whose minimum wage (RMMG) the caps use. */
export const SUPPORTED_END_YEAR = 2026;

export const DISMISSAL_LIMITS = { monthly: 1_000_000 } as const;

export type DismissalField = "baseMonthly" | "seniorityPay" | "startDate" | "endDate";
export type DismissalError =
  | "required" | "tooSmall" | "tooLarge" | "invalidDate" | "endBeforeStart" | "startFuture" | "endOutsideYear";

export interface DismissalCompensationInput {
  /** Monthly base pay (retribuição base) in euros. */
  baseMonthly: number;
  /** Monthly seniority supplements (diuturnidades) in euros; 0 when there are none. */
  seniorityPay: number;
  /** Contract start date. */
  startDate: string;
  /** Termination date, the last day of the contract. */
  endDate: string;
}

export const DISMISSAL_EXAMPLE: DismissalCompensationInput = {
  baseMonthly: 1500, seniorityPay: 50, startDate: "2012-03-01", endDate: "2026-12-31",
};

export type PeriodKey = "oneMonth" | "twentyDays" | "eighteenDays" | "twelveDays";
/** The rule behind each line of the breakdown: days of pay per year of seniority. */
const DAYS_PER_YEAR: Record<PeriodKey, number> = { oneMonth: 30, twentyDays: 20, eighteenDays: 18, twelveDays: 12 };

export interface PeriodLine {
  key: PeriodKey;
  daysPerYear: number;
  /** Seniority inside the period, as a fraction of years. */
  years: number;
  amountCents: number;
}

export interface DismissalCompensationResult {
  /** `before2011`, `from2011` (1 Nov 2011 to 30 Sep 2013) or `from2013`, by the contract start date. */
  regime: "before2011" | "from2011" | "from2013";
  seniorityYears: number;
  /** Base plus supplements the calculation used, after the 20 x minimum wage cap, in cents. */
  usedMonthlyCents: number;
  dailyCents: number;
  lines: PeriodLine[];
  /** Total of the lines before the 12-month cap, in cents. */
  uncappedCents: number;
  capCents: number;
  compensationCents: number;
  caps: { monthlyBase: boolean; total: boolean; earlyPartExceedsCap: boolean };
}

const DAY_MS = 86_400_000;

function parseDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (year < 1900 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return ms;
}

function addYears(ms: number, years: number): number {
  const date = new Date(ms);
  const month = date.getUTCMonth();
  const target = Date.UTC(date.getUTCFullYear() + years, month, date.getUTCDate());
  // 29 February in a year without one falls on 28 February.
  return new Date(target).getUTCMonth() === month ? target : Date.UTC(date.getUTCFullYear() + years, month, 28);
}

/** Seniority from `start` to `at` (exclusive), in years: whole anniversaries plus the days since the last one over the year. */
function seniority(start: number, at: number): number {
  if (at <= start) return 0;
  let whole = Math.floor((at - start) / (366 * DAY_MS));
  while (addYears(start, whole + 1) <= at) whole += 1;
  while (whole > 0 && addYears(start, whole) > at) whole -= 1;
  const from = addYears(start, whole);
  return whole + (at - from) / (addYears(start, whole + 1) - from);
}

export function validateDismissal(
  input: DismissalCompensationInput, today: string = REFERENCE_DATE,
): Partial<Record<DismissalField, DismissalError>> {
  const errors: Partial<Record<DismissalField, DismissalError>> = {};
  const money = (field: "baseMonthly" | "seniorityPay", min: number) => {
    const value = input[field];
    if (Number.isNaN(value)) errors[field] = "required";
    else if (value < min) errors[field] = "tooSmall";
    else if (value > DISMISSAL_LIMITS.monthly) errors[field] = "tooLarge";
  };
  money("baseMonthly", 0.01);
  money("seniorityPay", 0);

  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  const now = parseDate(today);
  if (input.startDate === "") errors.startDate = "required";
  else if (start === null) errors.startDate = "invalidDate";
  else if (now !== null && start > now) errors.startDate = "startFuture";
  if (input.endDate === "") errors.endDate = "required";
  else if (end === null) errors.endDate = "invalidDate";
  else if (start !== null && end < start && !errors.startDate) errors.endDate = "endBeforeStart";
  else if (new Date(end).getUTCFullYear() !== SUPPORTED_END_YEAR) errors.endDate = "endOutsideYear";
  return errors;
}

export function computeDismissalCompensation(input: DismissalCompensationInput, today: string = REFERENCE_DATE) {
  const errors = validateDismissal(input, today);
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const start = parseDate(input.startDate)!;
  const endExclusive = parseDate(input.endDate)! + DAY_MS; // the end date counts as a day worked
  const regime: DismissalCompensationResult["regime"] =
    start < parseDate(NOV_2011)! ? "before2011" : start < parseDate(OCT_2013)! ? "from2011" : "from2013";

  const baseCents = Math.round((input.baseMonthly + input.seniorityPay) * 100);
  const baseCapCents = BASE_CAP_RMMG_MULTIPLE * RMMG_2026_CENTS;
  const usedMonthlyCents = Math.min(baseCents, baseCapCents);
  const dailyCents = usedMonthlyCents / 30;

  const at = (date: string) => Math.min(Math.max(parseDate(date)!, start), endExclusive);
  const yearsBetween = (from: string, to: string) => seniority(start, at(to)) - seniority(start, at(from));

  const lines: PeriodLine[] = [];
  const push = (key: PeriodKey, years: number) => {
    if (years <= 0) return;
    lines.push({ key, daysPerYear: DAYS_PER_YEAR[key], years, amountCents: Math.round(years * DAYS_PER_YEAR[key] * dailyCents) });
  };
  const farFuture = "9999-12-31";
  if (regime === "before2011") {
    push("oneMonth", yearsBetween(input.startDate, NOV_2012));
    push("twentyDays", yearsBetween(NOV_2012, OCT_2013));
  } else if (regime === "from2011") {
    push("twentyDays", yearsBetween(input.startDate, OCT_2013));
  }
  const earlyCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  // From 1 Oct 2013 the first three years of seniority count 18 days, but only for contracts younger than three years on
  // that date (seniority below 3 then); every other year counts 12 days.
  const after2013 = yearsBetween(regime === "from2013" ? input.startDate : OCT_2013, farFuture);
  const seniorityAtOct2013 = regime === "from2013" ? 0 : seniority(start, at(OCT_2013));
  const seniorityAtEnd = seniority(start, endExclusive);
  const first3 = regime === "from2013" ? 0 : Math.max(0, Math.min(seniorityAtEnd, 3) - Math.min(seniorityAtOct2013, 3));
  push("eighteenDays", first3);
  push("twelveDays", after2013 - first3);

  const uncappedCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const capCents = TOTAL_CAP_MONTHS * usedMonthlyCents;
  // Art. 5(5)-(6) of Lei 69/2013: when the part up to 30 Sep 2013 alone reaches the cap, nothing is added after it.
  const earlyPartExceedsCap = regime !== "from2013" && earlyCents >= capCents;
  // The 3-month minimum for contracts before 1 Nov 2011 (art. 5(2)) cannot bind: the end date is in 2026, so such a
  // contract has at least 14 years of seniority.
  const compensationCents = earlyPartExceedsCap ? earlyCents : Math.min(uncappedCents, capCents);
  const total = !earlyPartExceedsCap && uncappedCents > capCents;

  return {
    ok: true as const,
    result: {
      regime, seniorityYears: seniorityAtEnd, usedMonthlyCents, dailyCents: Math.round(dailyCents), lines, uncappedCents,
      capCents, compensationCents,
      caps: { monthlyBase: baseCents > baseCapCents, total, earlyPartExceedsCap },
    } satisfies DismissalCompensationResult,
  };
}

/** Splits the amount over a number of upcoming months, in cents; the first months take any rounding remainder. */
export function splitPayout(totalCents: number, months: number): number[] {
  const base = Math.floor(totalCents / months);
  const extra = totalCents - base * months;
  return Array.from({ length: months }, (_, index) => base + (index < extra ? 1 : 0));
}
