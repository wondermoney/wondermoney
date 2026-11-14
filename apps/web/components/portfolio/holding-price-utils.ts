import type { HoldingPricePoint, HoldingPriceProvider } from "@/lib/api/portfolio/useHoldingPriceOverrides";

/** Provider names are brands, shown as written in every language. */
const PROVIDER_NAMES: Record<HoldingPriceProvider, string> = { coingecko: "CoinGecko", eodhd: "EODHD", stooq: "Stooq" };

export function isIsoCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function parsePositivePrice(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The days that carry a manual price of their own (not ones that inherit an earlier one). */
export function getManualPriceDates(points: HoldingPricePoint[]) {
  return new Set(points.filter((point) => point.source === "manual").map((point) => point.date));
}

export interface HoldingPriceChartRow {
  date: string;
  /** Set only on a manual day, so the chart draws a marker there and nowhere else. */
  manual: number | null;
  price: number;
}

export function toHoldingPriceChartRows(points: HoldingPricePoint[]): HoldingPriceChartRow[] {
  return points.map((point) => ({
    date: point.date,
    manual: point.source === "manual" ? point.price : null,
    price: point.price,
  }));
}

/** The providers the market prices came from, most recent first, by name. Empty when none is recorded. */
export function getMarketPriceProviderNames(points: HoldingPricePoint[]): string[] {
  const names: string[] = [];
  for (const point of [...points].reverse()) {
    if (point.source !== "market" || !point.provider) continue;
    const name = PROVIDER_NAMES[point.provider] ?? point.provider;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
