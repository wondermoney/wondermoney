/**
 * Portuguese property purchase taxes: IMT (CIMT art. 17) and Imposto do Selo.
 *
 * The table is versioned by tax year. Limits and rates are those of the CIMT as updated for
 * 2026 (Lei n.º 73-A/2025, Orçamento do Estado 2026), read from the Autoridade Tributária's
 * published CIMT text. Update PURCHASE_TAXES_TABLE and its review date each year.
 *
 * Money is handled in integer cents. IMT and Imposto do Selo are each rounded to the cent,
 * as the AT assesses them.
 */
export const PURCHASE_TAXES_TABLE = {
  year: 2026,
  reviewedOn: "2026-11-19",
  sources: {
    cimt: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cimt/Pages/cimt17.aspx",
    stampDuty: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cis/Pages/cis.aspx",
  },
} as const;

export const REGIONS = ["mainland", "islands"] as const;
export const USES = ["ownPermanent", "secondary", "rustic", "otherUrban"] as const;
export type Region = (typeof REGIONS)[number];
export type Use = (typeof USES)[number];

/** Rates in basis points (1% = 100) so the arithmetic stays integral. */
const BP = 10_000;
export const STAMP_PURCHASE_BP = 80;
export const STAMP_LOAN_BP = 60;
const RUSTIC_BP = 500;
const OTHER_URBAN_BP = 650;
/** Autonomous regions use the same rates with limits 25% higher, rounded to the euro. */
const ISLANDS_FACTOR = 1.25;

interface Band {
  /** Upper limit in whole euros, inclusive. */
  upTo: number;
  rateBp: number;
  /** Progressive bands subtract a "parcela a abater"; the others tax the whole value. */
  progressive: boolean;
}

const MAINLAND_BANDS: Record<"ownPermanent" | "secondary", Band[]> = {
  ownPermanent: [
    { upTo: 106_346, rateBp: 0, progressive: true },
    { upTo: 145_470, rateBp: 200, progressive: true },
    { upTo: 198_347, rateBp: 500, progressive: true },
    { upTo: 330_539, rateBp: 700, progressive: true },
    { upTo: 660_982, rateBp: 800, progressive: false },
    { upTo: 1_150_853, rateBp: 600, progressive: false },
    { upTo: Infinity, rateBp: 750, progressive: false },
  ],
  secondary: [
    { upTo: 106_346, rateBp: 100, progressive: true },
    { upTo: 145_470, rateBp: 200, progressive: true },
    { upTo: 198_347, rateBp: 500, progressive: true },
    { upTo: 330_539, rateBp: 700, progressive: true },
    { upTo: 633_931, rateBp: 800, progressive: false },
    { upTo: 1_150_853, rateBp: 600, progressive: false },
    { upTo: Infinity, rateBp: 750, progressive: false },
  ],
};

const YOUNG_FULL_LIMIT = 330_539;
const YOUNG_PARTIAL_LIMIT = 660_982;
const YOUNG_PARTIAL_BP = 800;

const scale = (euros: number, region: Region) =>
  region === "islands" && Number.isFinite(euros) ? Math.round(euros * ISLANDS_FACTOR) : euros;

export const YOUNG_LIMITS = (region: Region) => ({
  full: scale(YOUNG_FULL_LIMIT, region),
  partial: scale(YOUNG_PARTIAL_LIMIT, region),
});

export function ownPermanentExemptionLimit(region: Region) {
  return scale(MAINLAND_BANDS.ownPermanent[0].upTo, region);
}

const centsOf = (euros: number) => Math.round(euros * 100);
const taxCents = (valueCents: number, rateBp: number) => Math.round((valueCents * rateBp) / BP);

/** The IMT "parcela a abater" of each progressive band, in cents, derived from the limits. */
export function imtBands(use: "ownPermanent" | "secondary", region: Region) {
  const bands = MAINLAND_BANDS[use].map((band) => ({ ...band, upTo: scale(band.upTo, region) }));
  let taxAtLower = 0;
  let lower = 0;
  return bands.map((band) => {
    const deductCents = band.progressive ? taxCents(lower * 100, band.rateBp) - taxAtLower : 0;
    const row = { ...band, lower, deductCents };
    if (band.progressive && Number.isFinite(band.upTo)) {
      taxAtLower = taxCents(band.upTo * 100, band.rateBp) - deductCents;
    }
    lower = band.upTo;
    return row;
  });
}

/** IMT in cents for a reference value in cents, before any exemption. */
export function imtCents(valueCents: number, use: Use, region: Region) {
  if (valueCents <= 0) return 0;
  if (use === "rustic") return taxCents(valueCents, RUSTIC_BP);
  if (use === "otherUrban") return taxCents(valueCents, OTHER_URBAN_BP);
  const band = imtBands(use, region).find((row) => valueCents <= row.upTo * 100);
  if (!band) return 0;
  return Math.max(0, taxCents(valueCents, band.rateBp) - band.deductCents);
}

export const PURCHASE_TAXES_LIMITS = {
  price: 100_000_000,
  taxValue: 100_000_000,
  loan: 100_000_000,
} as const;

export type PurchaseTaxesNumberField = keyof typeof PURCHASE_TAXES_LIMITS;

export interface PurchaseTaxesInput {
  price: number;
  /** Patrimonial tax value (VPT); 0 when unknown. The higher of price and VPT is taxed. */
  taxValue: number;
  /** Mortgage amount; 0 for a cash purchase. */
  loan: number;
  region: Region;
  use: Use;
  /** Eligibility toggle for the young-buyer exemption. Ignored unless use is ownPermanent. */
  young: boolean;
}

export const PURCHASE_TAXES_EXAMPLE: PurchaseTaxesInput = {
  price: 250_000,
  taxValue: 0,
  loan: 200_000,
  region: "mainland",
  use: "ownPermanent",
  young: false,
};

type FieldError = "required" | "negative" | "tooLarge" | "loan";

export function computePurchaseTaxes(input: PurchaseTaxesInput) {
  const errors: Partial<Record<PurchaseTaxesNumberField, FieldError>> = {};
  for (const field of Object.keys(PURCHASE_TAXES_LIMITS) as PurchaseTaxesNumberField[]) {
    const value = input[field];
    if (Number.isNaN(value)) errors[field] = "required";
    else if (value < 0) errors[field] = "negative";
    else if (value > PURCHASE_TAXES_LIMITS[field]) errors[field] = "tooLarge";
  }
  if (!errors.price && !errors.loan && centsOf(input.loan) > centsOf(input.price)) {
    errors.loan = "loan";
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const referenceCents = Math.max(centsOf(input.price), centsOf(input.taxValue));
  const imtFull = imtCents(referenceCents, input.use, input.region);
  const stampFull = taxCents(referenceCents, STAMP_PURCHASE_BP);
  const stampLoan = taxCents(centsOf(input.loan), STAMP_LOAN_BP);

  let imt = imtFull;
  let stamp = stampFull;
  let exemption: "none" | "full" | "partial" = "none";
  if (input.young && input.use === "ownPermanent") {
    const limits = YOUNG_LIMITS(input.region);
    if (referenceCents <= limits.full * 100) {
      imt = 0;
      stamp = 0;
      exemption = "full";
    } else if (referenceCents <= limits.partial * 100) {
      imt = taxCents(referenceCents - limits.full * 100, YOUNG_PARTIAL_BP);
      exemption = "partial";
    }
  }

  const total = imt + stamp + stampLoan;
  return {
    ok: true as const,
    result: {
      reference: referenceCents / 100,
      imt: imt / 100,
      stampPurchase: stamp / 100,
      stampLoan: stampLoan / 100,
      total: total / 100,
      /** Total as a share of the reference value, in percent. */
      effectiveRate: referenceCents > 0 ? (total / referenceCents) * 100 : 0,
      exemption,
      youngSaving: (imtFull + stampFull - imt - stamp) / 100,
    },
  };
}
