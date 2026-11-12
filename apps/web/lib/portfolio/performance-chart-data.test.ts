import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildReturnChartData,
  buildValueChartData,
  flowKindOf,
} from "./performance-chart-data";

test("a day's net contribution says which way money moved", () => {
  assert.equal(flowKindOf(500), "deposit");
  assert.equal(flowKindOf(-200), "withdrawal");
  assert.equal(flowKindOf(null), "unknown");
  assert.equal(flowKindOf(undefined), null);
  // A buy and a sale that cancel out moved no money in or out.
  assert.equal(flowKindOf(0), null);
});

test("the value view tags only the days with a trade", () => {
  const data = buildValueChartData([
    { date: "2026-03-02", value: 1000 },
    { date: "2026-03-03", value: 1500, netContribution: 500 },
    { date: "2026-03-04", value: 1300, netContribution: -200 },
    { date: "2026-03-05", value: 1300, netContribution: null },
  ]);

  assert.deepEqual(
    data.map((point) => [point.x, point.portfolio, point.flow]),
    [
      ["2026-03-02", 1000, null],
      ["2026-03-03", 1500, "deposit"],
      ["2026-03-04", 1300, "withdrawal"],
      ["2026-03-05", 1300, "unknown"],
    ],
  );
});

test("a day the time-weighted return could not measure is a gap, not a fall to zero", () => {
  const data = buildReturnChartData(
    [
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-04", value: 2.5 },
    ],
    [
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-03", value: 1 },
      { date: "2026-03-04", value: 1.5 },
    ],
  );

  assert.deepEqual(data, [
    { x: "2026-03-02", portfolioReturn: 0, benchmarkReturn: 0 },
    { x: "2026-03-03", portfolioReturn: undefined, benchmarkReturn: 1 },
    { x: "2026-03-04", portfolioReturn: 2.5, benchmarkReturn: 1.5 },
  ]);
});

test("the return series line up by date whatever order they arrive in", () => {
  const data = buildReturnChartData(
    [
      { date: "2026-03-04", value: 3 },
      { date: "2026-03-02", value: 0 },
    ],
    [
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-04", value: 1 },
    ],
  );

  assert.deepEqual(
    data.map((point) => [
      point.x,
      point.portfolioReturn,
      point.benchmarkReturn,
    ]),
    [
      ["2026-03-02", 0, 0],
      ["2026-03-04", 3, 1],
    ],
  );
});

test("no portfolio history means no percentage chart", () => {
  assert.deepEqual(
    buildReturnChartData([], [{ date: "2026-03-02", value: 0 }]),
    [],
  );
  assert.deepEqual(buildReturnChartData(undefined, undefined), []);
});
