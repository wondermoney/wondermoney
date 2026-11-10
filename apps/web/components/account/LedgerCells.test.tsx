// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, test } from "vitest";

import { LedgerDateCell, LedgerMonthLabel } from "./LedgerCells";

function inTimeZone(zone: string) {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    cleanup();
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}

const renderCells = (date: string) =>
  render(
    <NextIntlClientProvider locale="en-US" messages={{}}>
      <LedgerDateCell date={date} isDayStart isMonthStart />
      <span data-testid="month">
        <LedgerMonthLabel date={date} />
      </span>
    </NextIntlClientProvider>,
  );

for (const zone of ["America/New_York", "Asia/Tokyo"]) {
  describe(`the ledger, for a viewer in ${zone}`, () => {
    inTimeZone(zone);

    test("dates a date-only bank booking on its own day and month", () => {
      const view = renderCells("2026-08-01T00:00:00.000Z");
      const text = view.container.textContent ?? "";
      assert.match(text, /^Aug( 2026)?1Sat/);
      assert.equal(view.getByTestId("month").textContent, "August 2026");
    });
  });
}

describe("the ledger, in New York", () => {
  inTimeZone("America/New_York");

  test("dates a transaction with a real time on its local day", () => {
    const view = renderCells("2026-08-01T02:30:00.000Z");
    assert.match(view.container.textContent ?? "", /^Jul( 2026)?31Fri/);
    assert.equal(view.getByTestId("month").textContent, "July 2026");
  });
});
