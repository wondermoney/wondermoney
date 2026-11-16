/**
 * A one-off partial early repayment on a fixed-rate loan, compared with leaving the loan as it
 * is. Two ways to use the repayment:
 *
 * - keep the term and lower the payment: the reduced balance is spread over the same months;
 * - keep the payment and shorten the term: the same monthly amounts as the original schedule
 *   are paid until the reduced balance is gone.
 *
 * Both schedules come from the shared loan engine (`./amortization`, the one the mortgage
 * calculator runs), worked in whole cents so every figure adds up exactly. Because the shorter
 * schedule pays the original amounts on a smaller balance, its balance stays below the
 * original's every month: it never runs longer and never costs more interest.
 *
 * A balance left below the calculator's minimum loan is treated as cleared: it is paid with the
 * next payment, plus that month's interest, rather than spread into payments that round to
 * nothing.
 */

import {
  amortizeLevelPayment,
  amortizeWithPayments,
  monthlyRateFromAnnual,
  totalInterestCents,
  type AmortizationMonth,
} from "./amortization";
import { MORTGAGE_LIMITS } from "./mortgage";

export const EARLY_REPAYMENT_LIMITS = {
  /** Euros; the mortgage calculator's floor, so the two tools accept the same loans. */
  minBalance: MORTGAGE_LIMITS.minLoanAmount,
  maxBalance: MORTGAGE_LIMITS.maxLoanAmount,
  maxTermYears: MORTGAGE_LIMITS.maxTermYears,
  /** Nominal annual rate, in percent. */
  maxAnnualRate: MORTGAGE_LIMITS.maxAnnualRate,
  /** Percent of the amount repaid. Legal caps are far lower; this only stops typos. */
  maxFeePercent: 10,
} as const;

/** The loan the page's worked example walks through; the calculator starts from it too. */
export const EARLY_REPAYMENT_EXAMPLE = {
  balance: 150_000,
  termYears: 25,
  termMonths: 0,
  annualRate: 3.5,
  repayment: 20_000,
  feePercent: 0,
  /** The fee the example adds in its last step. */
  exampleFeePercent: 0.5,
} as const;

export type EarlyRepaymentInput = {
  /** Balance still owed today, in euros. */
  balance: number;
  /** Whole years left on the loan. Empty (NaN) reads as 0. */
  termYears: number;
  /** Months left on top of the years, 0 to 11. Empty (NaN) reads as 0. */
  termMonths: number;
  /** Fixed nominal annual rate in percent. Empty (NaN) is `required`: 0% is a value to enter. */
  annualRate: number;
  /** One lump sum repaid now, in euros. Empty (NaN) reads as nothing. */
  repayment: number;
  /** Early-repayment fee, in percent of the amount repaid. Empty (NaN) reads as none. */
  feePercent: number;
};

export type EarlyRepaymentField = keyof EarlyRepaymentInput;

export type EarlyRepaymentInputError = "required" | "tooSmall" | "tooLarge" | "negative";

export type LoanOutlook = {
  /** The first monthly payment; later ones stay within a cent of it, except a smaller last one. */
  monthlyPayment: number;
  /** The final payment, which can be smaller when the term is shortened. 0 when nothing is owed. */
  lastPayment: number;
  /** Monthly payments left. */
  months: number;
  totalInterest: number;
  /** Principal plus interest still to pay. */
  totalPaid: number;
  /**
   * Balance owed now (years 0), at the end of each whole year, and 0 at the payoff time in
   * fractional years (months / 12), so a chart ends where the loan does.
   */
  balancePoints: Array<{ years: number; balance: number }>;
};

export type EarlyRepaymentScenario = LoanOutlook & {
  /** Original monthly payment minus this one. */
  paymentReduction: number;
  /** Original payments left minus these. */
  monthsSaved: number;
  /** Original interest minus this outcome's. Never negative. */
  interestSaved: number;
  /** Interest saved minus the fee; negative when the fee costs more. */
  netSaving: number;
};

export type EarlyRepaymentResult = {
  /**
   * "none": nothing repaid; "partial": a balance is left; "cleared": the loan is paid off, or
   * all but a remainder below the minimum balance, paid with the next payment.
   */
  status: "none" | "partial" | "cleared";
  /** The part of the repayment that goes to the loan: at most the balance. */
  repaymentApplied: number;
  /** Anything entered above the balance, which clearing the loan does not need. */
  repaymentUnused: number;
  fee: number;
  /** Balance owed straight after the repayment. */
  balanceAfter: number;
  /**
   * When the repayment leaves less than the minimum balance, the single next payment that
   * clears it (the remainder plus a month's interest). 0 otherwise.
   */
  finalPayment: number;
  original: LoanOutlook;
  lowerPayment: EarlyRepaymentScenario;
  shorterTerm: EarlyRepaymentScenario;
};

export type EarlyRepaymentCalculation =
  | { ok: true; result: EarlyRepaymentResult }
  | { ok: false; errors: Partial<Record<EarlyRepaymentField, EarlyRepaymentInputError>> };

const orZero = (value: number) => (Number.isNaN(value) ? 0 : value);
const fromCents = (cents: number) => cents / 100;

/**
 * The whole months left on the loan, and whether the years and months entered had to be rounded
 * to get them (2.51 years, or 2.6 months).
 */
export function remainingTerm(termYears: number, termMonths: number): { months: number; rounded: boolean } {
  const exact = orZero(termYears) * 12 + orZero(termMonths);
  const months = Math.round(exact);
  return { months, rounded: Number.isFinite(exact) && Math.abs(exact - months) > 1e-9 };
}

function remainingMonths(input: EarlyRepaymentInput): number {
  return remainingTerm(input.termYears, input.termMonths).months;
}

function validate(
  input: EarlyRepaymentInput,
): Partial<Record<EarlyRepaymentField, EarlyRepaymentInputError>> {
  const errors: Partial<Record<EarlyRepaymentField, EarlyRepaymentInputError>> = {};
  const { balance, termYears, termMonths, annualRate, repayment, feePercent } = input;

  if (Number.isNaN(balance) || balance <= 0) errors.balance = "required";
  else if (balance < EARLY_REPAYMENT_LIMITS.minBalance) errors.balance = "tooSmall";
  else if (balance > EARLY_REPAYMENT_LIMITS.maxBalance) errors.balance = "tooLarge";

  if (termMonths < 0) errors.termMonths = "negative";
  else if (termMonths > 11) errors.termMonths = "tooLarge";

  if (termYears < 0) errors.termYears = "negative";
  else if (!errors.termMonths) {
    const months = remainingMonths(input);
    if (!Number.isFinite(months) || months > EARLY_REPAYMENT_LIMITS.maxTermYears * 12) {
      errors.termYears = "tooLarge";
    } else if (months < 1) errors.termYears = "required";
  }

  if (Number.isNaN(annualRate)) errors.annualRate = "required";
  else if (annualRate < 0) errors.annualRate = "negative";
  else if (annualRate > EARLY_REPAYMENT_LIMITS.maxAnnualRate) errors.annualRate = "tooLarge";

  if (repayment < 0) errors.repayment = "negative";
  else if (repayment > EARLY_REPAYMENT_LIMITS.maxBalance) errors.repayment = "tooLarge";

  if (feePercent < 0) errors.feePercent = "negative";
  else if (feePercent > EARLY_REPAYMENT_LIMITS.maxFeePercent) errors.feePercent = "tooLarge";

  return errors;
}

function outlook(openingCents: number, rows: readonly AmortizationMonth[]): LoanOutlook {
  const interestCents = totalInterestCents(rows);
  const balancePoints = [{ years: 0, balance: fromCents(openingCents) }];
  for (let index = 11; index < rows.length; index += 12) {
    balancePoints.push({ years: (index + 1) / 12, balance: fromCents(rows[index].balanceCents) });
  }
  // A last, partial year ends when the loan does.
  if (rows.length % 12 !== 0) {
    balancePoints.push({ years: rows.length / 12, balance: fromCents(rows[rows.length - 1].balanceCents) });
  }

  return {
    monthlyPayment: fromCents(rows[0]?.paymentCents ?? 0),
    lastPayment: fromCents(rows.at(-1)?.paymentCents ?? 0),
    months: rows.length,
    totalInterest: fromCents(interestCents),
    totalPaid: fromCents(openingCents + interestCents),
    balancePoints,
  };
}

function compare(
  original: LoanOutlook,
  scenario: LoanOutlook,
  feeCents: number,
): EarlyRepaymentScenario {
  const interestSavedCents =
    Math.round(original.totalInterest * 100) - Math.round(scenario.totalInterest * 100);
  return {
    ...scenario,
    paymentReduction: fromCents(
      Math.round(original.monthlyPayment * 100) - Math.round(scenario.monthlyPayment * 100),
    ),
    monthsSaved: original.months - scenario.months,
    interestSaved: fromCents(interestSavedCents),
    netSaving: fromCents(interestSavedCents - feeCents),
  };
}

export function computeEarlyRepayment(input: EarlyRepaymentInput): EarlyRepaymentCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const months = remainingMonths(input);
  const monthlyRate = monthlyRateFromAnnual(input.annualRate);
  const balanceCents = Math.round(input.balance * 100);
  const repaymentCents = Math.round(orZero(input.repayment) * 100);
  const appliedCents = Math.min(repaymentCents, balanceCents);
  const feeCents = Math.round((appliedCents * orZero(input.feePercent)) / 100);
  const afterCents = balanceCents - appliedCents;

  const originalRows = amortizeLevelPayment(balanceCents, monthlyRate, months);
  const original = outlook(balanceCents, originalRows);

  // Below the minimum loan, spreading the remainder over the months left would give payments
  // that round to nothing; it is paid off with the next payment instead, in both outcomes.
  const effectivelyCleared =
    appliedCents > 0 && afterCents < EARLY_REPAYMENT_LIMITS.minBalance * 100;
  const clearingRows = effectivelyCleared && afterCents > 0
    ? amortizeLevelPayment(afterCents, monthlyRate, 1)
    : [];

  const lowerPaymentRows = effectivelyCleared
    ? clearingRows
    : amortizeLevelPayment(afterCents, monthlyRate, months);
  const shorterTermRows = effectivelyCleared
    ? clearingRows
    : amortizeWithPayments(
        afterCents,
        monthlyRate,
        originalRows.map((row) => row.paymentCents),
      );

  return {
    ok: true,
    result: {
      status: appliedCents === 0 ? "none" : effectivelyCleared ? "cleared" : "partial",
      repaymentApplied: fromCents(appliedCents),
      repaymentUnused: fromCents(repaymentCents - appliedCents),
      fee: fromCents(feeCents),
      balanceAfter: fromCents(afterCents),
      finalPayment: fromCents(clearingRows[0]?.paymentCents ?? 0),
      original,
      lowerPayment: compare(original, outlook(afterCents, lowerPaymentRows), feeCents),
      shorterTerm: compare(original, outlook(afterCents, shorterTermRows), feeCents),
    },
  };
}
