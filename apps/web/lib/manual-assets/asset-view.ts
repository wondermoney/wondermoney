import type { ManualAsset } from "@/lib/api/manual-asset/types";

/** A calendar day (`YYYY-MM-DD`) as a local date, so it never shifts a day in a negative-offset zone. */
export function calendarDay(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A local date as the `YYYY-MM-DD` the API expects. */
export function dayString(date: Date | undefined): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Assets that count today first, by name; archived ones apart. */
export function splitAssets<T extends Pick<ManualAsset, "archived" | "name">>(
  assets: T[],
): { active: T[]; archived: T[] } {
  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return {
    active: assets.filter((asset) => !asset.archived).sort(byName),
    archived: assets.filter((asset) => asset.archived).sort(byName),
  };
}

/**
 * How far today's value is from the purchase price, in the asset's currency.
 * Null without both figures; `percent` is null for a purchase price of zero.
 */
export function changeSincePurchase(
  asset: Pick<ManualAsset, "purchasePrice" | "value">,
): { amount: number; percent: number | null } | null {
  if (asset.value === null || asset.purchasePrice === null) return null;
  const amount = asset.value - asset.purchasePrice;
  return {
    amount,
    percent: asset.purchasePrice === 0 ? null : amount / asset.purchasePrice,
  };
}

/** Today's value comes from the growth rule, not straight from a valuation. */
export function isEstimated(
  asset: Pick<ManualAsset, "growthRule" | "lastValuation" | "value">,
): boolean {
  return (
    asset.growthRule !== null &&
    asset.value !== null &&
    asset.lastValuation !== null &&
    asset.value !== asset.lastValuation.value
  );
}

export interface ValuePoint {
  date: string;
  value: number;
}

/**
 * The history as a chart draws it. A value holds until the next valuation, so
 * each change gets a point the day before at the old value: the line steps
 * instead of ramping. With a growth rule the value really does move between
 * points, so the series is drawn as it comes.
 */
export function chartPoints(
  history: ValuePoint[],
  options: { stepped: boolean },
): ValuePoint[] {
  if (!options.stepped) return history;
  const points: ValuePoint[] = [];
  history.forEach((point, index) => {
    const previous = history[index - 1];
    if (previous && previous.value !== point.value) {
      const dayBefore = calendarDay(point.date);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const date = dayString(dayBefore);
      if (date > previous.date) points.push({ date, value: previous.value });
    }
    points.push(point);
  });
  return points;
}
