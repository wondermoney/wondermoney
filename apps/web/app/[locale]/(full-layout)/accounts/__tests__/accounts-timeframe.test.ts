import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, test } from "vitest";

import { transactionDateRangeParams } from "@/lib/api/date-range";

import {
  type AccountsTimeframe,
  getAccountsTimeframeRange,
} from "../accounts-timeframe";

function inTimeZone(zone: string) {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}

/** The range as the accounts page sends it: whole local days, with the viewer's time zone. */
const sent = (timeframe: AccountsTimeframe, now: Date, zone: string) =>
  transactionDateRangeParams(getAccountsTimeframeRange(timeframe, now), zone);

describe("accounts timeframes, for a viewer in New York", () => {
  const zone = "America/New_York";
  inTimeZone(zone);
  // 22:00 on 31 December 2026 in New York, already 1 January 2027 in UTC.
  const now = new Date("2027-01-01T03:00:00.000Z");

  test("YTD starts on 1 January of the viewer's year, not the UTC one", () => {
    assert.deepEqual(sent("YTD", now, zone), {
      fromDate: "2026-01-01T05:00:00.000Z",
      timezone: zone,
      toDate: "2027-01-01T04:59:59.999Z",
    });
  });

  test("1M starts on the same day of the previous local month", () => {
    assert.equal(sent("1M", now, zone).fromDate, "2026-11-30T05:00:00.000Z");
  });

  test("1M from the last day of a month starts on the last day of a shorter one", () => {
    // 31 March 2026, 20:00 in New York.
    const endOfMarch = new Date("2026-04-01T00:00:00.000Z");
    assert.equal(
      sent("1M", endOfMarch, zone).fromDate,
      "2026-02-28T05:00:00.000Z",
    );
  });

  test("3M, 6M and 1Y count back local calendar months", () => {
    assert.equal(sent("3M", now, zone).fromDate, "2026-09-30T04:00:00.000Z");
    assert.equal(sent("6M", now, zone).fromDate, "2026-06-30T04:00:00.000Z");
    assert.equal(sent("1Y", now, zone).fromDate, "2025-12-31T05:00:00.000Z");
  });
});

describe("accounts timeframes, for a viewer in Tokyo", () => {
  const zone = "Asia/Tokyo";
  inTimeZone(zone);
  // 05:00 on 1 January 2027 in Tokyo, still 31 December 2026 in UTC.
  const now = new Date("2026-12-31T20:00:00.000Z");

  test("YTD starts on 1 January of the viewer's year, not the UTC one", () => {
    assert.deepEqual(sent("YTD", now, zone), {
      fromDate: "2026-12-31T15:00:00.000Z",
      timezone: zone,
      toDate: "2027-01-01T14:59:59.999Z",
    });
  });

  test("1M starts on the same day of the previous local month", () => {
    assert.equal(sent("1M", now, zone).fromDate, "2026-11-30T15:00:00.000Z");
  });
});

test("every dated timeframe ends now, and All Time has no dates", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");
  for (const timeframe of ["1M", "3M", "6M", "YTD", "1Y"] as const) {
    assert.equal(
      getAccountsTimeframeRange(timeframe, now).toDate?.toISOString(),
      now.toISOString(),
    );
  }
  assert.deepEqual(getAccountsTimeframeRange("ALL", now), {});
});
