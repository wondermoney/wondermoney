import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, test } from "vitest";

import { formatTxDate } from "@/lib/account/accounts-formatters";
import { dayBreaks, monthBreaks } from "@/lib/account/ledger";

import { formatShortDateForLocale } from "./formatDate";
import {
  isDateOnlyTransactionDate,
  transactionDisplayDate,
} from "./transaction-date";

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

/** A bank booking on 1 August: a date with no time, which the API stores at UTC midnight. */
const BOOKING = "2026-08-01T00:00:00.000Z";

describe("isDateOnlyTransactionDate", () => {
  test("is true at exactly UTC midnight, as the API reads it", () => {
    assert.equal(isDateOnlyTransactionDate(BOOKING), true);
    assert.equal(isDateOnlyTransactionDate(new Date(BOOKING)), true);
  });

  test("is false for any other time, and for a value that is not a date", () => {
    assert.equal(isDateOnlyTransactionDate("2026-08-01T00:00:00.001Z"), false);
    assert.equal(isDateOnlyTransactionDate("2026-08-01T14:30:00.000Z"), false);
    assert.equal(
      isDateOnlyTransactionDate("2026-08-01T00:00:00.000+01:00"),
      false,
    );
    assert.equal(isDateOnlyTransactionDate("not a date"), false);
  });
});

for (const zone of ["America/New_York", "Asia/Tokyo"]) {
  describe(`a viewer in ${zone}`, () => {
    inTimeZone(zone);

    test("sees a date-only booking on its own date", () => {
      const date = transactionDisplayDate(BOOKING);
      assert.deepEqual(
        [date.getFullYear(), date.getMonth(), date.getDate()],
        [2026, 7, 1],
      );
      assert.equal(
        formatShortDateForLocale(date, "en-US", { alwaysShowYear: true }),
        "Aug 1, 2026",
      );
    });

    test("sees it on its own date in the accounts list", () => {
      assert.equal(formatTxDate("2026-01-01T00:00:00.000Z"), "1 Jan");
    });

    test("groups it with its own day and month in the ledger", () => {
      const dates = [
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T12:00:00.000Z",
        "2026-07-31T00:00:00.000Z",
      ].map(transactionDisplayDate);
      assert.deepEqual(monthBreaks(dates), [true, false, true]);
      assert.deepEqual(dayBreaks(dates), [true, false, true]);
    });
  });
}

describe("a transaction with a real time", () => {
  describe("in New York", () => {
    inTimeZone("America/New_York");
    test("shows in local time", () => {
      assert.equal(
        formatShortDateForLocale(
          transactionDisplayDate("2026-08-01T02:30:00.000Z"),
          "en-US",
          { alwaysShowYear: true, withTime: true },
        ),
        "Jul 31, 2026, 10:30 PM",
      );
    });
  });
  describe("in Tokyo", () => {
    inTimeZone("Asia/Tokyo");
    test("shows in local time", () => {
      assert.equal(
        formatShortDateForLocale(
          transactionDisplayDate("2026-07-31T20:00:00.000Z"),
          "en-US",
          { alwaysShowYear: true },
        ),
        "Aug 1, 2026",
      );
    });
  });
});

test("a value that is not a date stays an invalid date", () => {
  assert.equal(Number.isNaN(transactionDisplayDate("soon").getTime()), true);
});
