/**
 * Annual IUC (Portuguese vehicle circulation tax) for light passenger cars. Educational estimate only.
 *
 * Tables are the 2026 rates: the Código do IUC articles 9 and 10 in the wording of Lei n.º 82/2023
 * (no later amendment of the rates is listed on the Portal das Finanças as of the review date).
 * All amounts are integer cents.
 */

export const IUC_TABLES = {
  taxYear: 2026,
  reviewed: "2026-11-19",
  law: "Lei n.º 82/2023, de 29 de dezembro",
  /** Article 10(3): coefficients in hundredths, by year of first registration. */
  coefficients: { 2007: 100, 2008: 105, 2009: 110, 2010: 115 } as Record<number, number>,
  /** Article 10(1) table 1: cylinder capacity in cm3 (inclusive upper bound) and the rate in cents. */
  categoryBCylinder: [
    { upTo: 1250, cents: 3177 },
    { upTo: 1750, cents: 6374 },
    { upTo: 2500, cents: 12735 },
    { upTo: Infinity, cents: 43584 },
  ],
  /** Article 10(1) table 1: CO2 in g/km per test cycle (inclusive upper bound). */
  categoryBCo2: {
    nedc: [
      { upTo: 120, cents: 6515 },
      { upTo: 180, cents: 9763 },
      { upTo: 250, cents: 21204 },
      { upTo: Infinity, cents: 36325 },
    ],
    wltp: [
      { upTo: 140, cents: 6515 },
      { upTo: 205, cents: 9763 },
      { upTo: 260, cents: 21204 },
      { upTo: Infinity, cents: 36325 },
    ],
  },
  /** Article 10(2) table 2: additional rates for first registration after 1 January 2017. */
  categoryBAdditional: {
    nedc: [{ over: 250, cents: 6374 }, { over: 180, cents: 3177 }],
    wltp: [{ over: 260, cents: 6374 }, { over: 205, cents: 3177 }],
  },
  additionalFromYear: 2017,
  /** Article 9: category A, by year of first registration band. */
  categoryAGasoline: [
    { upTo: 1000, cents: { recent: 1990, mid: 1255, old: 880 } },
    { upTo: 1300, cents: { recent: 3995, mid: 2245, old: 1255 } },
    { upTo: 1750, cents: { recent: 6240, mid: 3487, old: 1749 } },
    { upTo: 2600, cents: { recent: 15831, mid: 8349, old: 3609 } },
    { upTo: 3500, cents: { recent: 28749, mid: 15654, old: 7972 } },
    { upTo: Infinity, cents: { recent: 51223, mid: 26311, old: 12090 } },
  ],
  categoryAOther: [
    { upTo: 1500, cents: { recent: 1990, mid: 1255, old: 880 } },
    { upTo: 2000, cents: { recent: 3995, mid: 2245, old: 1255 } },
    { upTo: 3000, cents: { recent: 6240, mid: 3487, old: 1749 } },
    { upTo: Infinity, cents: { recent: 15831, mid: 8349, old: 3609 } },
  ],
} as const;

export const VEHICLE_TAX_LIMITS = { cc: 10_000, co2: 1_000, firstYear: 1981, lastYear: 2026 } as const;
/** Category A covers first registrations from 1981 up to June 2007; category B starts in July 2007. */
export const CATEGORY_B_START = { year: 2007, month: 7 } as const;
/** From 2027 (Decreto-Lei n.º 161/2026) the tax is settled by April and paid in instalments: thresholds in euros. */
export const SINGLE_INSTALMENT_MAX = 100;
export const TWO_INSTALMENTS_MAX = 500;

export type VehicleFuel = "petrol" | "diesel" | "electric";
export type Co2Standard = "wltp" | "nedc";
export type VehicleTaxField = "cc" | "co2" | "year" | "month" | "fuel";
export type VehicleTaxCategory = "A" | "B";
type FieldError =
  | "required" | "zero" | "tooLarge" | "negative" | "year" | "yearTooOld" | "yearTooNew"
  | "month" | "electricCategoryA";

export interface VehicleTaxInput {
  fuel: VehicleFuel;
  /** Engine capacity in cm3. Ignored for electric cars. */
  cc: number;
  /** Official CO2 in g/km (category B only). Ignored for electric cars. */
  co2: number;
  standard: Co2Standard;
  /** Year and month of first registration. */
  year: number;
  month: number;
}

export const VEHICLE_TAX_EXAMPLE: VehicleTaxInput = {
  fuel: "diesel", cc: 1598, co2: 120, standard: "wltp", year: 2019, month: 3,
};

export type InstalmentMonth = 4 | 7 | 10;

export function instalmentMonths(annualEuros: number): InstalmentMonth[] {
  if (annualEuros <= 0) return [];
  if (annualEuros <= SINGLE_INSTALMENT_MAX) return [4];
  return annualEuros <= TWO_INSTALMENTS_MAX ? [4, 10] : [4, 7, 10];
}

const bandOf = <T extends { upTo: number }>(bands: readonly T[], value: number) =>
  bands.find((band) => value <= band.upTo) as T;

const checkNumber = (value: number, max: number): FieldError | undefined => {
  if (Number.isNaN(value)) return "required";
  if (value < 0) return "negative";
  if (value === 0) return "zero";
  return value > max ? "tooLarge" : undefined;
};

export function computeVehicleTax(input: VehicleTaxInput) {
  const errors: Partial<Record<VehicleTaxField, FieldError>> = {};
  const electric = input.fuel === "electric";
  const { year, month } = input;

  if (!Number.isInteger(year)) errors.year = "required";
  else if (year < VEHICLE_TAX_LIMITS.firstYear) errors.year = "yearTooOld";
  else if (year > VEHICLE_TAX_LIMITS.lastYear) errors.year = "yearTooNew";
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.month = "month";
  const isCategoryA =
    !errors.year && (year < CATEGORY_B_START.year || (year === CATEGORY_B_START.year && month < CATEGORY_B_START.month));

  if (!electric) {
    const ccError = checkNumber(input.cc, VEHICLE_TAX_LIMITS.cc);
    if (ccError) errors.cc = ccError;
    if (!isCategoryA && !errors.year) {
      const co2Error = checkNumber(input.co2, VEHICLE_TAX_LIMITS.co2);
      if (co2Error) errors.co2 = co2Error;
    }
  } else if (isCategoryA) {
    errors.fuel = "electricCategoryA";
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const category: VehicleTaxCategory = isCategoryA ? "A" : "B";
  let annualCents = 0;
  let exempt = false;
  let baseCents = 0;
  let additionalCents = 0;
  let coefficient = 1;

  if (category === "A") {
    const table = input.fuel === "petrol" ? IUC_TABLES.categoryAGasoline : IUC_TABLES.categoryAOther;
    const age = year > 1995 ? "recent" : year >= 1990 ? "mid" : "old";
    baseCents = bandOf(table, input.cc).cents[age];
    annualCents = baseCents;
  } else if (electric) {
    exempt = true;
  } else {
    const co2Table = IUC_TABLES.categoryBCo2[input.standard];
    baseCents = bandOf(IUC_TABLES.categoryBCylinder, input.cc).cents + bandOf(co2Table, input.co2).cents;
    if (year >= IUC_TABLES.additionalFromYear) {
      additionalCents =
        IUC_TABLES.categoryBAdditional[input.standard].find((band) => input.co2 > band.over)?.cents ?? 0;
    }
    const coefficientHundredths = IUC_TABLES.coefficients[Math.min(Math.max(year, 2007), 2010)];
    coefficient = coefficientHundredths / 100;
    annualCents = Math.round(((baseCents + additionalCents) * coefficientHundredths) / 100);
  }

  const months = instalmentMonths(annualCents / 100);
  const count = months.length;
  const share = count ? Math.floor(annualCents / count) : 0;
  return {
    ok: true as const,
    result: {
      category,
      exempt,
      coefficient,
      baseTax: baseCents / 100,
      additionalTax: additionalCents / 100,
      annualTax: annualCents / 100,
      monthlyProvision: Math.round(annualCents / 12) / 100,
      /** Month (1-12) the 2026 IUC is paid: the month of the registration anniversary. */
      dueMonth: month,
      /** From 2027: settled by April and paid in instalments. */
      schedule2027: months.map((m, index) => ({
        month: m,
        amount: (index === count - 1 ? annualCents - share * (count - 1) : share) / 100,
      })),
    },
  };
}
