// Financial independence (FIRE) calculator.
//
// Everything is in today's money: the return is the real (after-inflation) one,
// so spending, contributions and the target keep their present-day value. Taxes,
// fees and the order of good and bad years (sequence risk) are left out, and the
// page says so.

export const FIRE_DEFAULT_RETURN = 5;
export const FIRE_DEFAULT_WITHDRAWAL_RATE = 4;
export const FIRE_WITHDRAWAL_RATE_MIN = 2.5;
export const FIRE_WITHDRAWAL_RATE_MAX = 6;
export const FIRE_RETURN_MIN = -10;
export const FIRE_RETURN_MAX = 15;
/** Amounts above this are treated as this, so the arithmetic stays finite. */
export const FIRE_MAX_AMOUNT = 1_000_000_000_000;
/** The projection stops here; a target further away is reported as out of reach. */
export const FIRE_MAX_YEARS = 100;
/** The spending cut the sensitivity line shows, in percent. */
export const FIRE_SPENDING_CUT = 10;

export type FireInputs = {
  /** What you expect to spend a year once you stop working. */
  annualSpending: number;
  /** What you have invested today. */
  currentAssets: number;
  /** What you add at the end of every month. */
  monthlyContribution: number;
  /** Expected real (after-inflation) return a year, in percent. */
  realReturn: number;
  /** Share of the portfolio withdrawn in the first year, in percent. */
  withdrawalRate: number;
};

/** The example the page works through and the calculator starts from. */
export const FIRE_WORKED_EXAMPLE = {
  annualSpending: 24000,
  currentAssets: 60000,
  monthlyContribution: 800,
  realReturn: FIRE_DEFAULT_RETURN,
  withdrawalRate: FIRE_DEFAULT_WITHDRAWAL_RATE,
} as const satisfies FireInputs;

export type FireStatus =
  /** No annual spending entered, so there is no target. */
  | "noSpending"
  /** Current assets already meet the target. */
  | "reached"
  /** The target is met within the horizon. */
  | "projected"
  /** Assets never reach the target, whatever the horizon. */
  | "unreachable"
  /** Assets would reach the target, but not within FIRE_MAX_YEARS. */
  | "beyondHorizon";

export type FirePathPoint = {
  /** Years from today. */
  year: number;
  /** Projected invested assets at the end of that year, rounded to the euro. */
  assets: number;
  /** Current assets plus every contribution so far, rounded to the euro. */
  contributed: number;
};

export type FireResult = {
  /** The inputs the result was computed from, after normalizeFireInputs. */
  inputs: FireInputs;
  fireNumber: number;
  /** Current assets as a percentage of the FIRE number; null without a target. */
  progress: number | null;
  status: FireStatus;
  /** Months until assets first meet the target: 0 when reached, null when not projected. */
  monthsToTarget: number | null;
  /** Year-end points from today; empty when there is nothing to project. */
  path: FirePathPoint[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toAmount(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, FIRE_MAX_AMOUNT) : 0;
}

/** Turns what a visitor typed into inputs the calculation can use. */
export function normalizeFireInputs(inputs: FireInputs): FireInputs {
  return {
    annualSpending: toAmount(inputs.annualSpending),
    currentAssets: toAmount(inputs.currentAssets),
    monthlyContribution: toAmount(inputs.monthlyContribution),
    realReturn: Number.isFinite(inputs.realReturn)
      ? clamp(inputs.realReturn, FIRE_RETURN_MIN, FIRE_RETURN_MAX)
      : 0,
    withdrawalRate: Number.isFinite(inputs.withdrawalRate)
      ? clamp(inputs.withdrawalRate, FIRE_WITHDRAWAL_RATE_MIN, FIRE_WITHDRAWAL_RATE_MAX)
      : FIRE_DEFAULT_WITHDRAWAL_RATE,
  };
}

/** The monthly rate that compounds to the annual return over twelve months. */
function monthlyRateFor(annualPercent: number): number {
  return Math.pow(1 + annualPercent / 100, 1 / 12) - 1;
}

function neverReaches(inputs: FireInputs, monthlyRate: number, fireNumber: number): boolean {
  const { currentAssets, monthlyContribution } = inputs;
  if (monthlyContribution === 0) return monthlyRate <= 0 || currentAssets === 0;
  // With a negative return the balance levels off where losses match contributions.
  if (monthlyRate < 0) return monthlyContribution / -monthlyRate <= fireNumber;
  return false;
}

export function calculateFire(rawInputs: FireInputs): FireResult {
  const inputs = normalizeFireInputs(rawInputs);
  const { annualSpending, currentAssets, monthlyContribution } = inputs;

  if (annualSpending === 0) {
    return { inputs, fireNumber: 0, progress: null, status: "noSpending", monthsToTarget: null, path: [] };
  }

  const fireNumber = annualSpending / (inputs.withdrawalRate / 100);
  const progress = (currentAssets / fireNumber) * 100;

  if (currentAssets >= fireNumber) {
    return { inputs, fireNumber, progress, status: "reached", monthsToTarget: 0, path: [] };
  }

  const monthlyRate = monthlyRateFor(inputs.realReturn);
  if (neverReaches(inputs, monthlyRate, fireNumber)) {
    return { inputs, fireNumber, progress, status: "unreachable", monthsToTarget: null, path: [] };
  }

  const path: FirePathPoint[] = [{ year: 0, assets: Math.round(currentAssets), contributed: Math.round(currentAssets) }];
  let balance = currentAssets;
  let contributed = currentAssets;
  let monthsToTarget: number | null = null;

  for (let month = 1; month <= FIRE_MAX_YEARS * 12; month++) {
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    contributed += monthlyContribution;
    if (monthsToTarget === null && balance >= fireNumber) monthsToTarget = month;

    if (month % 12 === 0) {
      path.push({ year: month / 12, assets: Math.round(balance), contributed: Math.round(contributed) });
      // Run on to the end of the year the target is met in, then stop.
      if (monthsToTarget !== null) break;
    }
  }

  return {
    inputs,
    fireNumber,
    progress,
    status: monthsToTarget === null ? "beyondHorizon" : "projected",
    monthsToTarget,
    path,
  };
}

/** A month as one number, year × 12 + month (0 = January), so it can be compared and stored as a primitive. */
export function toMonthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/** The calendar year `months` months after the month `fromMonthIndex` (see toMonthIndex). */
export function fireTargetYear(fromMonthIndex: number, months: number): number {
  return Math.floor((fromMonthIndex + months) / 12);
}

export function splitMonths(totalMonths: number): { years: number; months: number } {
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12 };
}
