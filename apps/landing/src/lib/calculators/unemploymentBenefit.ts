import {
  EMPLOYEE_SOCIAL_SECURITY_BP,
  computeWithholdingCents,
  type AllowanceSchedule,
  type HolderStatus,
} from "./payroll";

/** 2026 reference values, in cents. */
export const IAS_2026_CENTS = 53_713; // Portaria n.º 480-A/2025/1
export const RMMG_2026_CENTS = 92_000; // Decreto-Lei n.º 139/2025
export const REFERENCE_DATE = "2026-11-19";

/** Monthly benefit limits, in multiples of the IAS expressed in hundredths. */
export const MAX_IAS_HUNDREDTHS = 250;
export const MIN_IAS_HUNDREDTHS = 100;
export const MIN_IAS_AT_MINIMUM_WAGE_HUNDREDTHS = 115;
export const BENEFIT_RATE_PERCENT = 65;
export const NET_CAP_PERCENT = 75;
export const CHILDREN_INCREASE_PERCENT = 10;

export type Household = "alone" | "partnerWorking" | "partnerUnemployed" | "singleParent";
export const HOUSEHOLDS = ["alone", "partnerWorking", "partnerUnemployed", "singleParent"] as const satisfies readonly Household[];

export const UNEMPLOYMENT_LIMITS = {
  grossMonthly: 100_000, ageMin: 16, ageMax: 70, monthsMin: 12, monthsMax: 600, years20Max: 20, dependants: 10,
} as const;

export type UnemploymentField = "grossMonthly" | "age" | "contributionMonths" | "years20" | "dependants";
type FieldError = "required" | "tooSmall" | "tooLarge" | "whole" | "belowTable";

export interface UnemploymentBenefitInput {
  /** Base gross monthly salary in euros. */
  grossMonthly: number;
  /** `fourteen`: holiday and Christmas allowances paid as extra payments. `twelfths`: the salary already includes them. */
  allowances: AllowanceSchedule;
  /** Age on the day of unemployment, in whole years. */
  age: number;
  /** Months with registered remuneration before unemployment. */
  contributionMonths: number;
  /** Years with registered remuneration in the last 20 years. */
  years20: number;
  household: Household;
  dependants: number;
}

export const UNEMPLOYMENT_EXAMPLE: UnemploymentBenefitInput = {
  grossMonthly: 1500, allowances: "fourteen", age: 38, contributionMonths: 30, years20: 12,
  household: "alone", dependants: 0,
};

interface DurationRow { under15: number; from15: number; from24: number; extraPer5Years: number }

/** Quadro I of the Segurança Social guide: days of benefit by age and months with remuneration records. */
const DURATION_BY_AGE: ReadonlyArray<{ minAge: number; row: DurationRow }> = [
  { minAge: 50, row: { under15: 270, from15: 480, from24: 540, extraPer5Years: 60 } },
  { minAge: 40, row: { under15: 210, from15: 360, from24: 540, extraPer5Years: 45 } },
  { minAge: 30, row: { under15: 180, from15: 330, from24: 420, extraPer5Years: 30 } },
  { minAge: 0, row: { under15: 150, from15: 210, from24: 330, extraPer5Years: 30 } },
];

export interface Duration { baseDays: number; extraDays: number; totalDays: number }

export function benefitDuration(age: number, contributionMonths: number, years20: number): Duration {
  const row = DURATION_BY_AGE.find((entry) => age >= entry.minAge)!.row;
  const baseDays = contributionMonths < 15 ? row.under15 : contributionMonths < 24 ? row.from15 : row.from24;
  const extraDays = Math.floor(years20 / 5) * row.extraPer5Years;
  return { baseDays, extraDays, totalDays: baseDays + extraDays };
}

export function validateUnemployment(input: UnemploymentBenefitInput): Partial<Record<UnemploymentField, FieldError>> {
  const errors: Partial<Record<UnemploymentField, FieldError>> = {};
  const check = (field: UnemploymentField, value: number, min: number, max: number, whole = false) => {
    if (Number.isNaN(value)) errors[field] = "required";
    else if (value < min) errors[field] = field === "contributionMonths" ? "belowTable" : "tooSmall";
    else if (value > max) errors[field] = "tooLarge";
    else if (whole && !Number.isInteger(value)) errors[field] = "whole";
  };
  const l = UNEMPLOYMENT_LIMITS;
  check("grossMonthly", input.grossMonthly, 0.01, l.grossMonthly);
  check("age", input.age, l.ageMin, l.ageMax, true);
  check("contributionMonths", input.contributionMonths, l.monthsMin, l.monthsMax, true);
  check("years20", input.years20, 0, l.years20Max, true);
  check("dependants", input.dependants, 0, l.dependants, true);
  return errors;
}

export interface UnemploymentBenefitResult {
  /** Reference remuneration per day (R / 360), in cents. */
  referenceDailyCents: number;
  /** 65% of the reference remuneration for 30 days, before the limits and the increase, in cents. */
  calculatedMonthlyCents: number;
  /** Net reference remuneration per month (after 11% Social Security and estimated IRS), in cents. */
  netReferenceMonthlyCents: number;
  monthlyCents: number;
  dailyCents: number;
  duration: Duration;
  totalCents: number;
  /** The rule that decided the amount. */
  limit: "none" | "max" | "netCap" | "minimum" | "minimumWage";
  childrenIncrease: boolean;
  /** Monthly income lost against the net reference pay, never negative. */
  monthlyDropCents: number;
}

const toCents = (euros: number) => Math.round(euros * 100);
const iasCents = (hundredths: number) => Math.round((IAS_2026_CENTS * hundredths) / 100);

export function computeUnemploymentBenefit(input: UnemploymentBenefitInput) {
  const errors = validateUnemployment(input);
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  // Reference remuneration: the 12 months counted, holiday and Christmas allowances included.
  const referenceTotalCents = toCents(input.grossMonthly) * (input.allowances === "fourteen" ? 14 : 12);
  const referenceDailyCents = Math.round(referenceTotalCents / 360);
  const referenceMonthlyCents = referenceDailyCents * 30;

  const status: HolderStatus = input.household === "alone" || input.household === "singleParent" ? "single" : "marriedTwoEarners";
  // Estimate of the "taxa de retenção" Social Security deducts from the reference pay: the withholding rate of the
  // regular monthly payment under the 2026 mainland tables, applied to the whole reference remuneration.
  const monthlyPaymentCents = toCents(input.grossMonthly);
  const withholdingRate =
    computeWithholdingCents(monthlyPaymentCents, { region: "mainland", status, dependants: input.dependants }) / monthlyPaymentCents;
  const netReferenceMonthlyCents = Math.max(
    0,
    Math.round(referenceMonthlyCents * (1 - EMPLOYEE_SOCIAL_SECURITY_BP / 10_000 - withholdingRate)),
  );

  const childrenIncrease =
    input.dependants > 0 && (input.household === "partnerUnemployed" || input.household === "singleParent");
  const calculated = Math.round((referenceMonthlyCents * BENEFIT_RATE_PERCENT) / 100);

  const upper = Math.min(iasCents(MAX_IAS_HUNDREDTHS), Math.round((netReferenceMonthlyCents * NET_CAP_PERCENT) / 100));
  let monthlyCents = Math.min(calculated, upper);
  let limit: UnemploymentBenefitResult["limit"] =
    calculated <= upper ? "none" : upper === iasCents(MAX_IAS_HUNDREDTHS) ? "max" : "netCap";

  // The floor does not apply when the net reference pay is below the IAS.
  if (netReferenceMonthlyCents >= iasCents(MIN_IAS_HUNDREDTHS)) {
    const atMinimumWage = referenceMonthlyCents >= RMMG_2026_CENTS;
    const floor = atMinimumWage
      ? Math.max(iasCents(MIN_IAS_HUNDREDTHS), Math.min(iasCents(MIN_IAS_AT_MINIMUM_WAGE_HUNDREDTHS), upper))
      : iasCents(MIN_IAS_HUNDREDTHS);
    if (monthlyCents < floor) {
      monthlyCents = floor;
      limit = atMinimumWage && floor > iasCents(MIN_IAS_HUNDREDTHS) ? "minimumWage" : "minimum";
    }
  }

  // Simplification: the increase is applied to the limited amount and capped at 2.5 IAS.
  if (childrenIncrease) {
    monthlyCents = Math.min(iasCents(MAX_IAS_HUNDREDTHS), Math.round((monthlyCents * (100 + CHILDREN_INCREASE_PERCENT)) / 100));
  }

  const duration = benefitDuration(input.age, input.contributionMonths, input.years20);
  const dailyCents = Math.round(monthlyCents / 30);
  return {
    ok: true as const,
    result: {
      referenceDailyCents, calculatedMonthlyCents: calculated, netReferenceMonthlyCents, monthlyCents, dailyCents, duration,
      totalCents: Math.round((monthlyCents * duration.totalDays) / 30),
      limit, childrenIncrease,
      monthlyDropCents: Math.max(0, netReferenceMonthlyCents - monthlyCents),
    } satisfies UnemploymentBenefitResult,
  };
}
