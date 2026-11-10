// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, test } from "vitest";

import type { RecurringItem } from "@/lib/api/recurring/useRecurringItems";

import { RecurringItemsTable } from "./RecurringItemsTable";
import { RecurringUpcomingTimeline } from "./RecurringUpcomingTimeline";

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

const item = (overrides: Partial<RecurringItem>): RecurringItem => ({
  amountType: "fixed",
  cadence: "monthly",
  cadenceConfidence: 0.9,
  confidenceScore: 0.9,
  displayName: "Streaming",
  expectedAmount: 9.99,
  normalizedMerchantKey: "streaming",
  occurrenceCount: 3,
  recurringSeriesKey: 1,
  source: "detected",
  status: "confirmed",
  type: "subscription",
  ...overrides,
});

const statusLabels = {
  confirmed: "Confirmed",
  detected: "Detected",
  dismissed: "Dismissed",
  ended: "Ended",
  needsReview: "Needs review",
  paused: "Paused",
};

const renderTable = (items: RecurringItem[]) =>
  render(
    <NextIntlClientProvider locale="en-US" messages={{}} onError={() => {}}>
      <RecurringItemsTable
        items={items}
        currencyCode="EUR"
        locale="en-US"
        labels={{
          actions: "Actions",
          amount: "Amount",
          cadenceLabels: {
            biweekly: "Biweekly",
            monthly: "Monthly",
            quarterly: "Quarterly",
            weekly: "Weekly",
            yearly: "Yearly",
          },
          frequency: "Frequency",
          lastPaid: "Last paid",
          merchant: "Merchant",
          nextExpected: "Next expected",
          status: "Status",
          statusLabels,
          type: "Type",
          typeLabels: { bill: "Bill", subscription: "Subscription" },
        }}
      />
    </NextIntlClientProvider>,
  );

const renderTimeline = (items: RecurringItem[], referenceTime: number) =>
  render(
    <NextIntlClientProvider locale="en-US" messages={{}} onError={() => {}}>
      <RecurringUpcomingTimeline
        items={items}
        currencyCode="EUR"
        locale="en-US"
        labels={{ emptyState: "Nothing upcoming" }}
        referenceTime={referenceTime}
      />
    </NextIntlClientProvider>,
  );

for (const zone of ["America/New_York", "Asia/Tokyo"]) {
  describe(`recurring dates, for a viewer in ${zone}`, () => {
    inTimeZone(zone);

    test("a date-only booking's last paid and next expected show their own dates", () => {
      const view = renderTable([
        item({
          lastSeenAt: "2026-10-01T00:00:00.000Z",
          nextExpectedAt: "2026-11-01T00:00:00.000Z",
        }),
      ]);
      const table = within(view.getByRole("table"));
      assert.ok(table.getByText("Oct 1, 2026"));
      assert.ok(table.getByText("Nov 1, 2026"));
    });

    test("a date-only expected date shows on its own date in the timeline", () => {
      const view = renderTimeline(
        [item({ nextExpectedAt: "2026-11-01T00:00:00.000Z" })],
        Date.parse("2026-10-20T12:00:00.000Z"),
      );
      assert.match(view.container.textContent ?? "", /Nov 1, 2026/);
    });
  });
}

describe("the upcoming timeline, for a viewer in New York", () => {
  inTimeZone("America/New_York");

  test("keeps a date-only expected date of today, and drops yesterday's", () => {
    // 21:00 on 10 November in New York, already 11 November in UTC.
    const now = Date.parse("2026-11-11T02:00:00.000Z");
    const view = renderTimeline(
      [
        item({
          displayName: "Due today",
          nextExpectedAt: "2026-11-10T00:00:00.000Z",
        }),
        item({
          displayName: "Due yesterday",
          nextExpectedAt: "2026-11-09T00:00:00.000Z",
          recurringSeriesKey: 2,
        }),
      ],
      now,
    );
    const text = view.container.textContent ?? "";
    assert.match(text, /Due today/);
    assert.match(text, /Nov 10, 2026/);
    assert.doesNotMatch(text, /Due yesterday/);
  });

  test("dates an expected payment with a real time on its local day", () => {
    const view = renderTable([
      item({ lastSeenAt: "2026-10-01T02:30:00.000Z", nextExpectedAt: null }),
    ]);
    assert.ok(within(view.getByRole("table")).getByText("Sep 30, 2026"));
  });
});
