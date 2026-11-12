import type { HoldingPricePoint } from "@/lib/api/portfolio/useHoldingPriceOverrides";

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
