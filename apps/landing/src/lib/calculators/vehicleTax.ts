/**
 * Annual IUC (Portuguese vehicle circulation tax) for light passenger cars. Educational estimate only.
 *
 * Tables are the 2026 rates: the Código do IUC articles 9 and 10 in the wording of Lei n.º 82/2023
 * (no later amendment of the rates is listed on the Portal das Finanças as of the review date).
 * All amounts are integer cents.
 */

export const IUC_TABLES = {
  taxYear: 2026,
  reviewed: "2026-11-20",
  law: "Lei n.º 82/2023, de 29 de dezembro",
  dieselSurchargeSource:
    "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/iuc/Pages/iuc-adicional-lei82-b-2014.aspx",
  /** Lei n.º 73-A/2025 (State Budget for 2026) in the Diário da República: art. 94 keeps the diesel surcharge. */
  budgetSource: "https://diariodarepublica.pt/dr/detalhe/lei/73-a-2025-993270096",
  schedule2027Source:
    "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/diplomas_legislativos/Documents/decreto-lei-161-2026.pdf",
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
  /**
   * Diesel "adicional de IUC" (Lei n.º 82-B/2014, art. 216), kept in force each year by the State Budget.
   * For 2026, art. 94 of Lei n.º 73-A/2025 ("Mantém-se em vigor o adicional de imposto único de circulação
   * (IUC) previsto no artigo 216.º da Lei n.º 82-B/2014", read in the Diário da República on 2026-11-20) keeps
   * it without changing the amounts. Diesel only, categories A and B, never multiplied by the year
   * coefficient. Amounts in cents, from tables I and II of art. 216 on the Portal das Finanças (2026-11-20).
   */
  dieselSurcharge: {
    categoryA: [
      { upTo: 1500, cents: { recent: 314, mid: 198, old: 139 } },
      { upTo: 2000, cents: { recent: 631, mid: 355, old: 198 } },
      { upTo: 3000, cents: { recent: 986, mid: 551, old: 276 } },
      { upTo: Infinity, cents: { recent: 2501, mid: 1319, old: 570 } },
    ],
    categoryB: [
      { upTo: 1250, cents: 502 },
      { upTo: 1750, cents: 1007 },
      { upTo: 2500, cents: 2012 },
      { upTo: Infinity, cents: 6885 },
    ],
  },
} as const;

export const VEHICLE_TAX_LIMITS = { cc: 10_000, co2: 1_000, firstYear: 1981, lastYear: 2026, otherIuc: 1_000_000 } as const;
/** Category A covers first registrations from 1981 up to June 2007; category B starts in July 2007. */
export const CATEGORY_B_START = { year: 2007, month: 7 } as const;
/**
 * Decreto-Lei n.º 161/2026 (4 August 2026, effective 1 January 2027): from 2028 the tax is settled by
 * April and paid in instalments, by these thresholds in euros of the taxpayer's total (art. 17(3)).
 * 2027 is transitional (art. 6): one payment in October up to 500 euros, otherwise July and October.
 */
export const SINGLE_INSTALMENT_MAX = 100;
export const TWO_INSTALMENTS_MAX = 500;

export type VehicleFuel = "petrol" | "diesel" | "electric";
export type Co2Standard = "wltp" | "nedc";
export type VehicleTaxField = "cc" | "co2" | "year" | "month" | "fuel" | "otherIucEuros";
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
  /**
   * Euros of IUC the taxpayer pays on all their other vehicles in the same year; 0 for none. The 2027 and 2028
   * instalments depend on the taxpayer's total across vehicles (Decreto-Lei n.º 161/2026, arts. 6(1) and 17(3)).
   */
  otherIucEuros: number;
}

export const VEHICLE_TAX_EXAMPLE: VehicleTaxInput = {
  fuel: "diesel", cc: 1598, co2: 120, standard: "wltp", year: 2019, month: 3, otherIucEuros: 0,
};

export type InstalmentMonth = 4 | 7 | 10;
export const TRANSITIONAL_2027_MAX = 500;

/** The 2027 transitional months (Decreto-Lei n.º 161/2026, art. 6(1)). */
export function transitionalMonths2027(annualEuros: number): InstalmentMonth[] {
  if (annualEuros <= 0) return [];
  return annualEuros <= TRANSITIONAL_2027_MAX ? [10] : [7, 10];
}

export function instalmentMonths(annualEuros: number): InstalmentMonth[] {
  if (annualEuros <= 0) return [];
  if (annualEuros <= SINGLE_INSTALMENT_MAX) return [4];
  return annualEuros <= TWO_INSTALMENTS_MAX ? [4, 10] : [4, 7, 10];
}

interface CategoryARow { upTo: number; cents: Record<"recent" | "mid" | "old", number> }
interface Band { upTo: number; cents: number }

function bandOf(bands: readonly Band[], value: number): Band;
function bandOf(bands: readonly CategoryARow[], value: number): CategoryARow;
function bandOf(bands: readonly { upTo: number }[], value: number) {
  return bands.find((band) => value <= band.upTo)!;
}

const checkNumber = (value: number, max: number): FieldError | undefined => {
  if (Number.isNaN(value)) return "required";
  if (value < 0) return "negative";
  if (value === 0) return "zero";
  return value > max ? "tooLarge" : undefined;
};

function otherIucError(value: number): FieldError | undefined {
  if (Number.isNaN(value)) return "required";
  if (value < 0) return "negative";
  return value > VEHICLE_TAX_LIMITS.otherIuc ? "tooLarge" : undefined;
}

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
  const otherError = otherIucError(input.otherIucEuros);
  if (otherError) errors.otherIucEuros = otherError;
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const category: VehicleTaxCategory = isCategoryA ? "A" : "B";
  let annualCents = 0;
  let exempt = false;
  let baseCents = 0;
  let additionalCents = 0;
  let dieselCents = 0;
  let coefficient = 1;

  if (category === "A") {
    const table: readonly CategoryARow[] =
      input.fuel === "petrol" ? IUC_TABLES.categoryAGasoline : IUC_TABLES.categoryAOther;
    const age = year > 1995 ? "recent" : year >= 1990 ? "mid" : "old";
    baseCents = bandOf(table, input.cc).cents[age];
    if (input.fuel === "diesel") dieselCents = bandOf(IUC_TABLES.dieselSurcharge.categoryA, input.cc).cents[age];
    annualCents = baseCents + dieselCents;
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
    if (input.fuel === "diesel") dieselCents = bandOf(IUC_TABLES.dieselSurcharge.categoryB, input.cc).cents;
    annualCents = Math.round(((baseCents + additionalCents) * coefficientHundredths) / 100) + dieselCents;
  }

  const otherCents = Math.round(input.otherIucEuros * 100);
  const totalCents = annualCents + otherCents;
  // The instalment months follow the taxpayer's total; the amounts are this car's share of each instalment.
  const split = (monthsFor: (totalEuros: number) => InstalmentMonth[]) => {
    const months = annualCents > 0 ? monthsFor(totalCents / 100) : [];
    const count = months.length;
    const share = count ? Math.floor(annualCents / count) : 0;
    return months.map((m, index) => ({
      month: m,
      amount: (index === count - 1 ? annualCents - share * (count - 1) : share) / 100,
    }));
  };
  return {
    ok: true as const,
    result: {
      category,
      exempt,
      coefficient,
      baseTax: baseCents / 100,
      additionalTax: additionalCents / 100,
      dieselSurcharge: dieselCents / 100,
      annualTax: annualCents / 100,
      /** This car plus the other IUC entered: what the instalment thresholds apply to. */
      totalAnnualTax: totalCents / 100,
      monthlyProvision: Math.round(annualCents / 12) / 100,
      /** Month (1-12) the 2026 IUC is paid: the month of the registration anniversary. */
      dueMonth: month,
      /** 2027, transitional: October, or July and October above 500 euros. */
      schedule2027: split(transitionalMonths2027),
      /** From 2028: settled by April and paid in April, July and October by instalment thresholds. */
      schedule2028: split(instalmentMonths),
    },
  };
}

/** One vehicle's own details: everything the per-car calculation reads except the taxpayer's other IUC. */
export type VehicleDetails = Omit<VehicleTaxInput, "otherIucEuros">;
export type VehicleTaxCalculation = ReturnType<typeof computeVehicleTax>;
/** The worked example's car, which is also what a newly added vehicle starts from. */
export const VEHICLE_DETAILS_EXAMPLE: VehicleDetails = {
  fuel: VEHICLE_TAX_EXAMPLE.fuel,
  cc: VEHICLE_TAX_EXAMPLE.cc,
  co2: VEHICLE_TAX_EXAMPLE.co2,
  standard: VEHICLE_TAX_EXAMPLE.standard,
  year: VEHICLE_TAX_EXAMPLE.year,
  month: VEHICLE_TAX_EXAMPLE.month,
};
/** How many vehicles the multi-vehicle mode accepts. */
export const MAX_VEHICLES = 10;

export interface PaymentMonth {
  month: number;
  /** Euros due that month for the vehicles listed. */
  amount: number;
  /** Indexes into the vehicles passed in, in input order. */
  vehicles: number[];
}

function groupByMonth(entries: { month: number; cents: number; vehicle: number }[]): PaymentMonth[] {
  const byMonth = new Map<number, { cents: number; vehicles: number[] }>();
  for (const entry of entries) {
    const group = byMonth.get(entry.month) ?? { cents: 0, vehicles: [] };
    group.cents += entry.cents;
    if (!group.vehicles.includes(entry.vehicle)) group.vehicles.push(entry.vehicle);
    byMonth.set(entry.month, group);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a - b)
    .map(([month, group]) => ({ month, amount: group.cents / 100, vehicles: group.vehicles }));
}

const toCents = (euros: number) => Math.round(euros * 100);

/**
 * IUC for every vehicle of one taxpayer. Each vehicle goes through computeVehicleTax unchanged; its other IUC is the
 * tax of the other vehicles listed plus `otherIucEuros` (vehicles the calculator cannot price), so the 2027 and 2028
 * instalment months follow the taxpayer's total (Decreto-Lei n.º 161/2026, arts. 6(1) and 17(3)). With one vehicle the
 * result is exactly computeVehicleTax({ ...vehicle, otherIucEuros }).
 */
export function computeVehicleTaxes(vehicles: readonly VehicleDetails[], otherIucEuros: number) {
  const otherError = otherIucError(otherIucEuros);
  const own = vehicles.map((vehicle) => computeVehicleTax({ ...vehicle, otherIucEuros: 0 }));
  const ownCents = own.map((calculation) => (calculation.ok ? toCents(calculation.result.annualTax) : 0));
  const listedCents = ownCents.reduce((sum, cents) => sum + cents, 0);
  const extraCents = otherError ? 0 : toCents(otherIucEuros);
  const results: VehicleTaxCalculation[] = vehicles.map((vehicle, index) =>
    own[index].ok
      ? computeVehicleTax({ ...vehicle, otherIucEuros: (listedCents - ownCents[index] + extraCents) / 100 })
      : own[index],
  );

  const valid = results.every((calculation) => calculation.ok);
  if (otherError || !valid || results.length === 0) {
    return { vehicles: results, otherIucError: otherError, summary: null };
  }
  const ok = results.flatMap((calculation, vehicle) => (calculation.ok ? [{ result: calculation.result, vehicle }] : []));
  const scheduled = (pick: (result: (typeof ok)[number]["result"]) => { month: number; amount: number }[]) =>
    groupByMonth(ok.flatMap(({ result, vehicle }) =>
      pick(result).map((row) => ({ month: row.month, cents: toCents(row.amount), vehicle })),
    ));
  return {
    vehicles: results,
    otherIucError: undefined,
    summary: {
      /** The vehicles listed. */
      annualTax: listedCents / 100,
      /** The vehicles listed plus the other IUC entered: what the instalment thresholds apply to. */
      totalAnnualTax: (listedCents + extraCents) / 100,
      monthlyProvision: Math.round(listedCents / 12) / 100,
      /** 2026: each vehicle in the month of its registration anniversary. Exempt vehicles pay nothing. */
      due2026: scheduled((result) => (result.annualTax > 0 ? [{ month: result.dueMonth, amount: result.annualTax }] : [])),
      schedule2027: scheduled((result) => result.schedule2027),
      schedule2028: scheduled((result) => result.schedule2028),
    },
  };
}
