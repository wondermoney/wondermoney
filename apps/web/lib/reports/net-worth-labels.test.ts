import assert from "node:assert/strict";

import { test } from "vitest";

import { monthlyNetWorthPoints, netWorthAxisLabels } from "./net-worth-labels";

test("one point a month is labelled by its month", () => {
  const labels = netWorthAxisLabels(
    ["2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
    "en-GB",
  );

  // Month and two-digit year, with no day. The separator is locale data, not
  // ours: CLDR 48 (the ICU bundled with Node) writes "Aug 26", CLDR 49 (a Node
  // built against a newer system ICU, such as Homebrew's) writes "Aug ’26".
  assert.equal(labels.length, 2);
  assert.match(labels[0], /^Aug\W*26$/u);
  assert.match(labels[1], /^Sept?\W*26$/u);
});

test("several points in one month are labelled by day, so no label repeats", () => {
  const labels = netWorthAxisLabels(
    [
      "2026-08-03T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      "2026-08-17T00:00:00.000Z",
    ],
    "en-GB",
  );

  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(labels, ["3 Aug", "10 Aug", "17 Aug"]);
});

test("labels read the date as a calendar day, whatever the viewer's zone", () => {
  // Midnight UTC on the 1st must not become the 31st for a viewer west of UTC.
  assert.deepEqual(
    netWorthAxisLabels(
      ["2026-10-01T00:00:00.000Z", "2026-10-15T00:00:00.000Z"],
      "en-GB",
    ),
    ["1 Oct", "15 Oct"],
  );
});

test("points sharing a month collapse to the month's last value", () => {
  // The report endpoint stamps every point in a month with the month's first
  // day; the chart is "month by month", so it keeps one point a month.
  const points = monthlyNetWorthPoints([
    { date: "2026-09-01T00:00:00.000Z", netWorth: 0 },
    { date: "2026-10-01T00:00:00.000Z", netWorth: -153970 },
    { date: "2026-10-01T00:00:00.000Z", netWorth: -153650 },
    { date: "2026-11-01T00:00:00.000Z", netWorth: -145897 },
  ]);

  assert.deepEqual(
    points.map((point) => [point.date.slice(0, 7), point.netWorth]),
    [
      ["2026-09", 0],
      ["2026-10", -153650],
      ["2026-11", -145897],
    ],
  );
});
