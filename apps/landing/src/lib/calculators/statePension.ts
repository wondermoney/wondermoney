import { EMPLOYEE_SOCIAL_SECURITY_BP, computePensionWithholdingCents, computeWithholdingCents } from "./payroll";
import { IAS_2026_CENTS } from "./unemploymentBenefit";

export { IAS_2026_CENTS };

/** Date the rules and values below were checked against the sources. */
export const STATE_PENSION_REVIEWED = "2026-11-19";

/** Normal age of access to the old-age pension in the general regime, in months (Portaria n.º 358/2024/1: 66 years and 9 months). */
export const NORMAL_AGE_2026_MONTHS = 66 * 12 + 9;
/** The 2027 value, already published (Portaria n.º 476/2025/1: 66 years and 11 months). Shown, not used. */
export const NORMAL_AGE_2027_MONTHS = 66 * 12 + 11;
/** Sustainability factor for pensions starting in 2026, in basis points (Portaria n.º 476/2025/1: 0.8237). */
export const SUSTAINABILITY_FACTOR_2026_BP = 8237;
/** Penalty for each month of retirement before the normal age, in basis points (0.5%). */
export const EARLY_PENALTY_PER_MONTH_BP = 50;
export const EARLIEST_AGE_MONTHS = 60 * 12;
export const LATEST_AGE_MONTHS = 70 * 12;
export const MIN_CONTRIBUTION_YEARS = 15;
export const MAX_COUNTED_YEARS = 40;
/** Pension with the late-retirement bonus cannot exceed 92% of the reference remuneration. */
export const BONUS_CAP_PERCENT = 92;

/** Annual accrual rate (basis points) by slice of the reference remuneration, in hundredths of the IAS. Above 20 years of contributions. */
export const ACCRUAL_BANDS = [
  { upToIasHundredths: 110, rateBp: 230 },
  { upToIasHundredths: 200, rateBp: 225 },
  { upToIasHundredths: 400, rateBp: 220 },
  { upToIasHundredths: 800, rateBp: 210 },
  { upToIasHundredths: Number.POSITIVE_INFINITY, rateBp: 200 },
] as const;
/** Flat annual rate for careers of up to 20 years. */
export const SHORT_CAREER_RATE_BP = 200;
export const SHORT_CAREER_MAX_YEARS = 20;

/** Bonus per month worked after the normal age, in basis points, by years of contributions. */
export const LATE_BONUS_BP_BY_YEARS = [
  { minYears: 40, bp: 100 },
  { minYears: 35, bp: 65 },
  { minYears: 25, bp: 50 },
  { minYears: 15, bp: 33 },
] as const;

/** Minimum monthly old-age pension for 2026 by years of contributions, in cents (Portaria n.º 480-B/2025/1). */
export const MINIMUM_PENSIONS_2026 = [
  { minYears: 31, cents: 49_352 },
  { minYears: 21, cents: 39_482 },
  { minYears: 15, cents: 35_780 },
] as const;

export const STATE_PENSION_LIMITS = { grossMonthly: 100_000, yearsMax: 50 } as const;

export type StatePensionField = "grossMonthly" | "years" | "ageYears" | "ageMonths";
type FieldError = "required" | "tooSmall" | "tooLarge" | "whole" | "belowMinimum" | "tooLongForAge";

export interface StatePensionInput {
  /** Average gross monthly salary over the career, in today's euros, paid 14 times a year. */
  grossMonthly: number;
  /** Years of contributions at retirement. */
  years: number;
  /** Retirement age: whole years and extra months. */
  ageYears: number;
  ageMonths: number;
}

export const STATE_PENSION_EXAMPLE: StatePensionInput = { grossMonthly: 1800, years: 38, ageYears: 65, ageMonths: 0 };

export function validateStatePension(input: StatePensionInput): Partial<Record<StatePensionField, FieldError>> {
  const errors: Partial<Record<StatePensionField, FieldError>> = {};
  const check = (field: StatePensionField, value: number, min: number, max: number, whole = false) => {
    if (Number.isNaN(value)) errors[field] = "required";
    else if (value < min) errors[field] = field === "years" ? "belowMinimum" : "tooSmall";
    else if (value > max) errors[field] = "tooLarge";
    else if (whole && !Number.isInteger(value)) errors[field] = "whole";
  };
  check("grossMonthly", input.grossMonthly, 0.01, STATE_PENSION_LIMITS.grossMonthly);
  check("years", input.years, MIN_CONTRIBUTION_YEARS, STATE_PENSION_LIMITS.yearsMax, true);
  check("ageYears", input.ageYears, EARLIEST_AGE_MONTHS / 12, LATEST_AGE_MONTHS / 12, true);
  check("ageMonths", input.ageMonths, 0, 11, true);
  if (!errors.ageYears && !errors.ageMonths && input.ageYears * 12 + input.ageMonths > LATEST_AGE_MONTHS) {
    errors.ageMonths = "tooLarge";
  }
  // Contributions start at 16 at the earliest.
  if (!errors.years && !errors.ageYears && input.years > input.ageYears - 16) errors.years = "tooLongForAge";
  return errors;
}

export function minimumPensionCents(years: number): number {
  return MINIMUM_PENSIONS_2026.find((row) => years >= row.minYears)?.cents ?? 0;
}

/** Statutory monthly pension before any early or late adjustment, in cents (P2 whole-career formula). */
export function statutoryPensionCents(referenceCents: number, years: number): number {
  const counted = Math.min(years, MAX_COUNTED_YEARS);
  if (years <= SHORT_CAREER_MAX_YEARS) return Math.round((referenceCents * SHORT_CAREER_RATE_BP * counted) / 10_000);
  let accrued = 0; // cents x basis points of one year
  let lower = 0;
  for (const band of ACCRUAL_BANDS) {
    const upper = band.upToIasHundredths * IAS_2026_CENTS / 100;
    const slice = Math.max(0, Math.min(referenceCents, upper) - lower);
    accrued += slice * band.rateBp;
    lower = upper;
    if (referenceCents <= upper) break;
  }
  return Math.round((accrued * counted) / 10_000);
}

export function lateBonusBp(years: number): number {
  return LATE_BONUS_BP_BY_YEARS.find((row) => years >= row.minYears)?.bp ?? 0;
}

export type PensionAdjustment = "none" | "early" | "late";
export type PensionFloor = "none" | "minimum";

export interface StatePensionResult {
  referenceCents: number;
  /** Global formation rate in percent x 100 (for example 9022 is 90.22%). */
  globalRateBp: number;
  statutoryCents: number;
  adjustment: PensionAdjustment;
  /** Months before (early) or after (late) the normal age; 0 when none. */
  adjustmentMonths: number;
  /** Total reduction from the monthly penalty, in basis points (early only). */
  penaltyBp: number;
  /** Late bonus in basis points (late only), after the 92% cap. */
  bonusBp: number;
  bonusCapped: boolean;
  floor: PensionFloor;
  /** Estimated monthly gross pension, per payment, 14 payments a year. */
  monthlyCents: number;
  /** Pension as a share of the average gross salary, in basis points. */
  replacementBp: number;
  /** Net pay today per payment (Social Security and estimated IRS deducted). */
  netPayCents: number;
  /** IRS withheld on the pension per payment (2026 pension table VIII; no Social Security on pensions). */
  pensionWithholdingCents: number;
  /** Pension per payment after IRS withholding. */
  netPensionCents: number;
  /** Monthly shortfall of the net pension against net pay, never negative. */
  gapCents: number;
}

const toCents = (euros: number) => Math.round(euros * 100);

export function computeStatePension(input: StatePensionInput) {
  const errors = validateStatePension(input);
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const referenceCents = toCents(input.grossMonthly);
  const statutoryCents = statutoryPensionCents(referenceCents, input.years);
  const globalRateBp = Math.round((statutoryCents / referenceCents) * 10_000);
  const ageMonths = input.ageYears * 12 + input.ageMonths;

  let adjustment: PensionAdjustment = "none";
  let adjustmentMonths = 0;
  let penaltyBp = 0;
  let bonusBp = 0;
  let bonusCapped = false;
  let floor: PensionFloor = "none";
  let monthlyCents = statutoryCents;

  if (ageMonths < NORMAL_AGE_2026_MONTHS) {
    adjustment = "early";
    adjustmentMonths = NORMAL_AGE_2026_MONTHS - ageMonths;
    penaltyBp = adjustmentMonths * EARLY_PENALTY_PER_MONTH_BP;
    // The penalty and the sustainability factor multiply.
    monthlyCents = Math.round((statutoryCents * (10_000 - penaltyBp) * SUSTAINABILITY_FACTOR_2026_BP) / 100_000_000);
  } else {
    if (ageMonths > NORMAL_AGE_2026_MONTHS) {
      adjustment = "late";
      adjustmentMonths = ageMonths - NORMAL_AGE_2026_MONTHS;
      bonusBp = adjustmentMonths * lateBonusBp(input.years);
      const cap = Math.round((referenceCents * BONUS_CAP_PERCENT) / 100);
      const bonused = Math.round((statutoryCents * (10_000 + bonusBp)) / 10_000);
      // The cap never lowers a pension that is already above it.
      monthlyCents = Math.max(statutoryCents, Math.min(bonused, cap));
      bonusCapped = bonused > monthlyCents;
      bonusBp = Math.round(((monthlyCents / statutoryCents) - 1) * 10_000);
    }
    // The minimum does not apply to early retirement through the flexibilisation regime.
    const minimum = minimumPensionCents(input.years);
    if (monthlyCents < minimum) {
      monthlyCents = minimum;
      floor = "minimum";
    }
  }

  const withholdingCents = computeWithholdingCents(referenceCents, { region: "mainland", status: "single", dependants: 0 });
  const netPayCents = Math.max(
    0,
    Math.round(referenceCents * (1 - EMPLOYEE_SOCIAL_SECURITY_BP / 10_000)) - withholdingCents,
  );

  // Net against net: a pension pays IRS (pension table VIII) but no Social Security.
  const pensionWithholdingCents = computePensionWithholdingCents(monthlyCents);
  const netPensionCents = monthlyCents - pensionWithholdingCents;

  return {
    ok: true as const,
    result: {
      referenceCents, globalRateBp, statutoryCents, adjustment, adjustmentMonths, penaltyBp, bonusBp, bonusCapped, floor,
      monthlyCents,
      replacementBp: Math.round((monthlyCents / referenceCents) * 10_000),
      netPayCents,
      pensionWithholdingCents,
      netPensionCents,
      gapCents: Math.max(0, netPayCents - netPensionCents),
    } satisfies StatePensionResult,
  };
}
