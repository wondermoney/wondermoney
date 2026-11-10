// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import commonMessages from "../../messages/en/common.json";
import { UnconvertedAmountsNotice } from "./UnconvertedAmountsNotice";
import { UnconvertedTotalWarning } from "./UnconvertedTotalWarning";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const renderWithMessages = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      {node}
    </NextIntlClientProvider>,
  );

test("a complete total has no warning", () => {
  const { container } = renderWithMessages(
    <UnconvertedTotalWarning
      unconverted={{ count: 0, currencies: [] }}
      currency="EUR"
    />,
  );

  assert.equal(container.textContent, "");
});

test("the icon opens what was left out, naming the currencies and linking to where a rate is added", () => {
  renderWithMessages(
    <UnconvertedTotalWarning
      unconverted={{ count: 2, currencies: ["JPY", "USD"] }}
      currency="EUR"
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Not every amount could be converted" }),
  );

  const note = screen.getByRole("note");
  assert.match(note.textContent ?? "", /leaves out 2 accounts/);
  assert.match(note.textContent ?? "", /JPY and USD/);
  assert.equal(
    screen
      .getByRole("link", { name: "Add an exchange rate" })
      .getAttribute("href"),
    "/settings?tab=currencies&from=JPY",
  );
});

test("the note form says the same inline", () => {
  renderWithMessages(
    <UnconvertedTotalWarning
      unconverted={{ count: 1, currencies: [] }}
      currency="EUR"
      variant="note"
    />,
  );

  assert.match(
    screen.getByRole("note").textContent ?? "",
    /leaves out 1 account, loan or portfolio that could not be valued in EUR/,
  );
  // With no currency to name, there is no rate to add.
  assert.equal(screen.queryByRole("link"), null);
});

test("a report total that leaves rows out links to where a rate is added", () => {
  renderWithMessages(
    <UnconvertedAmountsNotice
      completeness={{
        currencyCode: "EUR",
        isComplete: false,
        unconvertedTransactions: 3,
        unconvertedCurrencies: ["USD"],
      }}
    />,
  );

  assert.match(screen.getByRole("note").textContent ?? "", /USD/);
  assert.equal(
    screen
      .getByRole("link", { name: "Add an exchange rate" })
      .getAttribute("href"),
    "/settings?tab=currencies&from=USD",
  );
});
