/** Annual IMI (Portuguese municipal property tax). Educational estimate only. */

export const PROPERTY_TAX_LIMITS = { vpt: 10_000_000 } as const;
/** CIMI art. 112(1): urban rate range set by each municipality, in percent. */
export const URBAN_RATE_MIN = 0.3;
export const URBAN_RATE_MAX = 0.45;
/** CIMI art. 112(1)(a): rustic properties, in percent. */
export const RUSTIC_RATE = 0.8;
/** CIMI art. 112-A: fixed deduction in euros by number of dependants (3 means three or more). */
export const FAMILY_DEDUCTIONS = { 0: 0, 1: 30, 2: 70, 3: 140 } as const;
/** CIMI art. 113(6): no assessment when the tax to collect is below this many euros. */
export const MINIMUM_COLLECTED = 10;
/** CIMI art. 120(1): instalment thresholds in euros of tax owed. */
export const SINGLE_PAYMENT_MAX = 100;
export const TWO_PAYMENTS_MAX = 500;

/**
 * EBF art. 46, the own-home exemption the page describes (the calculator applies no exemption). Wording of
 * Lei n.º 56/2023 (n.º 5: three years, extendable by two by municipal assembly decision) and Lei n.º 82/2023,
 * in force since 1 January 2024; Lei n.º 73-A/2025 amends only EBF arts. 19-B and 36-A. Checked on 2026-11-20
 * against the Portal das Finanças page below and the Diário da República consolidated EBF.
 */
export const EBF_46 = {
  /** N.º 5: VPT ceiling in euros. */
  vptMax: 125_000,
  /** N.º 1: household gross income in the previous year, in euros. */
  incomeMax: 153_300,
  /** N.º 5: exemption period in years, and the extension a municipal assembly can grant. */
  years: 3,
  extensionYears: 2,
  /** N.º 11: times the exemption can be granted to the same taxpayer or household. */
  maxGrants: 2,
  source:
    "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/ebf-artigo-46-ordm-.aspx",
} as const;

export type PropertyKind = "urban" | "rustic";
export type Dependants = keyof typeof FAMILY_DEDUCTIONS;
export type PropertyTaxField = "vpt" | "rate" | "dependants";
export type PropertyTaxMonth = "may" | "august" | "november";

export interface PropertyTaxInput {
  kind: PropertyKind;
  vpt: number;
  /** Municipal rate in percent. Ignored for rustic properties. */
  rate: number;
  /** Used only for urban properties, as the IMI Familiar reduction. */
  dependants: number;
}

type FieldError = "required" | "negative" | "tooLarge" | "rateRange" | "dependants";

export const PROPERTY_TAX_EXAMPLE: PropertyTaxInput = {
  kind: "urban", vpt: 150_000, rate: 0.35, dependants: 0,
};

const cents = (value: number) => Math.round(value * 100);
const MONTHS: Record<1 | 2 | 3, PropertyTaxMonth[]> = {
  1: ["may"],
  2: ["may", "november"],
  3: ["may", "august", "november"],
};

/** The number of instalments for an annual IMI bill in euros (0 when nothing is due). */
export function instalmentCount(taxEuros: number): 0 | 1 | 2 | 3 {
  if (taxEuros <= 0) return 0;
  if (taxEuros <= SINGLE_PAYMENT_MAX) return 1;
  return taxEuros <= TWO_PAYMENTS_MAX ? 2 : 3;
}

export function computePropertyTax(input: PropertyTaxInput) {
  const errors: Partial<Record<PropertyTaxField, FieldError>> = {};
  const urban = input.kind === "urban";
  if (Number.isNaN(input.vpt)) errors.vpt = "required";
  else if (input.vpt < 0) errors.vpt = "negative";
  else if (input.vpt > PROPERTY_TAX_LIMITS.vpt) errors.vpt = "tooLarge";
  if (urban) {
    if (Number.isNaN(input.rate)) errors.rate = "required";
    else if (input.rate < URBAN_RATE_MIN || input.rate > URBAN_RATE_MAX) errors.rate = "rateRange";
    if (!(input.dependants in FAMILY_DEDUCTIONS)) errors.dependants = "dependants";
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const rate = urban ? input.rate : RUSTIC_RATE;
  // Rates have at most three decimals: work in thousandths of a percent to avoid float drift.
  const grossCents = Math.round((cents(input.vpt) * Math.round(rate * 1000)) / 100_000);
  const deductionCents = urban
    ? Math.min(grossCents, FAMILY_DEDUCTIONS[input.dependants as Dependants] * 100)
    : 0;
  const dueCents = grossCents - deductionCents;
  const belowMinimum = dueCents > 0 && dueCents < MINIMUM_COLLECTED * 100;
  const annualCents = belowMinimum ? 0 : dueCents;
  const count = instalmentCount(annualCents / 100);
  const base = count ? Math.floor(annualCents / count) : 0;
  const schedule = count
    ? MONTHS[count].map((month, index) => ({
        month,
        amount: (index === count - 1 ? annualCents - base * (count - 1) : base) / 100,
      }))
    : [];

  return {
    ok: true as const,
    result: {
      rate,
      grossTax: grossCents / 100,
      deduction: deductionCents / 100,
      annualTax: annualCents / 100,
      /** True when the tax is below the legal minimum and so is not assessed. */
      belowMinimum,
      monthlyProvision: Math.round(annualCents / 12) / 100,
      schedule,
    },
  };
}
