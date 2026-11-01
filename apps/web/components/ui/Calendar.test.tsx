// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { afterEach, test, vi } from "vitest";

import { Calendar } from "./Calendar";

afterEach(cleanup);

const MARCH_2026 = new Date(2026, 2, 1);

function withLocale(locale: string, children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale={locale} messages={{}}>
      {children}
    </NextIntlClientProvider>
  );
}

/** The day button for a day of March 2026, found by its accessible name. */
const marchDay = (day: number) =>
  screen.getByRole("button", {
    name: new RegExp(`March ${day}(st|nd|rd|th), 2026`),
  });

function RangeCalendar({
  onSelect,
}: {
  onSelect: (range: DateRange | undefined) => void;
}) {
  const [range, setRange] = useState<DateRange | undefined>();
  return (
    <Calendar
      mode="range"
      defaultMonth={MARCH_2026}
      selected={range}
      onSelect={(next) => {
        setRange(next);
        onSelect(next);
      }}
    />
  );
}

test("renders the requested month as a grid of days", () => {
  render(
    withLocale("en", <Calendar mode="single" defaultMonth={MARCH_2026} />),
  );

  const grid = screen.getByRole("grid", { name: /March 2026/ });
  // 31 days of March, plus the outside days that fill the first and last weeks.
  assert.ok(within(grid).getAllByRole("gridcell").length >= 31);
  assert.ok(marchDay(31));
});

test("picking a start and an end day reports that range", async () => {
  const onSelect = vi.fn();
  render(withLocale("en", <RangeCalendar onSelect={onSelect} />));

  await userEvent.click(marchDay(10));
  await userEvent.click(marchDay(14));

  const range = onSelect.mock.calls.at(-1)?.[0] as DateRange;
  assert.equal(
    range.from?.toDateString(),
    new Date(2026, 2, 10).toDateString(),
  );
  assert.equal(range.to?.toDateString(), new Date(2026, 2, 14).toDateString());
});

test("a disabled day cannot be selected", async () => {
  const onSelect = vi.fn();
  render(
    withLocale(
      "en",
      <Calendar
        mode="single"
        defaultMonth={MARCH_2026}
        disabled={{ after: new Date(2026, 2, 20) }}
        onSelect={onSelect}
      />,
    ),
  );

  await userEvent.click(marchDay(25));
  assert.equal(onSelect.mock.calls.length, 0);

  await userEvent.click(marchDay(5));
  assert.equal(onSelect.mock.calls.length, 1);
});

test("arrow keys move focus between days", async () => {
  render(
    withLocale("en", <Calendar mode="single" defaultMonth={MARCH_2026} />),
  );

  marchDay(10).focus();
  await userEvent.keyboard("{ArrowRight}");
  assert.equal(document.activeElement, marchDay(11));

  await userEvent.keyboard("{ArrowDown}");
  assert.equal(document.activeElement, marchDay(18));
});

test("follows the app locale: Portuguese month and day names", () => {
  render(
    withLocale("pt", <Calendar mode="single" defaultMonth={MARCH_2026} />),
  );

  const grid = screen.getByRole("grid", { name: /março/i });
  assert.ok(within(grid).getByRole("button", { name: /15 de março de 2026/ }));
});

test("follows the app locale's week start: Monday in Spanish", () => {
  render(
    withLocale("es", <Calendar mode="single" defaultMonth={MARCH_2026} />),
  );

  const grid = screen.getByRole("grid", { name: /marzo/i });
  // The first day shown opens the first week.
  const [firstDay] = within(grid).getAllByRole("button");
  assert.match(firstDay.getAttribute("aria-label") ?? "", /^lunes/i);
});

test("in Portuguese the week starts on Monday, as it does in Portugal", () => {
  render(
    withLocale("pt", <Calendar mode="single" defaultMonth={MARCH_2026} />),
  );

  const grid = screen.getByRole("grid", { name: /março/i });
  const [firstDay] = within(grid).getAllByRole("button");
  assert.match(firstDay.getAttribute("aria-label") ?? "", /^segunda/i);
});

test("in English the week starts on Sunday", () => {
  render(
    withLocale("en", <Calendar mode="single" defaultMonth={MARCH_2026} />),
  );

  const grid = screen.getByRole("grid", { name: /March 2026/ });
  const [firstDay] = within(grid).getAllByRole("button");
  assert.match(firstDay.getAttribute("aria-label") ?? "", /^Sunday/);
});
