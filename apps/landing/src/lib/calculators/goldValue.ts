import { GOLD_PRICES, GOLD_PRICE_SOURCE, type GoldPriceRow } from "./data/goldPrice";

export { GOLD_PRICES, GOLD_PRICE_SOURCE };
export type { GoldPriceRow };

export const TROY_OUNCE_GRAMS = 31.1034768;

/**
 * The legal finenesses of gold in Portugal, in thousandths, and the karats they are sold as. 24k is
 * hallmarked 999 (pure gold is never quite 1000), and 19.2k (800) is "ouro português", the usual
 * fineness of Portuguese jewellery.
 */
export const GOLD_PURITIES = [
  { id: "k24", karat: 24, fineness: 999 },
  { id: "k22", karat: 22, fineness: 916 },
  { id: "k19_2", karat: 19.2, fineness: 800 },
  { id: "k18", karat: 18, fineness: 750 },
  { id: "k14", karat: 14, fineness: 585 },
  { id: "k9", karat: 9, fineness: 375 },
] as const;
export type GoldPurity = (typeof GOLD_PURITIES)[number]["id"];

export const GOLD_LIMITS = {
  /** 100 kg. */
  grams: 100_000,
  /** Euro per gram of pure gold. */
  price: 10_000,
  /** Euro. */
  offer: 1_000_000_000,
} as const;

export type GoldValueInput = {
  grams: number;
  purity: GoldPurity;
  /** Euro per gram of pure gold. */
  price: number;
  /** What a buyer offers, in euro; NaN when not entered. */
  offer: number;
};
export type GoldValueField = "grams" | "price" | "offer";
type FieldError = "required" | "negative" | "tooLarge" | "zero";

export type GoldValueResult = {
  /** Grams of pure gold in the piece. */
  pureGrams: number;
  /** Euro, to the cent. */
  value: number;
  /** The offer as a percentage of the metal value, or null without an offer or a value. */
  offerShare: number | null;
  /** Metal value minus the offer, in euro, or null without an offer. */
  offerGap: number | null;
};
export type GoldValueOutcome =
  | { ok: true; result: GoldValueResult }
  | { ok: false; errors: Partial<Record<GoldValueField, FieldError>> };

export type LatestGoldPrice = { date: string; eurPerGram: number; eurPerOunce: number };

export function latestGoldPrice(rows: readonly GoldPriceRow[] = GOLD_PRICES): LatestGoldPrice {
  const [date, , , eurPerGram] = rows[rows.length - 1];
  return { date, eurPerGram, eurPerOunce: eurPerGram * TROY_OUNCE_GRAMS };
}

export type GoldPriceSummary = LatestGoldPrice & {
  previousDate: string;
  dayChangePercent: number;
  firstDate: string;
  periodChangePercent: number;
};

/** The latest price with its change against the day before and the oldest day kept. */
export function goldPriceSummary(rows: readonly GoldPriceRow[] = GOLD_PRICES): GoldPriceSummary {
  if (rows.length < 2) throw new Error("Need two days of gold prices");
  const latest = latestGoldPrice(rows);
  const previous = rows[rows.length - 2];
  const first = rows[0];
  return {
    ...latest,
    previousDate: previous[0],
    dayChangePercent: (latest.eurPerGram / previous[3] - 1) * 100,
    firstDate: first[0],
    periodChangePercent: (latest.eurPerGram / first[3] - 1) * 100,
  };
}

/** Worked example: 10 g of Portuguese gold (19.2k) at the latest price, no offer. */
export function goldValueExample(): GoldValueInput {
  return { grams: 10, purity: "k19_2", price: latestGoldPrice().eurPerGram, offer: Number.NaN };
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function computeGoldValue(input: GoldValueInput): GoldValueOutcome {
  const errors: Partial<Record<GoldValueField, FieldError>> = {};
  const check = (field: GoldValueField, { allowZero, optional = false }: { allowZero: boolean; optional?: boolean }) => {
    const value = input[field];
    if (Number.isNaN(value) && optional) return;
    if (!Number.isFinite(value)) errors[field] = "required";
    else if (value < 0) errors[field] = "negative";
    else if (value === 0 && !allowZero) errors[field] = "zero";
    else if (value > GOLD_LIMITS[field]) errors[field] = "tooLarge";
  };
  check("grams", { allowZero: true });
  check("price", { allowZero: false });
  check("offer", { allowZero: true, optional: true });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const purity = GOLD_PURITIES.find((candidate) => candidate.id === input.purity) ?? GOLD_PURITIES[0];
  const pureGrams = (input.grams * purity.fineness) / 1000;
  const value = cents(pureGrams * input.price);
  const hasOffer = Number.isFinite(input.offer);
  return {
    ok: true,
    result: {
      pureGrams,
      value,
      offerShare: hasOffer && value > 0 ? (input.offer / value) * 100 : null,
      offerGap: hasOffer ? cents(value - input.offer) : null,
    },
  };
}
