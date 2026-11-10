import { describe, expect, test } from "vitest";

import {
  calendarDays,
  dayTotal,
  groupOccurrencesByDay,
  monthKey,
  shiftMonth,
  weekdayLabels,
} from "./recurring-calendar";

describe("recurring calendar", () => {
  test("builds a six-week grid that starts on the Monday before the month", () => {
    const days = calendarDays("2026-03");

    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-02-23");
    expect(days[6]).toBe("2026-03-01");
    expect(days[41]).toBe("2026-04-05");
  });

  test("shifts months across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthKey(new Date(2026, 2, 15))).toBe("2026-03");
  });

  test("labels weekdays from Monday", () => {
    expect(weekdayLabels("en-US")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  test("groups occurrences by the day they are shown on", () => {
    const grouped = groupOccurrencesByDay([
      { date: "2026-03-05T00:00:00.000Z", id: 1 },
      { date: "2026-03-05T12:00:00.000Z", id: 2 },
      { date: "2026-03-07T00:00:00.000Z", id: 3 },
    ]);

    expect(grouped.get("2026-03-05")?.map((item) => item.id)).toEqual([1, 2]);
    expect(grouped.get("2026-03-07")?.map((item) => item.id)).toEqual([3]);
  });

  test("totals a day in one currency", () => {
    expect(dayTotal([
      { currency: "EUR", expectedAmount: 10 },
      { currency: "EUR", expectedAmount: 12.5 },
    ])).toEqual({ amount: 22.5, count: 2, currency: "EUR" });
  });

  test("does not add different currencies together", () => {
    expect(dayTotal([
      { currency: "EUR", expectedAmount: 10 },
      { currency: "USD", expectedAmount: 12 },
    ])).toEqual({ amount: null, count: 2, currency: null });
  });
});
