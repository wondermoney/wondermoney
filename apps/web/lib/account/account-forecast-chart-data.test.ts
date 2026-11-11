import { describe, expect, it } from "vitest";

import { mergeForecastIntoChartData } from "./account-forecast-chart-data";
import type { ChartDataPoint } from "./account-transactions-chart-data";

const point = (year: number, month: number, day: number, balance: number): ChartDataPoint => ({
  x: new Date(year, month, day, 23, 59, 59, 999),
  balance,
  dailyAmount: 0,
});

const forecast = (currency: string, points: { balance: number; date: string }[]) => ({ currency, points });

describe("mergeForecastIntoChartData", () => {
  it("anchors the dashed line on the last historical point and appends the forecast days", () => {
    const merged = mergeForecastIntoChartData(
      [point(2026, 2, 1, 1000), point(2026, 2, 2, 950)],
      forecast("EUR", [
        { balance: 950, date: "2026-03-02" },
        { balance: 900, date: "2026-03-03" },
        { balance: 850, date: "2026-03-04" },
      ]),
      "EUR",
    );

    expect(merged).toHaveLength(4);
    expect(merged[0]).toMatchObject({ balance: 1000, projectedBalance: null });
    expect(merged[1]).toMatchObject({ balance: 950, projectedBalance: 950 });
    expect(merged[2]).toMatchObject({ balance: null, projectedBalance: 900 });
    expect(merged[3]).toMatchObject({ balance: null, projectedBalance: 850 });
    expect(merged[2]!.x.getFullYear()).toBe(2026);
    expect(merged[2]!.x.getMonth()).toBe(2);
    expect(merged[2]!.x.getDate()).toBe(3);
  });

  it("leaves the chart alone when the forecast is in another currency", () => {
    const data = [point(2026, 2, 1, 1000), point(2026, 2, 2, 950)];
    const merged = mergeForecastIntoChartData(
      data,
      forecast("USD", [{ balance: 900, date: "2026-03-03" }]),
      "EUR",
    );

    expect(merged).toEqual(data.map((item) => ({ ...item, projectedBalance: null })));
  });

  it("leaves the chart alone without a forecast", () => {
    const data = [point(2026, 2, 1, 1000)];
    expect(mergeForecastIntoChartData(data, null, "EUR")).toEqual([
      { ...data[0], projectedBalance: null },
    ]);
  });
});
