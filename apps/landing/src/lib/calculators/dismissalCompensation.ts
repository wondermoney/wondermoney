import { REFERENCE_DATE, RMMG_2026_CENTS } from "./unemploymentBenefit";

/**
 * Compensation for a collective dismissal, the extinction of a post or the unsuitability of the worker, on a permanent
 * contract (Código do Trabalho, art. 366, as amended by Lei n.º 69/2013, and its transitional regime, art. 5), or for the
 * expiry of a fixed-term contract at the employer's initiative (arts. 344(2) and 345(4), as amended by Lei n.º 13/2023),
 * with a warning when its dates pass the art. 148 maximum duration (earlier contracts for the same job included, art. 148(6))
 * or its renewals break art. 149(4).
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

/**
 * Renewals of a certain-term contract: at most three. From 1 October 2019, art. 149(4) CT (Lei n.º 93/2019): "O contrato
 * de trabalho a termo certo pode ser renovado até três vezes e a duração total das renovações não pode exceder a do
 * período inicial daquele." Before, the initial wording of art. 148(1): "pode ser renovado até três vezes", with no limit
 * on how long the renewals last (the initial art. 149 had none), and art. 11(4) of Lei n.º 93/2019 keeps that renewal
 * regime for contracts signed before 1 October 2019. A renewal in breach of art. 149 converts the contract into an
 * open-ended one (art. 147(2)(a)), as does exceeding the number of renewals (art. 147(2)(b)). Uncertain-term contracts are
 * not renewed. Checked on diariodarepublica.pt (arts. 147, 148 and 149 with their version history) on 2026-11-20.
 */
export const MAX_RENEWALS = 3;

/**
 * Art. 148(6) CT counts towards the limit of art. 148(1), the 2 years of a certain term, "a duração de contratos de trabalho
 * a termo ou de trabalho temporário cuja execução se concretiza no mesmo posto de trabalho, bem como de contrato de
 * prestação de serviço para o mesmo objeto, entre o trabalhador e o mesmo empregador ou sociedades que com este se
 * encontrem em relação de domínio ou de grupo ou mantenham estruturas organizativas comuns". The initial wording, art.
 * 148(5), had the same rule for the 3-year limit of art. 148(1)(c). Neither applies to the uncertain-term limit.
 */
export const EARLIER_CONTRACTS_KINDS: readonly FixedTermKind[] = ["certain"];

export const DISMISSAL_LIMITS = { monthly: 1_000_000, renewals: 20, months: 600 } as const;

export type ContractType = "permanent" | "fixedTerm";
/** `certain`: termo certo, an agreed end date (art. 344); `uncertain`: termo incerto, ends with its reason (art. 345). */
export type FixedTermKind = "certain" | "uncertain";
export type DismissalField =
  | "baseMonthly" | "seniorityPay" | "startDate" | "endDate" | "renewals" | "initialMonths" | "earlierMonths";
export type DismissalError =
  | "required" | "tooSmall" | "tooLarge" | "invalidDate" | "endBeforeStart" | "startFuture" | "endOutsideYear" | "wholeNumber";

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
  /**
   * The three inputs below are optional and only read for a certain-term expiry; empty (NaN or absent) means not given.
   * They feed the duration warning only, never the amount.
   * Number of renewals (art. 149(4)); 0 or empty when it was never renewed.
   */
  renewals?: number;
  /** Length of the first period, before any renewal, in whole months; read when renewed and signed from 1 October 2019. */
  initialMonths?: number;
  /** Months of earlier fixed-term or temporary contracts for the same job with the same employer (art. 148(6)). */
  earlierMonths?: number;
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
  /** For a certain-term expiry, the renewal rules and whether they were broken; `null` otherwise. */
  renewalLimit: FixedTermRenewalCheck | null;
}

export interface FixedTermDurationCheck {
  kind: FixedTermKind;
  /** Which wording of art. 148 applies, by the start date (art. 11(4) of Lei n.º 93/2019). */
  rules: keyof typeof FIXED_TERM_MAX_YEARS;
  maxYears: number;
  /** Months of earlier contracts for the same job taken off the limit (art. 148(6)); always 0 for an uncertain term. */
  earlierMonths: number;
  /** The last day the contract may run, as `YYYY-MM-DD`. */
  lastDay: string;
  /** The end date is after `lastDay`, so the contract would likely be open-ended under art. 147(2)(b). */
  exceeded: boolean;
}

export interface FixedTermRenewalCheck {
  /** Which renewal rules apply, by the start date (art. 11(4) of Lei n.º 93/2019). */
  rules: keyof typeof FIXED_TERM_MAX_YEARS;
  renewals: number;
  /** More than three renewals (art. 149(4), or the initial art. 148(1) before 1 October 2019). */
  tooMany: boolean;
  /** The first period in months when it applies (renewed, from 1 October 2019, given); otherwise `null`. */
  initialMonths: number | null;
  /** The last day the renewals may reach, the end of twice the first period, as `YYYY-MM-DD`; `null` with no first period. */
  renewalsLastDay: string | null;
  /** The renewals together last longer than the first period (art. 149(4), from 1 October 2019 only). */
  tooLong: boolean;
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
 * The first day after a period of `months` months that starts on `start`: the same day of the month, `months` later. When
 * that month has no such day (a start on the 31st, or 29 February), the period ends with the month's last day, so this is
 * the first of the next month.
 */
function afterMonths(start: number, months: number): number {
  const date = new Date(start);
  const [year, month] = [date.getUTCFullYear(), date.getUTCMonth()];
  return Math.min(Date.UTC(year, month + months, date.getUTCDate()), Date.UTC(year, month + months + 1, 1));
}

/** A count the visitor left empty (or omitted) is not given; `undefined` and NaN both read as 0. */
const given = (value: number | undefined) => value !== undefined && !Number.isNaN(value);
const rulesFor = (start: number): keyof typeof FIXED_TERM_MAX_YEARS =>
  start < parseDate(LEI_93_2019_IN_FORCE)! ? "before2019" : "from2019";

/**
 * The art. 148 limit for a fixed-term contract running from `startDate` to `endDate` (both days worked). The start date
 * stands for the signing date of art. 11(4) of Lei n.º 93/2019. A start on 29 February keeps all of 28 February in a year
 * without one. For a certain term, `earlierMonths` of earlier contracts for the same job shorten the limit by as much
 * (art. 148(6), initially art. 148(5)); an uncertain term ignores them. Returns `null` when a date is invalid.
 */
export function checkFixedTermDuration(
  kind: FixedTermKind, startDate: string, endDate: string, earlierMonths = 0,
): FixedTermDurationCheck | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start === null || end === null) return null;
  const rules = rulesFor(start);
  const maxYears = FIXED_TERM_MAX_YEARS[rules][kind];
  const earlier = EARLIER_CONTRACTS_KINDS.includes(kind) && given(earlierMonths) && earlierMonths > 0 ? earlierMonths : 0;
  const limitExclusive = afterMonths(start, maxYears * 12 - earlier);
  return { kind, rules, maxYears, earlierMonths: earlier, lastDay: isoDate(limitExclusive - DAY_MS), exceeded: end >= limitExclusive };
}

/**
 * The renewal rules for a certain-term contract running from `startDate` to `endDate` that was renewed `renewals` times,
 * with a first period of `initialMonths` months. A renewed contract is one contract (art. 149(5)), so the renewals last
 * from the end of the first period to `endDate`, and they last longer than the first period when the contract runs past
 * twice the first period. Returns `null` when a date is invalid.
 */
export function checkFixedTermRenewals(
  startDate: string, endDate: string, renewals = 0, initialMonths = Number.NaN,
): FixedTermRenewalCheck | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start === null || end === null) return null;
  const rules = rulesFor(start);
  const count = given(renewals) ? renewals : 0;
  const lengthApplies = rules === "from2019" && count > 0 && given(initialMonths) && initialMonths > 0;
  const renewalsEnd = lengthApplies ? afterMonths(start, 2 * initialMonths) : null;
  return {
    rules,
    renewals: count,
    tooMany: count > MAX_RENEWALS,
    initialMonths: lengthApplies ? initialMonths : null,
    renewalsLastDay: renewalsEnd === null ? null : isoDate(renewalsEnd - DAY_MS),
    tooLong: renewalsEnd !== null && end >= renewalsEnd,
  };
}

/** Which of the optional renewal and earlier-contract fields the visitor sees, and so which are read and validated. */
export function fixedTermFields(input: Pick<DismissalCompensationInput, "contractType" | "fixedTermKind" | "startDate" | "renewals">) {
  const certain = input.contractType === "fixedTerm" && input.fixedTermKind === "certain";
  const start = parseDate(input.startDate);
  const renewed = given(input.renewals) && input.renewals! > 0;
  return {
    renewals: certain,
    earlierMonths: certain,
    // Before 1 October 2019 the renewals had no length limit, so the first period does not matter (art. 11(4) of Lei 93/2019).
    initialMonths: certain && renewed && (start === null || rulesFor(start) === "from2019"),
  };
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

  // The optional counts: empty is fine, otherwise a whole number in range. Hidden fields are not checked.
  const shown = fixedTermFields(input);
  const count = (field: "renewals" | "initialMonths" | "earlierMonths", min: number, max: number) => {
    const value = input[field];
    if (!shown[field] || !given(value)) return;
    if (!Number.isInteger(value) || value! < min || value! > max) errors[field] = "wholeNumber";
  };
  count("renewals", 0, DISMISSAL_LIMITS.renewals);
  count("initialMonths", 1, DISMISSAL_LIMITS.months);
  count("earlierMonths", 0, DISMISSAL_LIMITS.months);
  return errors;
}

/** The bounds `validateDismissal` uses for each optional count, for the error message. */
export const COUNT_BOUNDS = {
  renewals: { min: 0, max: DISMISSAL_LIMITS.renewals },
  initialMonths: { min: 1, max: DISMISSAL_LIMITS.months },
  earlierMonths: { min: 0, max: DISMISSAL_LIMITS.months },
} as const;

export function computeDismissalCompensation(input: DismissalCompensationInput, today: string = REFERENCE_DATE) {
  const errors = validateDismissal(input, today);
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const start = parseDate(input.startDate)!;
  const shown = fixedTermFields(input);
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
      durationLimit: fixedTerm
        ? checkFixedTermDuration(input.fixedTermKind, input.startDate, input.endDate, shown.earlierMonths ? input.earlierMonths : 0)
        : null,
      renewalLimit: shown.renewals
        ? checkFixedTermRenewals(input.startDate, input.endDate, input.renewals, shown.initialMonths ? input.initialMonths : Number.NaN)
        : null,
    } satisfies DismissalCompensationResult,
  };
}

/** Splits the amount over a number of upcoming months, in cents; the first months take any rounding remainder. */
export function splitPayout(totalCents: number, months: number): number[] {
  const base = Math.floor(totalCents / months);
  const extra = totalCents - base * months;
  return Array.from({ length: months }, (_, index) => base + (index < extra ? 1 : 0));
}
