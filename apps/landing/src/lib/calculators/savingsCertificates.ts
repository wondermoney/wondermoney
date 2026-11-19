/**
 * Certificados de Aforro, Série F (Portaria n.º 149-A/2023; IGCP product sheet of April 2026).
 *
 * The rules the page states and this module models:
 * - Term of 15 years. Interest accrues quarterly and is capitalised automatically, net of IRS.
 * - The rate of a quarter is the base rate at the start of that quarter plus the permanence
 *   premium for the subscription year the quarter falls in. The base rate is set monthly from
 *   the 3-month Euribor and cannot exceed 2.50% or go below 0%.
 * - Premium, in percentage points: 0 in year 1, 0.25 in years 2 to 5, 0.50 in years 6 to 9,
 *   1.00 in years 10 and 11, 1.50 in years 12 and 13, 1.75 in years 14 and 15.
 * - IRS withheld at source (liberatória) at 28% of each quarter's interest.
 * - Early redemption is allowed from the first interest date, so a stay is whole quarters.
 *
 * Simplifications, stated on the page: the base rate is one value the visitor enters and is held
 * for every quarter (the real one changes monthly); a quarter earns exactly a quarter of the
 * annual rate (no day count). Each quarter's gross interest and tax are rounded to the cent.
 */

export const SAVINGS_CERTIFICATES_RULES = {
  seriesLabel: "F",
  termYears: 15,
  maxBaseRate: 2.5,
  /** Rule date of the IGCP sheet the premiums come from. */
  rulesDate: "2026-04",
  /** IRS withheld at source on the interest, in percent. */
  irsRate: 28,
  /** Euros (one unit is 1 euro). */
  minAmount: 100,
  maxAmount: 250_000,
} as const;

/** Permanence premium in percentage points for a 1-based subscription year. */
export function permanencePremium(year: number): number {
  if (year <= 1) return 0;
  if (year <= 5) return 0.25;
  if (year <= 9) return 0.5;
  if (year <= 11) return 1;
  if (year <= 13) return 1.5;
  return 1.75;
}

/** The premium table as the page prints it: first and last year of each step. */
export const PERMANENCE_PREMIUM_STEPS = [
  { from: 1, to: 1, premium: 0 },
  { from: 2, to: 5, premium: 0.25 },
  { from: 6, to: 9, premium: 0.5 },
  { from: 10, to: 11, premium: 1 },
  { from: 12, to: 13, premium: 1.5 },
  { from: 14, to: 15, premium: 1.75 },
] as const;

export const SAVINGS_CERTIFICATES_EXAMPLE = {
  amount: 10_000,
  years: 5,
  /** The ceiling the rules allow; the visitor can change it. */
  baseRate: 2.5,
} as const;

export type SavingsCertificatesInput = { amount: number; years: number; baseRate: number };
export type SavingsCertificatesField = keyof SavingsCertificatesInput;
export type SavingsCertificatesError = "required" | "negative" | "tooSmall" | "tooLarge" | "years" | "baseRate";

const cents = (euros: number) => Math.round(euros * 100);

export function computeSavingsCertificates(input: SavingsCertificatesInput) {
  const { minAmount, maxAmount, termYears, maxBaseRate, irsRate } = SAVINGS_CERTIFICATES_RULES;
  const errors: Partial<Record<SavingsCertificatesField, SavingsCertificatesError>> = {};
  if (Number.isNaN(input.amount)) errors.amount = "required";
  else if (input.amount < minAmount) errors.amount = "tooSmall";
  else if (input.amount > maxAmount) errors.amount = "tooLarge";
  if (Number.isNaN(input.years)) errors.years = "required";
  else if (!Number.isInteger(input.years) || input.years < 1 || input.years > termYears) errors.years = "years";
  if (Number.isNaN(input.baseRate)) errors.baseRate = "required";
  else if (input.baseRate < 0) errors.baseRate = "negative";
  else if (input.baseRate > maxBaseRate) errors.baseRate = "baseRate";
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const principal = cents(input.amount);
  let balance = principal;
  let grossTotal = 0;
  let taxTotal = 0;
  let premiumGross = 0;
  const yearly: { year: number; rate: number; grossInterest: number; tax: number; balance: number }[] = [];

  for (let year = 1; year <= input.years; year++) {
    const rate = input.baseRate + permanencePremium(year);
    let yearGross = 0;
    let yearTax = 0;
    for (let quarter = 0; quarter < 4; quarter++) {
      const gross = Math.round((balance * rate) / 400);
      const tax = Math.round((gross * irsRate) / 100);
      // The part of the interest the premium adds, taxed alike, for the "of which premium" line.
      premiumGross += Math.round((balance * permanencePremium(year)) / 400);
      balance += gross - tax;
      yearGross += gross;
      yearTax += tax;
    }
    grossTotal += yearGross;
    taxTotal += yearTax;
    yearly.push({
      year,
      rate,
      grossInterest: yearGross / 100,
      tax: yearTax / 100,
      balance: balance / 100,
    });
  }

  const netInterest = grossTotal - taxTotal;
  return {
    ok: true as const,
    result: {
      invested: principal / 100,
      grossInterest: grossTotal / 100,
      irs: taxTotal / 100,
      netInterest: netInterest / 100,
      finalValue: balance / 100,
      premiumInterest: premiumGross / 100,
      /** Net annual yield: compound growth of the invested amount to the final balance. */
      netAnnualYield: (Math.pow(balance / principal, 1 / input.years) - 1) * 100,
      yearly,
    },
  };
}
