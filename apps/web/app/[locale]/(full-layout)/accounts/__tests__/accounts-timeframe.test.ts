import assert from "node:assert/strict";

import { test } from "vitest";

import { getAccountsTimeframeRange } from "../accounts-timeframe";

test("1M timeframe starts one month before now and ends now", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");
  const range = getAccountsTimeframeRange("1M", now);

  assert.equal(range.fromDate?.toISOString(), "2026-02-12T10:15:00.000Z");
  assert.equal(range.toDate?.toISOString(), now.toISOString());
});

test("3M timeframe starts three months before now and ends now", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");
  const range = getAccountsTimeframeRange("3M", now);

  assert.equal(range.fromDate?.toISOString(), "2025-12-12T10:15:00.000Z");
  assert.equal(range.toDate?.toISOString(), now.toISOString());
});

test("6M timeframe starts six months before now and ends now", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");
  const range = getAccountsTimeframeRange("6M", now);

  assert.equal(range.fromDate?.toISOString(), "2025-09-12T10:15:00.000Z");
  assert.equal(range.toDate?.toISOString(), now.toISOString());
});

test("YTD timeframe starts at the beginning of the current year and ends now", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");
  const range = getAccountsTimeframeRange("YTD", now);

  assert.equal(range.fromDate?.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(range.toDate?.toISOString(), now.toISOString());
});

test("1Y timeframe starts twelve months before now and ends now", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");
  const range = getAccountsTimeframeRange("1Y", now);

  assert.equal(range.fromDate?.toISOString(), "2025-03-12T10:15:00.000Z");
  assert.equal(range.toDate?.toISOString(), now.toISOString());
});

test("ALL timeframe leaves dates undefined", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");
  const range = getAccountsTimeframeRange("ALL", now);

  assert.equal(range.fromDate, undefined);
  assert.equal(range.toDate, undefined);
});
