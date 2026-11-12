// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { RecurringOccurrence } from "@/lib/api/recurring/useRecurringOccurrences";

import { RecurringMonthCalendar } from "./RecurringMonthCalendar";

afterEach(cleanup);

const labels = {
  emptyDay: "No recurring payments on this day.",
  loading: "Loading this month's payments…",
  nextMonth: "Next month",
  paymentCount: (count: number) => `${count} payments`,
  previousMonth: "Previous month",
  status: {
    due: "Due",
    overdue: "Overdue",
    paid: "Paid",
    projected: "Projected",
  },
  today: "Today",
};

const occurrence = (overrides: Partial<RecurringOccurrence>): RecurringOccurrence => ({
  currency: "EUR",
  date: "2026-03-05T00:00:00.000Z",
  expectedAmount: 20,
  name: "Rent",
  seriesKey: 1,
  status: "projected",
  ...overrides,
});

const renderCalendar = (props: Partial<Parameters<typeof RecurringMonthCalendar>[0]> = {}) =>
  render(
    <NextIntlClientProvider locale="en-US" messages={{}} onError={() => {}}>
      <RecurringMonthCalendar
        month="2026-03"
        selectedDay="2026-03-05"
        today="2026-03-10"
        items={[]}
        locale="en-US"
        labels={labels}
        onSelectDay={() => {}}
        onMonthChange={() => {}}
        onToday={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );

describe("RecurringMonthCalendar", () => {
  test("shows the month and a day total", () => {
    const view = renderCalendar({
      items: [
        occurrence({ date: "2026-03-05T00:00:00.000Z", expectedAmount: 20 }),
        occurrence({ date: "2026-03-05T00:00:00.000Z", expectedAmount: 12.5, name: "Internet", seriesKey: 2 }),
      ],
    });

    expect(view.getByText("March 2026")).toBeTruthy();
    expect(view.getAllByText("€32.50").length).toBeGreaterThan(0);
  });

  test("lists the selected day's payments with their status", () => {
    const view = renderCalendar({
      items: [
        occurrence({ date: "2026-03-05T00:00:00.000Z", name: "Rent", status: "overdue" }),
        occurrence({ date: "2026-03-05T00:00:00.000Z", name: "Internet", seriesKey: 2, status: "paid" }),
      ],
    });

    expect(view.getByText("Thursday, March 5")).toBeTruthy();
    expect(view.getByText("Rent")).toBeTruthy();
    expect(view.getByText("Internet")).toBeTruthy();
    expect(view.getByText("Overdue")).toBeTruthy();
    expect(view.getByText("Paid")).toBeTruthy();
  });

  test("shows a count instead of a total when a day mixes currencies", () => {
    const view = renderCalendar({
      items: [
        occurrence({ date: "2026-03-05T00:00:00.000Z", currency: "EUR" }),
        occurrence({ date: "2026-03-05T00:00:00.000Z", currency: "USD", seriesKey: 2 }),
      ],
    });

    expect(view.getAllByText("2 payments").length).toBeGreaterThan(0);
  });

  test("selects a day and moves between months", () => {
    const onSelectDay = vi.fn();
    const onMonthChange = vi.fn();
    const view = renderCalendar({ onMonthChange, onSelectDay });

    fireEvent.click(view.getByRole("button", { name: "12" }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-03-12");

    fireEvent.click(view.getByRole("button", { name: "Next month" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-04");

    fireEvent.click(view.getByRole("button", { name: "Previous month" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-02");
  });

  test("says when the selected day has nothing", () => {
    const view = renderCalendar({ selectedDay: "2026-03-06" });

    expect(view.getByText("No recurring payments on this day.")).toBeTruthy();
  });

  test("lists a card installment on its day, marked n/N, and counts it in the day's total", () => {
    const view = renderCalendar({
      items: [occurrence({ date: "2026-03-05T00:00:00.000Z", expectedAmount: 20 })],
      installments: [
        {
          amount: 41.66,
          currency: "EUR",
          date: "2026-03-05",
          installmentCount: 12,
          installmentNumber: 3,
          installmentPlanKey: 9,
          name: "Laptop",
          status: "projected",
        },
      ],
      labels: {
        ...labels,
        installment: (number, count) => `Installment ${number} of ${count}`,
      },
    });

    expect(view.getByText("Laptop")).toBeTruthy();
    expect(view.getByText("3/12")).toBeTruthy();
    expect(view.getByText("Installment 3 of 12")).toBeTruthy();
    expect(view.getAllByText("Projected").length).toBe(2);
    expect(view.getAllByText("€61.66").length).toBeGreaterThan(0);
  });
});
