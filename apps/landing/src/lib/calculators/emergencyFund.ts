export const MIN_MONTHS_OF_COVER = 1;
export const MAX_MONTHS_OF_COVER = 24;
export const DEFAULT_MONTHS_OF_COVER = 6;
export const MONTHS_OF_COVER_PRESETS = [3, 6, 12] as const;

/** The common 3-to-6-month guidance range the page shows next to the target. */
export const GUIDANCE_RANGE_MONTHS = [3, 6] as const;

/**
 * Each amount is capped here so the arithmetic stays exact in integer cents
 * (24 months of the cap is well inside Number.MAX_SAFE_INTEGER cents).
 */
export const MAX_AMOUNT = 1_000_000_000;

/** Past this many months (100 years) the page gives no target date. */
export const MAX_MONTHS_TO_TARGET = 1200;

export type EmergencyFundParams = {
  monthlyExpenses: number;
  monthsOfCover: number;
  currentSavings: number;
  monthlyContribution: number;
};

/** The calculator's starting values, which are also the page's worked example. */
export const EXAMPLE_INPUTS = {
  monthlyExpenses: 1500,
  monthsOfCover: DEFAULT_MONTHS_OF_COVER,
  currentSavings: 3000,
  monthlyContribution: 250,
} as const satisfies EmergencyFundParams;

export type EmergencyFundStatus =
  /** No essential expenses entered, so there is no target to work towards. */
  | "noExpenses"
  /** Current savings already cover the target. */
  | "reached"
  /** Short of the target and nothing set aside each month: never reached. */
  | "noContribution"
  /** Reached after `monthsToTarget` monthly contributions. */
  | "onTrack"
  /** Reached, but only after more than MAX_MONTHS_TO_TARGET months. */
  | "beyondHorizon";

export type EmergencyFundResult = {
  status: EmergencyFundStatus;
  /** Months of cover actually used, after clamping to 1–24 whole months. */
  monthsOfCover: number;
  /** Savings and contribution actually used, after clamping to 0–MAX_AMOUNT. */
  currentSavings: number;
  monthlyContribution: number;
  target: number;
  shortfall: number;
  surplus: number;
  /** 0 when already reached, null when the target is never reached. */
  monthsToTarget: number | null;
  rangeLow: number;
  rangeHigh: number;
  /** True when an amount was above MAX_AMOUNT and was capped. */
  capped: boolean;
};

function toCents(value: number): { cents: number; capped: boolean } {
  if (!Number.isFinite(value) || value <= 0) {
    return { cents: 0, capped: value === Number.POSITIVE_INFINITY };
  }
  const capped = value > MAX_AMOUNT;
  return { cents: Math.round(Math.min(value, MAX_AMOUNT) * 100), capped };
}

function clampMonthsOfCover(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MONTHS_OF_COVER;
  return Math.min(
    MAX_MONTHS_OF_COVER,
    Math.max(MIN_MONTHS_OF_COVER, Math.round(value)),
  );
}

/**
 * Target = essential monthly expenses × months of cover. Savings earn no
 * interest here, and contributions are one fixed amount a month, so the
 * months to target are the shortfall divided by the contribution, rounded up.
 * Everything runs in integer cents so an exact division never gains a month.
 */
export function computeEmergencyFund(
  params: EmergencyFundParams,
): EmergencyFundResult {
  const expenses = toCents(params.monthlyExpenses);
  const savings = toCents(params.currentSavings);
  const contribution = toCents(params.monthlyContribution);
  const monthsOfCover = clampMonthsOfCover(params.monthsOfCover);
  const capped = expenses.capped || savings.capped || contribution.capped;

  const targetCents = expenses.cents * monthsOfCover;
  const result = {
    monthsOfCover,
    currentSavings: savings.cents / 100,
    monthlyContribution: contribution.cents / 100,
    target: targetCents / 100,
    rangeLow: (expenses.cents * GUIDANCE_RANGE_MONTHS[0]) / 100,
    rangeHigh: (expenses.cents * GUIDANCE_RANGE_MONTHS[1]) / 100,
    capped,
  };

  if (expenses.cents === 0) {
    return {
      ...result,
      status: "noExpenses",
      shortfall: 0,
      surplus: 0,
      monthsToTarget: null,
    };
  }

  if (savings.cents >= targetCents) {
    return {
      ...result,
      status: "reached",
      shortfall: 0,
      surplus: (savings.cents - targetCents) / 100,
      monthsToTarget: 0,
    };
  }

  const shortfallCents = targetCents - savings.cents;

  if (contribution.cents === 0) {
    return {
      ...result,
      status: "noContribution",
      shortfall: shortfallCents / 100,
      surplus: 0,
      monthsToTarget: null,
    };
  }

  const monthsToTarget = Math.ceil(shortfallCents / contribution.cents);

  return {
    ...result,
    status: monthsToTarget > MAX_MONTHS_TO_TARGET ? "beyondHorizon" : "onTrack",
    shortfall: shortfallCents / 100,
    surplus: 0,
    monthsToTarget,
  };
}

/**
 * The first day of the month `months` calendar months after `from`'s month,
 * as a UTC date to format with `timeZone: "UTC"`. `from` is read in local time, so the
 * month is the one on the visitor's calendar.
 */
export function targetMonthFrom(from: Date, months: number): Date {
  return new Date(Date.UTC(from.getFullYear(), from.getMonth() + months, 1));
}
