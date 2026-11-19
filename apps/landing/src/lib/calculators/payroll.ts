/**
 * Portuguese payroll engine: monthly IRS withholding (retenção na fonte), employee Social Security
 * and the meal allowance exemption, in integer cents. Educational estimate only.
 *
 * Monthly withholding is an advance payment on account of the annual IRS, not the final tax: the
 * final IRS is settled in the annual return (Modelo 3), when deductions and the whole year's
 * income count. The tables here are dated, versioned data so a later year can add a new set
 * without touching the formulas. Christmas and holiday allowance pages can reuse
 * `computeWithholdingCents` and `computeNetSalary`.
 *
 * Not supported: IRS Jovem, the disability tables (IV to VII), pension tables (VIII to XI),
 * non-resident rules, and the one-off November 2026 adjustment (Despacho 12523-A/2026, which
 * halves the mainland withholding for income paid in that month only).
 */

export type PayrollRegion = "mainland" | "azores" | "madeira";
export type HolderStatus = "single" | "marriedOneEarner" | "marriedTwoEarners";
export type WithholdingTableId = "I" | "II" | "III";
export type MealAllowanceKind = "cash" | "card";
export type AllowanceSchedule = "fourteen" | "twelfths";

export const PAYROLL_REGIONS = ["mainland", "azores", "madeira"] as const satisfies readonly PayrollRegion[];
export const HOLDER_STATUSES = [
  "single", "marriedOneEarner", "marriedTwoEarners",
] as const satisfies readonly HolderStatus[];
export const WITHHOLDING_TABLE_IDS = ["I", "II", "III"] as const satisfies readonly WithholdingTableId[];

/** The parcela a abater of a row: a fixed amount, or the transition formula with the letter R. */
export type Parcela =
  | { readonly kind: "fixed"; readonly cents: number }
  /** rate × factor × (ceiling − R), the form used in the first rows of each table. */
  | { readonly kind: "transition"; readonly factorHundredths: number; readonly ceilingCents: number };

export interface WithholdingRow {
  /** Upper limit of the monthly remuneration (inclusive); null for the last row. */
  readonly upToCents: number | null;
  /** Marginal rate in basis points (1250 = 12.50%). */
  readonly rateBp: number;
  readonly parcela: Parcela;
}

export interface WithholdingTable {
  readonly id: WithholdingTableId | "VIII";
  /** Parcela adicional a abater per dependant, in cents. */
  readonly dependantParcelaCents: number;
  readonly rows: readonly WithholdingRow[];
}

export interface WithholdingTableSet {
  readonly region: PayrollRegion;
  readonly year: number;
  /** First and last day the tables apply to income paid, ISO dates. */
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  /** The act that approved the tables. */
  readonly act: string;
  readonly sourceUrl: string;
  readonly tables: Readonly<Record<WithholdingTableId, WithholdingTable>>;
}

type RowTuple = readonly [upTo: number | null, ratePercent: number, parcela: number | readonly [number, number]];

const toCents = (euros: number) => Math.round(euros * 100);

function buildTable(id: WithholdingTable["id"], dependantParcela: number, rows: readonly RowTuple[]): WithholdingTable {
  return {
    id,
    dependantParcelaCents: toCents(dependantParcela),
    rows: rows.map(([upTo, rate, parcela]) => ({
      upToCents: upTo === null ? null : toCents(upTo),
      rateBp: Math.round(rate * 100),
      parcela: typeof parcela === "number"
        ? { kind: "fixed", cents: toCents(parcela) }
        : { kind: "transition", factorHundredths: Math.round(parcela[0] * 100), ceilingCents: toCents(parcela[1]) },
    })),
  };
}

/** Parcela adicional por dependente: casado dois titulares (table I), não casado (II), casado único titular (III). */
const DEPENDANT_PARCELA = { I: 21.43, II: 34.29, III: 42.86 } as const;

type RowsByTable = Record<WithholdingTableId, readonly RowTuple[]>;

function buildSet(
  region: PayrollRegion, act: string, sourceUrl: string, rows: RowsByTable,
): WithholdingTableSet {
  return {
    region, year: 2026, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", act, sourceUrl,
    tables: {
      I: buildTable("I", DEPENDANT_PARCELA.I, rows.I),
      II: buildTable("II", DEPENDANT_PARCELA.II, rows.II),
      III: buildTable("III", DEPENDANT_PARCELA.III, rows.III),
    },
  };
}

// Rows are [upper limit of monthly remuneration, marginal rate in %, parcela a abater], copied from
// the annexes of the acts cited in each set. A pair [factor, ceiling] is the transition formula.
const MAINLAND_ROWS: RowsByTable = {
	I: [
		[920, 0, 0],
		[1042, 12.5, [2.6, 1273.85]],
		[1108, 15.7, [1.35, 1554.83]],
		[1154, 15.7, 94.71],
		[1212, 21.2, 158.18],
		[1819, 24.1, 193.33],
		[2119, 31.1, 320.66],
		[2499, 34.9, 401.19],
		[3305, 38.36, 487.66],
		[5547, 39.69, 531.62],
		[20221, 44.95, 823.4],
		[null, 47.17, 1272.31],
	],
	II: [
		[920, 0, 0],
		[1042, 12.5, [2.6, 1273.85]],
		[1108, 15.7, [1.35, 1554.83]],
		[1154, 15.7, 94.71],
		[1212, 21.2, 158.18],
		[1819, 24.1, 193.33],
		[2119, 31.1, 320.66],
		[2499, 34.9, 401.19],
		[3305, 38.36, 487.66],
		[5547, 39.69, 531.62],
		[20221, 44.95, 823.4],
		[null, 47.17, 1272.31],
	],
	III: [
		[991, 0, 0],
		[1042, 12.5, [2.6, 1372.15]],
		[1108, 12.5, [1.35, 1677.85]],
		[1119, 12.5, 96.17],
		[1432, 12.72, 98.64],
		[1962, 15.7, 141.32],
		[2240, 19.38, 213.53],
		[2773, 22.77, 289.47],
		[3389, 25.7, 370.72],
		[5965, 28.81, 476.12],
		[20265, 38.43, 1049.96],
		[null, 47.17, 2821.13],
	],
}

const AZORES_ROWS: RowsByTable = {
	I: [
		[966, 0, 0],
		[1042, 8.75, [2.6, 1337.54]],
		[1108, 10.99, [1.35, 1652.49]],
		[1154, 10.99, 80.79],
		[1212, 14.84, 125.22],
		[1819, 16.87, 149.83],
		[2119, 21.77, 238.97],
		[2499, 24.43, 295.34],
		[3305, 26.85, 355.82],
		[5547, 27.79, 386.89],
		[20221, 31.46, 590.47],
		[null, 33.02, 905.92],
	],
	II: [
		[966, 0, 0],
		[1042, 8.75, [2.6, 1337.54]],
		[1108, 10.99, [1.35, 1652.49]],
		[1154, 10.99, 80.79],
		[1212, 14.84, 125.22],
		[1819, 16.87, 149.83],
		[2119, 21.77, 238.97],
		[2499, 24.43, 295.34],
		[3305, 26.85, 355.82],
		[5547, 27.79, 386.89],
		[20221, 31.46, 590.47],
		[null, 33.02, 905.92],
	],
	III: [
		[1226, 0, 0],
		[1267, 7.28, 89.26],
		[1602, 9.64, 119.17],
		[1962, 10.99, 140.8],
		[2240, 13.57, 191.42],
		[2900, 15.94, 244.51],
		[3389, 17.99, 303.96],
		[5965, 20.17, 377.85],
		[20265, 27.1, 791.23],
		[null, 33.02, 1990.92],
	],
}

const MADEIRA_ROWS: RowsByTable = {
	I: [
		[980, 0, 0],
		[1028, 8.72, [2.6, 1356.92]],
		[1099, 12.04, [1.35, 1696.78]],
		[1201, 12.04, 97.17],
		[1623, 17.63, 164.31],
		[2332, 22.3, 240.11],
		[3203, 22.42, 242.91],
		[3614, 27.27, 398.26],
		[6585, 27.78, 416.7],
		[6954, 28.02, 432.51],
		[21411, 29.24, 517.35],
		[null, 32.78, 1275.3],
	],
	II: [
		[980, 0, 0],
		[1028, 8.72, [2.6, 1356.92]],
		[1099, 12.04, [1.35, 1696.78]],
		[1201, 12.04, 97.17],
		[1623, 17.63, 164.31],
		[2332, 22.3, 240.11],
		[3203, 22.42, 242.91],
		[3614, 27.27, 398.26],
		[6585, 27.78, 416.7],
		[6954, 28.02, 432.51],
		[21411, 29.24, 517.35],
		[null, 32.78, 1275.3],
	],
	III: [
		[997, 0, 0],
		[1099, 8.72, [1.35, 1819.64]],
		[1141, 8.72, 84.84],
		[1857, 10.33, 103.22],
		[2485, 10.91, 114],
		[3331, 12.36, 150.04],
		[3895, 14.04, 206.01],
		[6673, 15.95, 280.41],
		[6878, 22.13, 692.81],
		[21411, 24.93, 885.4],
		[null, 32.78, 2566.17],
	],
}

const PORTAL_TABLES_URL = "https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/tabela_ret_doclib/Pages/default.aspx";

export const WITHHOLDING_TABLE_SETS: Readonly<Record<PayrollRegion, WithholdingTableSet>> = {
  mainland: buildSet(
    "mainland",
    "Despacho n.º 233-A/2026, de 6 de janeiro",
    "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/Despachos_SEAF/Documents/Despacho-SEAF-2026-01-05-XXV.pdf",
    MAINLAND_ROWS,
  ),
  azores: buildSet("azores", "Despacho n.º 1179/2026, de 27 de janeiro", PORTAL_TABLES_URL, AZORES_ROWS),
  madeira: buildSet(
    "madeira",
    "Despacho n.º 19/2026, de 20 de janeiro (retificado pela Declaração de Retificação n.º 10/2026)",
    "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/instrucoes_administrativas/Documents/Circular_2_2026.pdf",
    MADEIRA_ROWS,
  ),
};

/**
 * Pension withholding table VIII (Despacho n.º 233-A/2026, n.º 1 c): pensions of an unmarried holder or a married
 * holder in a two-earner couple, without disability, mainland. Withholding is R x rate - parcela, with no Social
 * Security. Rows transcribed from the annex as reproduced by Maisvalias and checked against the effective-rate
 * column of the official table (the annex PDF text could not be extracted).
 */
const PENSION_TABLE_VIII = buildTable("VIII", DEPENDANT_PARCELA.II, [
  [920, 0, 0],
  [1042, 12.5, [2.6, 1320.92]],
  [1100, 15.7, [1.35, 1627.01]],
  [1133, 15.7, 111.7],
  [1239, 21.2, 174.02],
  [1869, 24.1, 209.96],
  [2114, 31.1, 340.79],
  [2361, 34.9, 421.13],
  [3462, 43.1, 614.74],
  [5833, 44.6, 666.67],
  [18_332, 50.5, 1010.82],
  [null, 53, 1469.12],
]);

/** Monthly IRS withholding on a pension of a single holder without dependants (table VIII), in cents. */
export function computePensionWithholdingCents(monthlyPensionCents: number): number {
  return computeTableWithholdingCents(PENSION_TABLE_VIII, monthlyPensionCents, 0);
}

/** Employee Social Security contribution (taxa contributiva dos trabalhadores), in basis points. */
export const EMPLOYEE_SOCIAL_SECURITY_BP = 1100;

/**
 * Meal allowance (subsídio de alimentação) exemption per day, in cents. The cash limit is the
 * public-sector reference value set by Portaria n.º 51-B/2026/1 (EUR 6.15); paid on a meal card
 * the limit is 70% higher, which is EUR 10.455.
 */
export const MEAL_ALLOWANCE_EXEMPT_PER_DAY_CENTS = { cash: 615, card: 615 * 1.7 } as const;

/** Three or more dependants take one percentage point off the marginal rate (Despacho 233-A/2026, n.º 5 h). */
export const MANY_DEPENDANTS_THRESHOLD = 3;
export const MANY_DEPENDANTS_RATE_REDUCTION_BP = 100;

/** Annual IRS brackets for 2026 income (CIRS art. 68(1), as amended by Decreto-Lei n.º 212/2026). */
export const ANNUAL_IRS_BRACKETS_2026 = [
  { upToCents: 834_200, rateBp: 1220 },
  { upToCents: 1_258_700, rateBp: 1520 },
  { upToCents: 1_783_800, rateBp: 2070 },
  { upToCents: 2_308_900, rateBp: 2360 },
  { upToCents: 2_939_700, rateBp: 3060 },
  { upToCents: 4_309_000, rateBp: 3460 },
  { upToCents: 4_656_600, rateBp: 4310 },
  { upToCents: 8_663_400, rateBp: 4460 },
  { upToCents: null, rateBp: 4800 },
] as const satisfies ReadonlyArray<{ upToCents: number | null; rateBp: number }>;

/** IRS on an annual taxable income (rendimento coletável) before deductions from tax, in cents. */
export function annualBracketTaxCents(taxableIncomeCents: number): number {
  let tax = 0;
  let lower = 0;
  for (const bracket of ANNUAL_IRS_BRACKETS_2026) {
    const upper = bracket.upToCents ?? Infinity;
    if (taxableIncomeCents > lower) tax += ((Math.min(taxableIncomeCents, upper) - lower) * bracket.rateBp) / 10_000;
    if (taxableIncomeCents <= upper) break;
    lower = upper;
  }
  return Math.round(tax);
}

export interface WithholdingContext {
  region: PayrollRegion;
  status: HolderStatus;
  dependants: number;
}

/** The table that applies: I for single without dependants and married with two earners, II for single with, III for married with one earner. */
export function selectWithholdingTableId(status: HolderStatus, dependants: number): WithholdingTableId {
  if (status === "marriedOneEarner") return "III";
  if (status === "single" && dependants > 0) return "II";
  return "I";
}

/** Index of the row a monthly remuneration (cents) falls in. */
export function findRowIndex(table: WithholdingTable, remunerationCents: number): number {
  const index = table.rows.findIndex((row) => row.upToCents === null || remunerationCents <= row.upToCents);
  return index === -1 ? table.rows.length - 1 : index;
}

/** The parcela a abater of a row at a remuneration, in cents (a float for the transition rows). */
export function parcelaCents(row: WithholdingRow, remunerationCents: number): number {
  if (row.parcela.kind === "fixed") return row.parcela.cents;
  return (row.rateBp / 10_000) * (row.parcela.factorHundredths / 100) * (row.parcela.ceilingCents - remunerationCents);
}

/** Withholding from one explicit table (see `computeWithholdingCents` for the table choice), in cents. */
export function computeTableWithholdingCents(table: WithholdingTable, remunerationCents: number, dependants: number): number {
  if (!Number.isFinite(remunerationCents) || remunerationCents <= 0) return 0;
  const row = table.rows[findRowIndex(table, remunerationCents)];
  const reduce = dependants >= MANY_DEPENDANTS_THRESHOLD && row.rateBp > 0;
  const rateBp = reduce ? row.rateBp - MANY_DEPENDANTS_RATE_REDUCTION_BP : row.rateBp;
  const gross = (remunerationCents * rateBp) / 10_000;
  const deduction = parcelaCents(row, remunerationCents) + table.dependantParcelaCents * dependants;
  return Math.max(0, Math.round(gross - deduction));
}

/**
 * The monthly IRS withholding for one remuneration, in cents, never below zero:
 * remuneration × marginal rate − parcela a abater − parcela adicional × dependants.
 */
export function computeWithholdingCents(remunerationCents: number, context: WithholdingContext): number {
  const table = WITHHOLDING_TABLE_SETS[context.region].tables[selectWithholdingTableId(context.status, context.dependants)];
  return computeTableWithholdingCents(table, remunerationCents, context.dependants);
}

export const PAYROLL_LIMITS = { grossMonthly: 100_000, mealDaily: 50, mealDays: 31, dependants: 10 } as const;

export type NetSalaryField = "grossMonthly" | "dependants" | "mealDaily" | "mealDays";
type FieldError = "required" | "tooSmall" | "tooLarge" | "whole";

export interface NetSalaryInput {
  /** Base gross monthly salary in euros, before allowances. */
  grossMonthly: number;
  region: PayrollRegion;
  status: HolderStatus;
  dependants: number;
  /** Meal allowance per working day in euros; 0 for none. */
  mealDaily: number;
  mealDays: number;
  mealKind: MealAllowanceKind;
  /** `fourteen`: holiday and Christmas allowances paid as two extra payments. `twelfths`: spread over 12 payments. */
  allowances: AllowanceSchedule;
}

export const NET_SALARY_EXAMPLE: NetSalaryInput = {
  grossMonthly: 1500, region: "mainland", status: "single", dependants: 0,
  mealDaily: 6.15, mealDays: 22, mealKind: "cash", allowances: "fourteen",
};

export interface PayrollPayment {
  /** Remuneration subject to withholding and Social Security. */
  taxableCents: number;
  withholdingCents: number;
  socialSecurityCents: number;
  netCents: number;
}

export interface NetSalaryResult {
  /** A regular monthly payment: salary, meal allowance and, in twelfths, the allowances. */
  monthly: PayrollPayment & { mealAllowanceCents: number; mealExemptCents: number; mealTaxableCents: number };
  /** One holiday or Christmas allowance payment, taxed on its own; null when paid in twelfths. */
  allowancePayment: PayrollPayment | null;
  annual: { grossCents: number; withholdingCents: number; socialSecurityCents: number; netCents: number };
}

export function validateNetSalary(input: NetSalaryInput): Partial<Record<NetSalaryField, FieldError>> {
  const errors: Partial<Record<NetSalaryField, FieldError>> = {};
  const check = (field: NetSalaryField, value: number, min: number, max: number, whole = false) => {
    if (Number.isNaN(value)) errors[field] = "required";
    else if (value < min) errors[field] = "tooSmall";
    else if (value > max) errors[field] = "tooLarge";
    else if (whole && !Number.isInteger(value)) errors[field] = "whole";
  };
  check("grossMonthly", input.grossMonthly, 0.01, PAYROLL_LIMITS.grossMonthly);
  check("dependants", input.dependants, 0, PAYROLL_LIMITS.dependants, true);
  check("mealDaily", input.mealDaily, 0, PAYROLL_LIMITS.mealDaily);
  check("mealDays", input.mealDays, 0, PAYROLL_LIMITS.mealDays, true);
  return errors;
}

export function computeNetSalary(input: NetSalaryInput) {
  const errors = validateNetSalary(input);
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const context: WithholdingContext = { region: input.region, status: input.status, dependants: input.dependants };
  const grossCents = toCents(input.grossMonthly);
  const twelfths = input.allowances === "twelfths";
  // Two allowances of one month's salary each, spread over 12 payments.
  const baseCents = twelfths ? Math.round((grossCents * 14) / 12) : grossCents;

  const mealDailyCents = toCents(input.mealDaily);
  const exemptDaily = Math.min(mealDailyCents, MEAL_ALLOWANCE_EXEMPT_PER_DAY_CENTS[input.mealKind]);
  const mealAllowanceCents = mealDailyCents * input.mealDays;
  const mealExemptCents = Math.round(exemptDaily * input.mealDays);
  const mealTaxableCents = mealAllowanceCents - mealExemptCents;

  const payment = (taxableCents: number, extraNetCents: number): PayrollPayment => {
    const withholdingCents = computeWithholdingCents(taxableCents, context);
    const socialSecurityCents = Math.round((taxableCents * EMPLOYEE_SOCIAL_SECURITY_BP) / 10_000);
    return {
      taxableCents, withholdingCents, socialSecurityCents,
      netCents: taxableCents + extraNetCents - withholdingCents - socialSecurityCents,
    };
  };

  const monthlyPayment = payment(baseCents + mealTaxableCents, mealExemptCents);
  // Each remuneration of a month is taxed on its own (Despacho 233-A/2026, n.º 10).
  const allowancePayment = twelfths ? null : payment(grossCents, 0);
  const count = twelfths ? 0 : 2;

  return {
    ok: true as const,
    result: {
      monthly: { ...monthlyPayment, mealAllowanceCents, mealExemptCents, mealTaxableCents },
      allowancePayment,
      annual: {
        grossCents: 12 * (baseCents + mealAllowanceCents) + count * grossCents,
        withholdingCents: 12 * monthlyPayment.withholdingCents + count * (allowancePayment?.withholdingCents ?? 0),
        socialSecurityCents: 12 * monthlyPayment.socialSecurityCents + count * (allowancePayment?.socialSecurityCents ?? 0),
        netCents: 12 * monthlyPayment.netCents + count * (allowancePayment?.netCents ?? 0),
      },
    } satisfies NetSalaryResult,
  };
}
