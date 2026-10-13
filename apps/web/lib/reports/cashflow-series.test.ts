import assert from "node:assert/strict";

import { test } from "vitest";

import type { CashflowPoint } from "@/lib/api/reports/types";

import {
  buildCashflowSeries,
  findPartialMonth,
  getTrailingNetAverage,
} from "./cashflow-series";

/** A row exactly as the API emits it: UTC first-of-month. */
function apiPoint(
  year: number,
  month: number,
  income: number,
  expenses: number,
): CashflowPoint {
  return {
    month: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    income,
    expenses,
    net: income - expenses,
  };
}

/** Local first-of-month, matching how the filter envelope is serialised. */
function local(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
): string {
  return new Date(
    year,
    month - 1,
    day,
    hours,
    minutes,
    seconds,
    ms,
  ).toISOString();
}

const NOW = new Date(2026, 7, 20, 14, 0, 0);
const FULL_RANGE = {
  fromDate: local(2026, 5, 1),
  toDate: local(2026, 8, 31, 23, 59, 59, 999),
};

test("months outside the selected period are dropped from the series", () => {
  const series = buildCashflowSeries(
    [
      apiPoint(2026, 3, 900, 400),
      apiPoint(2026, 6, 2000, 1200),
      apiPoint(2026, 7, 2100, 1300),
      apiPoint(2026, 12, 5000, 100),
    ],
    {
      fromDate: local(2026, 6, 1),
      toDate: local(2026, 7, 31, 23, 59, 59, 999),
    },
    NOW,
  );

  assert.deepEqual(
    series.map((point) => point.monthKey),
    ["2026-06", "2026-07"],
  );
});

test("an in-period month with no data is a null gap, not a zero", () => {
  const series = buildCashflowSeries(
    [apiPoint(2026, 5, 3000, 1000), apiPoint(2026, 7, 3200, 1100)],
    FULL_RANGE,
    NOW,
  );

  assert.deepEqual(
    series.map((point) => point.monthKey),
    ["2026-05", "2026-06", "2026-07"],
  );

  const june = series[1];
  assert.equal(june.hasData, false);
  assert.equal(june.income, null);
  assert.equal(june.expenses, null);
  assert.equal(june.net, null);
});

test("a month that genuinely nets to zero still plots as zero", () => {
  const series = buildCashflowSeries(
    [
      apiPoint(2026, 5, 3000, 1000),
      apiPoint(2026, 6, 1500, 1500),
      apiPoint(2026, 7, 3200, 1100),
    ],
    FULL_RANGE,
    NOW,
  );

  const june = series[1];
  assert.equal(june.hasData, true);
  assert.equal(june.net, 0);
  assert.equal(june.income, 1500);
  assert.equal(june.expenses, 1500);
});

test("a month of literal zeroes is data, and stays distinct from a gap", () => {
  const series = buildCashflowSeries(
    [
      apiPoint(2026, 5, 3000, 1000),
      apiPoint(2026, 6, 0, 0),
      apiPoint(2026, 7, 3200, 1100),
    ],
    FULL_RANGE,
    NOW,
  );

  assert.equal(series[1].hasData, true);
  assert.equal(series[1].net, 0);
  assert.equal(series[1].income, 0);
});

test("the current month is flagged partial and named as the current month", () => {
  const series = buildCashflowSeries(
    [apiPoint(2026, 7, 3200, 1100), apiPoint(2026, 8, 1400, 900)],
    {
      fromDate: local(2026, 7, 1),
      toDate: local(2026, 8, 20, 23, 59, 59, 999),
    },
    NOW,
  );

  const july = series[0];
  const august = series[1];

  assert.equal(july.isPartial, false);
  assert.equal(july.isCurrentMonth, false);
  assert.equal(august.isPartial, true);
  assert.equal(august.isCurrentMonth, true);
  assert.equal(august.net, 500);
});

test("a boundary month the range only cuts into is partial but not current", () => {
  const series = buildCashflowSeries(
    [apiPoint(2026, 5, 800, 300), apiPoint(2026, 6, 3000, 1000)],
    {
      fromDate: local(2026, 5, 20),
      toDate: local(2026, 6, 30, 23, 59, 59, 999),
    },
    NOW,
  );

  assert.equal(series[0].monthKey, "2026-05");
  assert.equal(series[0].isPartial, true);
  assert.equal(series[0].isCurrentMonth, false);
  assert.equal(series[1].isPartial, false);
});

test("a fully elapsed, fully covered month is not partial", () => {
  const series = buildCashflowSeries(
    [apiPoint(2026, 6, 3000, 1000)],
    {
      fromDate: local(2026, 6, 1),
      toDate: local(2026, 6, 30, 23, 59, 59, 999),
    },
    NOW,
  );

  assert.equal(series[0].isPartial, false);
});

test("the current month is not annualised — the raw month-to-date figure is kept", () => {
  const monthToDate = apiPoint(2026, 8, 1400, 900);
  const series = buildCashflowSeries([monthToDate], FULL_RANGE, NOW);

  assert.equal(series.at(-1)?.income, 1400);
  assert.equal(series.at(-1)?.expenses, 900);
  assert.equal(series.at(-1)?.net, 500);
});

test("the series is not padded out across an empty decade", () => {
  const series = buildCashflowSeries(
    [apiPoint(2026, 6, 3000, 1000), apiPoint(2026, 7, 3100, 1000)],
    {
      fromDate: local(2000, 1, 1),
      toDate: local(2026, 8, 31, 23, 59, 59, 999),
    },
    NOW,
  );

  assert.equal(series.length, 2);
  assert.equal(series[0].monthKey, "2026-06");
});

test("an empty or unusable period yields an empty series", () => {
  assert.deepEqual(buildCashflowSeries([], FULL_RANGE, NOW), []);
  assert.deepEqual(buildCashflowSeries(undefined, FULL_RANGE, NOW), []);
  assert.deepEqual(
    buildCashflowSeries([apiPoint(2026, 6, 1, 1)], {
      fromDate: "not-a-date",
      toDate: FULL_RANGE.toDate,
    }),
    [],
  );
  assert.deepEqual(
    buildCashflowSeries(
      [apiPoint(2026, 6, 1, 1)],
      { fromDate: FULL_RANGE.toDate, toDate: FULL_RANGE.fromDate },
      NOW,
    ),
    [],
  );
});

test("the trailing net average skips gaps instead of counting them as zero", () => {
  const series = buildCashflowSeries(
    [
      apiPoint(2026, 5, 3000, 1000),
      apiPoint(2026, 7, 3000, 1000),
      apiPoint(2026, 8, 3000, 1000),
    ],
    FULL_RANGE,
    NOW,
  );

  assert.equal(series.length, 4);
  assert.equal(getTrailingNetAverage(series), 2000);
  assert.equal(getTrailingNetAverage([]), 0);
});

test("the partial month reported to the reader is the latest one carrying data", () => {
  const series = buildCashflowSeries(
    [apiPoint(2026, 5, 800, 300), apiPoint(2026, 8, 1400, 900)],
    {
      fromDate: local(2026, 5, 20),
      toDate: local(2026, 8, 20, 23, 59, 59, 999),
    },
    NOW,
  );

  assert.equal(findPartialMonth(series)?.monthKey, "2026-08");
  assert.equal(
    findPartialMonth(
      buildCashflowSeries(
        [apiPoint(2026, 6, 3000, 1000)],
        {
          fromDate: local(2026, 6, 1),
          toDate: local(2026, 6, 30, 23, 59, 59, 999),
        },
        NOW,
      ),
    ),
    undefined,
  );
});
