/**
 * Portuguese holiday (subsídio de férias) and Christmas (subsídio de Natal) allowance estimate,
 * in integer cents. Educational only. Reuses the payroll engine's 2026 withholding tables.
 *
 * Rules applied:
 * - Christmas allowance: one month's pay, proportional to the time worked in the calendar year
 *   in the year of hiring (Código do Trabalho, art. 263, n.º 1 and 2).
 * - Holiday allowance: covers the minimum duration of holidays (art. 264, n.º 2). In the hiring
 *   year the holiday entitlement is 2 working days per month of the contract, up to 20 (art.
 *   239, n.º 1 and 4); the allowance is scaled by those days over the 22-day reference.
 * - Withholding: each remuneration is withheld on its own with the monthly table (Despacho n.º
 *   233-A/2026, n.º 10). Paid in twelfths, each twelfth is withheld on its own as well.
 * - Employee Social Security 11%.
 */
import {
  EMPLOYEE_SOCIAL_SECURITY_BP,
  PAYROLL_LIMITS,
  WITHHOLDING_TABLE_SETS,
  computeWithholdingCents,
  type HolderStatus,
  type PayrollRegion,
  type WithholdingContext,
} from "./payroll";

export type AllowanceKind = "christmas" | "holiday";
export type AllowancePaymentMode = "lumpSum" | "twelfths";
export type AllowanceField = "grossMonthly" | "dependants" | "startDate";
export type AllowanceFieldError = "required" | "tooSmall" | "tooLarge" | "whole" | "invalidDate" | "afterYear";

/** The tax year the 2026 tables cover. */
export const ALLOWANCE_YEAR = WITHHOLDING_TABLE_SETS.mainland.year;
/** Reference holiday duration the allowance covers: the 22 working days of a full year. */
export const HOLIDAY_REFERENCE_DAYS = 22;
export const HIRING_YEAR_HOLIDAY_DAYS_PER_MONTH = 2;
export const HIRING_YEAR_HOLIDAY_DAYS_CAP = 20;

export interface AllowanceInput {
  kind: AllowanceKind;
  /** Base gross monthly salary in euros. */
  grossMonthly: number;
  region: PayrollRegion;
  status: HolderStatus;
  dependants: number;
  mode: AllowancePaymentMode;
  /** ISO date (YYYY-MM-DD) the job started; empty when employed for the whole year. */
  startDate: string;
}

export const ALLOWANCE_EXAMPLE: AllowanceInput = {
  kind: "christmas", grossMonthly: 1500, region: "mainland", status: "single", dependants: 0,
  mode: "lumpSum", startDate: "",
};

export const HOLIDAY_ALLOWANCE_EXAMPLE: AllowanceInput = { ...ALLOWANCE_EXAMPLE, kind: "holiday" };
/** The hiring-year case the holiday guide works through: 9 complete months, 18 holiday days. */
export const HOLIDAY_HIRING_YEAR_EXAMPLE: AllowanceInput = { ...HOLIDAY_ALLOWANCE_EXAMPLE, startDate: "2026-03-15" };

export interface AllowancePayment {
  grossCents: number;
  withholdingCents: number;
  socialSecurityCents: number;
  netCents: number;
}

export interface AllowanceResult {
  /** The whole allowance for the year. In twelfths, withholding and Social Security are the sum of the twelfths. */
  total: AllowancePayment;
  /** Share of a full-year allowance, in basis points (10000 = full). */
  proportionBp: number;
  /** Complete months of the contract in the year (hiring year only, else 12). */
  monthsWorked: number;
  /** Holiday days earned (holiday allowance only, else null). */
  holidayDays: number | null;
  /** One twelfth paid with each monthly salary; null for a lump sum. */
  twelfth: (AllowancePayment & { payments: number }) | null;
}

const toCents = (euros: number) => Math.round(euros * 100);
const DAY_MS = 86_400_000;

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const same = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return same && year >= 1900 ? date : null;
}

export function validateAllowance(input: AllowanceInput): Partial<Record<AllowanceField, AllowanceFieldError>> {
  const errors: Partial<Record<AllowanceField, AllowanceFieldError>> = {};
  const { grossMonthly, dependants } = input;
  if (Number.isNaN(grossMonthly)) errors.grossMonthly = "required";
  else if (grossMonthly < 0.01) errors.grossMonthly = "tooSmall";
  else if (grossMonthly > PAYROLL_LIMITS.grossMonthly) errors.grossMonthly = "tooLarge";
  if (Number.isNaN(dependants)) errors.dependants = "required";
  else if (dependants < 0) errors.dependants = "tooSmall";
  else if (dependants > PAYROLL_LIMITS.dependants) errors.dependants = "tooLarge";
  else if (!Number.isInteger(dependants)) errors.dependants = "whole";
  if (input.startDate !== "") {
    const start = parseIsoDate(input.startDate);
    if (!start) errors.startDate = "invalidDate";
    else if (start.getUTCFullYear() > ALLOWANCE_YEAR) errors.startDate = "afterYear";
  }
  return errors;
}

/** Calendar-day share of the year worked, and complete months of the contract, for a start date. */
export function workedInYear(startDate: string): { daysWorked: number; daysInYear: number; completeMonths: number; startsInYear: boolean } {
  const daysInYear = (Date.UTC(ALLOWANCE_YEAR + 1, 0, 1) - Date.UTC(ALLOWANCE_YEAR, 0, 1)) / DAY_MS;
  const start = startDate === "" ? null : parseIsoDate(startDate);
  if (!start || start.getUTCFullYear() < ALLOWANCE_YEAR) {
    return { daysWorked: daysInYear, daysInYear, completeMonths: 12, startsInYear: false };
  }
  const daysWorked = (Date.UTC(ALLOWANCE_YEAR + 1, 0, 1) - start.getTime()) / DAY_MS;
  const month = start.getUTCMonth();
  // Complete months from the start date to the end of the year: a start on the 1st counts that month.
  const completeMonths = 12 - month - (start.getUTCDate() === 1 ? 0 : 1);
  return { daysWorked, daysInYear, completeMonths, startsInYear: true };
}

export function computeAllowance(input: AllowanceInput) {
  const errors = validateAllowance(input);
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const context: WithholdingContext = { region: input.region, status: input.status, dependants: input.dependants };
  const monthlyCents = toCents(input.grossMonthly);
  const worked = workedInYear(input.startDate);

  let proportionNumerator: number;
  let proportionDenominator: number;
  let holidayDays: number | null = null;
  if (input.kind === "christmas") {
    proportionNumerator = worked.daysWorked;
    proportionDenominator = worked.daysInYear;
  } else if (worked.startsInYear) {
    holidayDays = Math.min(HIRING_YEAR_HOLIDAY_DAYS_CAP, HIRING_YEAR_HOLIDAY_DAYS_PER_MONTH * worked.completeMonths);
    proportionNumerator = holidayDays;
    proportionDenominator = HOLIDAY_REFERENCE_DAYS;
  } else {
    holidayDays = HOLIDAY_REFERENCE_DAYS;
    proportionNumerator = 1;
    proportionDenominator = 1;
  }
  const grossCents = Math.round((monthlyCents * proportionNumerator) / proportionDenominator);

  const payment = (amountCents: number): AllowancePayment => {
    const withholdingCents = computeWithholdingCents(amountCents, context);
    const socialSecurityCents = Math.round((amountCents * EMPLOYEE_SOCIAL_SECURITY_BP) / 10_000);
    return { grossCents: amountCents, withholdingCents, socialSecurityCents, netCents: amountCents - withholdingCents - socialSecurityCents };
  };

  const proportionBp = Math.round((proportionNumerator / proportionDenominator) * 10_000);
  const base = { proportionBp, monthsWorked: worked.completeMonths, holidayDays };

  if (input.mode === "lumpSum") {
    return { ok: true as const, result: { ...base, total: payment(grossCents), twelfth: null } satisfies AllowanceResult };
  }
  // Spread evenly over the months of the year the person works (12 for a whole year), each
  // twelfth withheld on its own.
  const payments = worked.startsInYear ? 12 - parseIsoDate(input.startDate)!.getUTCMonth() : 12;
  const each = payment(Math.round(grossCents / payments));
  const withholdingCents = each.withholdingCents * payments;
  const socialSecurityCents = each.socialSecurityCents * payments;
  return {
    ok: true as const,
    result: {
      ...base,
      total: { grossCents, withholdingCents, socialSecurityCents, netCents: grossCents - withholdingCents - socialSecurityCents },
      twelfth: { ...each, payments },
    } satisfies AllowanceResult,
  };
}
