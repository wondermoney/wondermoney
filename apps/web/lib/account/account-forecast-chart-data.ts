import type { ForecastPoint } from "@/lib/api/account/useAccountForecast";
import { localCalendarDay } from "@/lib/utils/transaction-date";

import type { ChartDataPoint } from "./account-transactions-chart-data";

/** A historical chart point plus the projected balance that starts after today. */
export interface ForecastChartPoint extends Omit<ChartDataPoint, "balance"> {
  /** Null on a projected-only row: the solid area stops at today. */
  balance: number | null;
  /** Null before today; the projected balance from today on, drawn as a dashed line. */
  projectedBalance: number | null;
}

/**
 * Merge the forecast's daily balances into the historical chart data.
 *
 * The dashed line is anchored on the last historical point (today) when the forecast has that
 * day, then continues one point per forecast day. It is only merged when the forecast is in the
 * chart's currency: a projected figure in another currency would be a different number drawn on
 * the same axis, so it is left out rather than misread.
 */
export function mergeForecastIntoChartData(
  data: ChartDataPoint[],
  forecast: { currency: string; points: ForecastPoint[] } | null | undefined,
  chartCurrency: string,
): ForecastChartPoint[] {
  const merged: ForecastChartPoint[] = data.map((point) => ({
    ...point,
    projectedBalance: null,
  }));
  if (!forecast || forecast.currency !== chartCurrency || forecast.points.length === 0) {
    return merged;
  }

  const last = merged.at(-1);
  const lastDay = last ? localCalendarDay(last.x) : null;
  const anchorIndex = lastDay
    ? forecast.points.findIndex((point) => point.date === lastDay)
    : -1;
  const anchor = anchorIndex >= 0 ? forecast.points[anchorIndex] : undefined;
  if (last && anchor) {
    last.projectedBalance = anchor.balance;
  }

  for (let index = anchorIndex + 1; index < forecast.points.length; index += 1) {
    const point = forecast.points[index];
    if (!point) continue;
    merged.push({
      x: forecastPointDate(point.date),
      balance: null,
      dailyAmount: 0,
      projectedBalance: point.balance,
    });
  }
  return merged;
}

/** Local noon of a `YYYY-MM-DD` day, so it formats as that day in every time zone. */
export function forecastPointDate(date: string): Date {
  return new Date(`${date}T12:00:00`);
}
