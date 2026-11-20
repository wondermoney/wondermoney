import { REFERENCE_DATE, RMMG_2026_CENTS } from "./unemploymentBenefit";

/**
 * Compensation for a collective dismissal, the extinction of a post or the unsuitability of the worker, on a permanent
 * contract (Código do Trabalho, art. 366, as amended by Lei n.º 69/2013, and its transitional regime, art. 5), or for the
 * expiry of a fixed-term contract at the employer's initiative (arts. 344(2) and 345(4), as amended by Lei n.º 13/2023),
 * with a warning when its dates pass the art. 148 maximum duration.
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
/** Lei n.º 13/2023: 14 days a year for seniority from this date. */
export const MAY_2023 = "2023-05-01";

/** The only year whose minimum wage (RMMG) the caps use. */
export const SUPPORTED_END_YEAR = 2026;

/**
 * Fixed-term expiry: 24 days of base pay and diuturnidades per full year of seniority (arts. 344(2) and 345(4) CT, Lei
 * n.º 13/2023), "calculada nos termos do artigo 366.º": same daily value, caps and proportional fraction. Art. 35(1) of
 * Lei n.º 13/2023 submits contracts signed before 1 May 2023 to the new text when they expire from that date on (IGeFE
 * nota informativa 10/2023), so the rate depends on the expiry date, not the contract date; art. 35(2) restricts only
 * the 14 days of art. 366(1) to seniority from 1 May 2023, not arts. 344 and 345. Every expiry this calculator accepts
 * is in 2026, so the earlier 18 days a year (expiry up to 30 April 2023) is never used, and a fixed-term contract lasts
 * at most 2 years, or 4 with an uncertain term (art. 148(1) and (5) CT), so none signed before 1 October 2013 (art. 6
 * of Lei n.º 69/2013) can lawfully expire in 2026. Dates past those limits get a warning (see `checkFixedTermDuration`)
 * but the same 24-day figure. Texts checked on diariodarepublica.pt on 2026-11-20.
 */
export const FIXED_TERM_DAYS_PER_YEAR = 24;

/**
 * Lei n.º 93/2019 came into force on the first working day of the month after its publication on 4 September 2019 (art.
 * 13(1)): 1 October 2019. Its art. 11(4) keeps the earlier rules on the admissibility, renewal and duration of fixed-term
 * contracts signed before that day.
 */
export const LEI_93_2019_IN_FORCE = "2019-10-01";

/**
 * Maximum duration of a fixed-term contract, renewals included (art. 149(5): a renewed contract is one contract), in years.
 * From 1 October 2019, art. 148(1) and (5) CT as amended by Lei n.º 93/2019 (unchanged by Lei n.º 13/2023): 2 years with a
 * certain term (art. 148(4) only shortens it, for a new activity), 4 with an uncertain term. Before, the initial wording of
 * art. 148(1) and (4): 18 months for a first job seeker, 2 years in the other cases of art. 140(4) and 3 years otherwise,
 * so the longest, 3 years, is the one that rules out every case; 6 years with an uncertain term. Exceeding it converts the
 * contract into an open-ended one (art. 147(2)(b)). Checked on diariodarepublica.pt (art. 148 with its version history) on
 * 2026-11-20.
 */
export const FIXED_TERM_MAX_YEARS = {
  from2019: { certain: 2, uncertain: 4 },
  before2019: { certain: 3, uncertain: 6 },
} as const;

export const DISMISSAL_LIMITS = { monthly: 1_000_000 } as const;

export type ContractType = "permanent" | "fixedTerm";
/** `certain`: termo certo, an agreed end date (art. 344); `uncertain`: termo incerto, ends with its reason (art. 345). */
export type FixedTermKind = "certain" | "uncertain";
export type DismissalField = "baseMonthly" | "seniorityPay" | "startDate" | "endDate";
export type DismissalError =
  | "required" | "tooSmall" | "tooLarge" | "invalidDate" | "endBeforeStart" | "startFuture" | "endOutsideYear";

export interface DismissalCompensationInput {
  /** `permanent`: dismissal under art. 366 or 367 to 379; `fixedTerm`: expiry of a fixed-term contract, arts. 344 and 345. */
  contractType: ContractType;
  /** The kind of term of a fixed-term contract. It selects the duration limit only: both pay 24 days a year. */
  fixedTermKind: FixedTermKind;
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
  contractType: "permanent", fixedTermKind: "certain", baseMonthly: 1500, seniorityPay: 50, startDate: "2012-03-01", endDate: "2026-12-31",
};

export type PeriodKey = "oneMonth" | "twentyDays" | "eighteenDays" | "twelveDays" | "fourteenDays" | "twentyFourDays";
/** The rule behind each line of the breakdown: days of pay per year of seniority. */
const DAYS_PER_YEAR: Record<PeriodKey, number> = { oneMonth: 30, twentyDays: 20, eighteenDays: 18, twelveDays: 12, fourteenDays: 14, twentyFourDays: FIXED_TERM_DAYS_PER_YEAR };

export interface PeriodLine {
  key: PeriodKey;
  daysPerYear: number;
  /** Seniority inside the period, as a fraction of years. */
  years: number;
  amountCents: number;
}

export interface DismissalCompensationResult {
  /** `before2011`, `from2011` (1 Nov 2011 to 30 Sep 2013) or `from2013`, by the contract start date; `fixedTerm` for an expiry. */
  regime: "before2011" | "from2011" | "from2013" | "fixedTerm";
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
  /** For a fixed-term expiry, the legal maximum duration and whether the dates pass it; `null` for a dismissal. */
  durationLimit: FixedTermDurationCheck | null;
}

export interface FixedTermDurationCheck {
  kind: FixedTermKind;
  /** Which wording of art. 148 applies, by the start date (art. 11(4) of Lei n.º 93/2019). */
  rules: keyof typeof FIXED_TERM_MAX_YEARS;
  maxYears: number;
  /** The last day the contract may run, as `YYYY-MM-DD`. */
  lastDay: string;
  /** The end date is after `lastDay`, so the contract would likely be open-ended under art. 147(2)(b). */
  exceeded: boolean;
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

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The art. 148 limit for a fixed-term contract running from `startDate` to `endDate` (both days worked). The start date
 * stands for the signing date of art. 11(4) of Lei n.º 93/2019. A start on 29 February keeps all of 28 February in a year
 * without one. Returns `null` when a date is invalid.
 */
export function checkFixedTermDuration(kind: FixedTermKind, startDate: string, endDate: string): FixedTermDurationCheck | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start === null || end === null) return null;
  const rules = start < parseDate(LEI_93_2019_IN_FORCE)! ? "before2019" : "from2019";
  const maxYears = FIXED_TERM_MAX_YEARS[rules][kind];
  const date = new Date(start);
  // Date.UTC rolls 29 February over to 1 March, the day after the last one allowed.
  const limitExclusive = Date.UTC(date.getUTCFullYear() + maxYears, date.getUTCMonth(), date.getUTCDate());
  return { kind, rules, maxYears, lastDay: isoDate(limitExclusive - DAY_MS), exceeded: end >= limitExclusive };
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
  const fixedTerm = input.contractType === "fixedTerm";
  const regime: DismissalCompensationResult["regime"] = fixedTerm
    ? "fixedTerm"
    : start < parseDate(NOV_2011)! ? "before2011" : start < parseDate(OCT_2013)! ? "from2011" : "from2013";

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
  if (fixedTerm) {
    push("twentyFourDays", seniority(start, endExclusive));
  } else if (regime === "before2011") {
    push("oneMonth", yearsBetween(input.startDate, NOV_2012));
    push("twentyDays", yearsBetween(NOV_2012, OCT_2013));
  } else if (regime === "from2011") {
    push("twentyDays", yearsBetween(input.startDate, OCT_2013));
  }
  const earlyCents = fixedTerm ? 0 : lines.reduce((sum, line) => sum + line.amountCents, 0);
  // From 1 Oct 2013 to 30 Apr 2023 every year counts 12 days, except that the first three years of seniority count 18 days
  // when the contract was less than three years old on 1 Oct 2013 (seniority below 3 then). Seniority from 1 May 2023
  // counts 14 days (Lei n.º 13/2023); earlier time keeps its rate.
  const from = regime === "from2013" ? input.startDate : OCT_2013;
  const middle = yearsBetween(from, MAY_2023);
  const seniorityAtOct2013 = regime === "from2013" ? 0 : seniority(start, at(OCT_2013));
  const seniorityAtMay2023 = seniority(start, at(MAY_2023));
  const seniorityAtEnd = seniority(start, endExclusive);
  const first3 = regime === "from2013" ? 0 : Math.max(0, Math.min(seniorityAtMay2023, 3) - Math.min(seniorityAtOct2013, 3));
  if (!fixedTerm) {
    push("eighteenDays", first3);
    push("twelveDays", middle - first3);
    push("fourteenDays", yearsBetween(MAY_2023, farFuture));
  }

  const uncappedCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const capCents = TOTAL_CAP_MONTHS * usedMonthlyCents;
  // Art. 5(5)-(6) of Lei 69/2013: when the part up to 30 Sep 2013 alone reaches the cap, nothing is added after it.
  const earlyPartExceedsCap = !fixedTerm && regime !== "from2013" && earlyCents >= capCents;
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
      durationLimit: fixedTerm ? checkFixedTermDuration(input.fixedTermKind, input.startDate, input.endDate) : null,
    } satisfies DismissalCompensationResult,
  };
}

/** Splits the amount over a number of upcoming months, in cents; the first months take any rounding remainder. */
export function splitPayout(totalCents: number, months: number): number[] {
  const base = Math.floor(totalCents / months);
  const extra = totalCents - base * months;
  return Array.from({ length: months }, (_, index) => base + (index < extra ? 1 : 0));
}
