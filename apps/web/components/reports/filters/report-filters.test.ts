/**
 * RAD-562 — the report request must name the calendar it wants months in.
 *
 * `buildReportFilters` is the single place every `/v1/reports/*` request (chart
 * and CSV alike) gets its envelope from, so these checks pin both halves of the
 * contract: a viewer's calendar travels, and an unusable one leaves no trace.
 */

import assert from "node:assert/strict";

import { test } from "vitest";

import { isSupportedTimeZone } from "@/lib/reports/viewer-timezone";

import { buildReportFilters } from "./useReportFilters";

const PERIOD = new URLSearchParams({
  from: "2026-07-31T22:00:00.000Z",
  to: "2026-08-31T21:59:59.999Z",
});

test("the viewer's calendar is sent with the report request", () => {
  const filters = buildReportFilters(PERIOD, "Europe/Madrid");

  assert.equal(filters.timezone, "Europe/Madrid");
  assert.equal(isSupportedTimeZone(filters.timezone as string), true);
});

test("the Madrid August case reaches the API as August", () => {
  // The bug: a Madrid reader picking August sends 2026-07-31T22:00Z, which is
  // still July in the API's default calendar, so the response carried an
  // out-of-period July row that the CSV export happily printed.
  const filters = buildReportFilters(PERIOD, "Europe/Madrid");
  const monthIn = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "2-digit",
      timeZone: zone,
      year: "numeric",
    }).format(new Date(filters.fromDate));

  assert.equal(monthIn("Europe/Lisbon"), "07/2026");
  assert.equal(monthIn(filters.timezone as string), "08/2026");
});

test("an unknown calendar leaves no timezone key on the envelope", () => {
  // Not `timezone: undefined`: the key must be absent so the API applies its
  // own default instead of validating — and rejecting — a value we invented.
  const filters = buildReportFilters(PERIOD, undefined);

  assert.equal("timezone" in filters, false);
  assert.equal(Object.keys(filters).includes("timezone"), false);
  assert.doesNotMatch(
    JSON.stringify(filters),
    /timezone/,
    "timezone must not survive serialisation either",
  );
});

test("the navigable filters are untouched by the calendar", () => {
  const params = new URLSearchParams({
    accounts: "acc-1,acc-2",
    categories: "cat-1",
    currency: "EUR",
    from: "2026-06-01T00:00:00.000Z",
    merchants: "m-1",
    pending: "true",
    to: "2026-06-30T23:59:59.999Z",
    transfers: "true",
  });

  const withZone = buildReportFilters(params, "Europe/Madrid");
  const withoutZone = buildReportFilters(params, undefined);

  assert.deepEqual(
    { ...withZone, timezone: undefined },
    { ...withoutZone, timezone: undefined },
  );
  assert.deepEqual(withZone.accountKeys, ["acc-1", "acc-2"]);
  assert.equal(withZone.includePending, true);
  assert.equal(withZone.currencyKey, "EUR");
});

test("the calendar is not a URL param, so shared links stay device-neutral", () => {
  // A link shared from Madrid must not force Madrid months on a Lisbon reader:
  // the zone describes the device, not the report.
  const source = new URLSearchParams({ timezone: "Europe/Madrid" });
  const filters = buildReportFilters(source, "Europe/Lisbon");

  assert.equal(filters.timezone, "Europe/Lisbon");
});
