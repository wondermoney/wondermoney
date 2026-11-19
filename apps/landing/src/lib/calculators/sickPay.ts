import {
  EMPLOYEE_SOCIAL_SECURITY_BP,
  computeNetSalary,
  computeWithholdingCents,
  type AllowanceSchedule,
} from "./payroll";
import { RMMG_2026_CENTS } from "./unemploymentBenefit";

export { REFERENCE_DATE, RMMG_2026_CENTS } from "./unemploymentBenefit";

/**
 * Subsídio de doença for employees (DL 28/2004 as amended), 2026 values from the Segurança Social
 * Guia Prático Subsídio de Doença (ISS 5001, v4.55, 23 October 2026). Educational estimate.
 */

/** Daily floor: 30% of the minimum wage (920 EUR), i.e. 9.20 EUR a day. */
export const MIN_DAILY_CENTS = Math.round((RMMG_2026_CENTS * 30) / 100 / 30);
export const WAITING_DAYS = 3;
export const MAX_SICK_DAYS = 1095;
/**
 * +5 points on the 55% and 60% bands (art. 17 DL 28/2004): when the reference pay is at or below this monthly
 * value, OR the household has 3 or more descendants (the conditions are alternatives, not cumulative). The
 * law says the 500 euro figure is revised periodically with the minimum wage; the current value could not
 * be confirmed in an official text, so 500 is kept.
 */
export const INCREASE_POINTS = 5;
export const INCREASE_MAX_REFERENCE_MONTHLY_CENTS = 50_000;
export const INCREASE_MIN_DESCENDANTS = 3;

export interface SickBand { fromDay: number; toDay: number; percent: number }
export const SICK_BANDS: readonly SickBand[] = [
  { fromDay: 1, toDay: 30, percent: 55 },
  { fromDay: 31, toDay: 90, percent: 60 },
  { fromDay: 91, toDay: 365, percent: 70 },
  { fromDay: 366, toDay: MAX_SICK_DAYS, percent: 75 },
];

export const SICK_PAY_LIMITS = { grossMonthly: 100_000, sickDays: MAX_SICK_DAYS, dependants: 10 } as const;
export type SickPayField = "grossMonthly" | "sickDays" | "dependants";
type FieldError = "required" | "tooSmall" | "tooLarge" | "whole";

export interface SickPayInput {
  /** Gross monthly salary in euros. */
  grossMonthly: number;
  /** `twelfths`: the salary already includes the holiday and Christmas allowances. */
  allowances: AllowanceSchedule;
  /** Days of sick leave on the certificate, counted from the first day. */
  sickDays: number;
  /** Hospital stay or outpatient surgery: paid from day 1, no waiting period. */
  hospitalisation: boolean;
  /** Descendants up to 16 (or 24 with family allowance) in the household. */
  dependants: number;
}

export const SICK_PAY_EXAMPLE: SickPayInput = {
  grossMonthly: 1500, allowances: "fourteen", sickDays: 45, hospitalisation: false, dependants: 0,
};

export function validateSickPay(input: SickPayInput): Partial<Record<SickPayField, FieldError>> {
  const errors: Partial<Record<SickPayField, FieldError>> = {};
  const check = (field: SickPayField, value: number, min: number, max: number, whole = false) => {
    if (Number.isNaN(value)) errors[field] = "required";
    else if (value < min) errors[field] = "tooSmall";
    else if (value > max) errors[field] = "tooLarge";
    else if (whole && !Number.isInteger(value)) errors[field] = "whole";
  };
  check("grossMonthly", input.grossMonthly, 0.01, SICK_PAY_LIMITS.grossMonthly);
  check("sickDays", input.sickDays, 1, SICK_PAY_LIMITS.sickDays, true);
  check("dependants", input.dependants, 0, SICK_PAY_LIMITS.dependants, true);
  return errors;
}

export interface SickBandResult {
  fromDay: number;
  toDay: number;
  percent: number;
  /** Days of the leave that fall in this band. */
  days: number;
  waitingDays: number;
  paidDays: number;
  dailyCents: number;
  amountCents: number;
}

export interface SickPayResult {
  /** Reference remuneration per day (6 oldest of the last 8 months, without allowances, / 180). */
  referenceDailyCents: number;
  bands: SickBandResult[];
  waitingDays: number;
  paidDays: number;
  totalCents: number;
  /** Net pay lost on the waiting days: not paid by Segurança Social. */
  waitingNetPayCents: number;
  increaseApplied: boolean;
  /** True when the minimum of 9.20 a day was applied (or the reference pay is lower and is paid in full). */
  limit: "none" | "minimum" | "referencePay" | "netCap";
  netMonthlyCents: number;
  /** Net pay of a 30-day month minus what the first 30 days pay. */
  firstMonthGapCents: number;
  /** Average monthly shortfall over the whole leave, against normal net pay. */
  averageMonthlyGapCents: number;
}

const toCents = (euros: number) => Math.round(euros * 100);

export function computeSickPay(input: SickPayInput) {
  const errors = validateSickPay(input);
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const grossCents = toCents(input.grossMonthly);
  // The reference pay excludes the holiday and Christmas allowances: strip them when they sit in the twelfths.
  const baseMonthlyCents = input.allowances === "twelfths" ? Math.round((grossCents * 12) / 14) : grossCents;
  const referenceDailyCents = Math.round(baseMonthlyCents / 30);

  // The benefit cannot exceed the net value of the reference pay (guide, section D1).
  const withholding = computeWithholdingCents(baseMonthlyCents, {
    region: "mainland", status: "single", dependants: input.dependants,
  });
  const netReferenceDailyCents = Math.max(
    0,
    Math.round((baseMonthlyCents - withholding - (baseMonthlyCents * EMPLOYEE_SOCIAL_SECURITY_BP) / 10_000) / 30),
  );

  const increaseApplied =
    baseMonthlyCents <= INCREASE_MAX_REFERENCE_MONTHLY_CENTS || input.dependants >= INCREASE_MIN_DESCENDANTS;
  const waitingTotal = input.hospitalisation ? 0 : WAITING_DAYS;
  let limit: SickPayResult["limit"] = "none";

  const dailyFor = (percent: number) => {
    const pct = increaseApplied && percent <= 60 ? percent + INCREASE_POINTS : percent;
    let daily = Math.round((referenceDailyCents * pct) / 100);
    if (referenceDailyCents < MIN_DAILY_CENTS) {
      // Reference pay below the minimum: the benefit is the reference pay itself.
      daily = referenceDailyCents;
      limit = "referencePay";
    } else if (daily < MIN_DAILY_CENTS) {
      daily = MIN_DAILY_CENTS;
      limit = "minimum";
    }
    if (daily > netReferenceDailyCents && netReferenceDailyCents >= MIN_DAILY_CENTS) {
      daily = netReferenceDailyCents;
      limit = "netCap";
    }
    return daily;
  };

  const bands: SickBandResult[] = [];
  for (const band of SICK_BANDS) {
    const last = Math.min(band.toDay, input.sickDays);
    if (last < band.fromDay) continue;
    const days = last - band.fromDay + 1;
    const waitingEnd = Math.min(last, waitingTotal);
    const waitingDays = Math.max(0, waitingEnd - band.fromDay + 1);
    const paidDays = days - waitingDays;
    const dailyCents = dailyFor(band.percent);
    bands.push({
      percent: increaseApplied && band.percent <= 60 ? band.percent + INCREASE_POINTS : band.percent,
      fromDay: band.fromDay, toDay: last, days, waitingDays, paidDays, dailyCents, amountCents: paidDays * dailyCents,
    });
  }

  const waitingDays = bands.reduce((sum, band) => sum + band.waitingDays, 0);
  const totalCents = bands.reduce((sum, band) => sum + band.amountCents, 0);

  const net = computeNetSalary({
    grossMonthly: input.grossMonthly, region: "mainland", status: "single", dependants: input.dependants,
    mealDaily: 0, mealDays: 0, mealKind: "cash", allowances: input.allowances,
  });
  if (!net.ok) throw new Error("Net salary validation must accept validated sick pay input");
  const netMonthlyCents = Math.round(net.result.annual.netCents / 12);

  const firstBand = bands[0];
  const firstMonthDays = Math.min(30, input.sickDays);
  // The first band covers days 1 to 30, so the first month is always inside it.
  const firstMonthBenefit = firstBand.paidDays * firstBand.dailyCents;
  const months = input.sickDays / 30;

  return {
    ok: true as const,
    result: {
      referenceDailyCents, bands, waitingDays,
      paidDays: input.sickDays - waitingDays,
      totalCents,
      waitingNetPayCents: Math.round((netMonthlyCents * waitingDays) / 30),
      increaseApplied, limit, netMonthlyCents,
      firstMonthGapCents: Math.max(0, netMonthlyCents - Math.round((firstMonthBenefit * 30) / firstMonthDays)),
      averageMonthlyGapCents: Math.max(0, Math.round(netMonthlyCents - totalCents / months)),
    } satisfies SickPayResult,
  };
}
