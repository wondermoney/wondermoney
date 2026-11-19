/**
 * Portuguese property purchase taxes: IMT (CIMT art. 17) and Imposto do Selo.
 *
 * The table is versioned by tax year. Limits and rates are those of the CIMT as updated for
 * 2026 (Lei n.º 73-A/2025, Orçamento do Estado 2026), checked on 2026-11-19 against Ofício
 * Circulado 40129/2026 (tables I to VI, mainland and Azores/Madeira). Update PURCHASE_TAXES_TABLE and its review date each year.
 *
 * Money is handled in integer cents. IMT and Imposto do Selo are each rounded to the cent,
 * as the AT assesses them.
 */
export const PURCHASE_TAXES_TABLE = {
  year: 2026,
  reviewedOn: "2026-11-19",
  sources: {
    cimt: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cimt/Pages/cimt17.aspx",
    circular: "https://at.madeira.gov.pt/ficheiros/Oficio_circulado_40129_2026.pdf",
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
interface Band {
  /** Upper limit in whole euros, inclusive. */
  upTo: number;
  rateBp: number;
  /** Progressive bands subtract a "parcela a abater"; the others tax the whole value. */
  progressive: boolean;
}

type HomeUse = "ownPermanent" | "secondary";
type Table = Record<HomeUse, Band[]>;

/** Tables I and III of Ofício Circulado 40129/2026 (6 January 2026). */
const MAINLAND_BANDS: Table = {
  ownPermanent: [
    { upTo: 106_346, rateBp: 0, progressive: true },
    { upTo: 145_470, rateBp: 200, progressive: true },
    { upTo: 198_347, rateBp: 500, progressive: true },
    { upTo: 330_539, rateBp: 700, progressive: true },
    { upTo: 660_982, rateBp: 800, progressive: true },
    { upTo: 1_150_853, rateBp: 600, progressive: false },
    { upTo: Infinity, rateBp: 750, progressive: false },
  ],
  secondary: [
    { upTo: 106_346, rateBp: 100, progressive: true },
    { upTo: 145_470, rateBp: 200, progressive: true },
    { upTo: 198_347, rateBp: 500, progressive: true },
    { upTo: 330_539, rateBp: 700, progressive: true },
    { upTo: 633_931, rateBp: 800, progressive: true },
    { upTo: 1_150_853, rateBp: 600, progressive: false },
    { upTo: Infinity, rateBp: 750, progressive: false },
  ],
};

/** Tables IV and VI of the same circular, for the Azores and Madeira (Lei 21/90). */
const ISLANDS_BANDS: Table = {
  ownPermanent: [
    { upTo: 132_933, rateBp: 0, progressive: true },
    { upTo: 181_838, rateBp: 200, progressive: true },
    { upTo: 247_934, rateBp: 500, progressive: true },
    { upTo: 413_174, rateBp: 700, progressive: true },
    { upTo: 826_228, rateBp: 800, progressive: true },
    { upTo: 1_438_566, rateBp: 600, progressive: false },
    { upTo: Infinity, rateBp: 750, progressive: false },
  ],
  secondary: [
    { upTo: 132_933, rateBp: 100, progressive: true },
    { upTo: 181_838, rateBp: 200, progressive: true },
    { upTo: 247_934, rateBp: 500, progressive: true },
    { upTo: 413_174, rateBp: 700, progressive: true },
    { upTo: 792_414, rateBp: 800, progressive: true },
    { upTo: 1_438_566, rateBp: 600, progressive: false },
    { upTo: Infinity, rateBp: 750, progressive: false },
  ],
};

const bandsFor = (use: HomeUse, region: Region) =>
  (region === "islands" ? ISLANDS_BANDS : MAINLAND_BANDS)[use];

/** Young-buyer tables II and V: full exemption limit, then 8% on the excess up to the partial limit. */
const YOUNG_LIMITS_BY_REGION: Record<Region, { full: number; partial: number }> = {
  mainland: { full: 330_539, partial: 660_982 },
  islands: { full: 413_174, partial: 826_228 },
};
const YOUNG_PARTIAL_BP = 800;

export const YOUNG_LIMITS = (region: Region) => ({ ...YOUNG_LIMITS_BY_REGION[region] });

export function ownPermanentExemptionLimit(region: Region) {
  return bandsFor("ownPermanent", region)[0].upTo;
}

const centsOf = (euros: number) => Math.round(euros * 100);
const taxCents = (valueCents: number, rateBp: number) => Math.round((valueCents * rateBp) / BP);

/** The IMT "parcela a abater" of each progressive band, in cents, derived from the limits. */
export function imtBands(use: HomeUse, region: Region) {
  const bands = bandsFor(use, region);
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
      // The stamp duty exemption is a deduction capped at 0.8% of the full-exemption limit.
      stamp = stampFull - taxCents(limits.full * 100, STAMP_PURCHASE_BP);
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
