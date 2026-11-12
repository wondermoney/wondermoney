// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, it, vi } from "vitest";

import { formatShortDateForLocale } from "@/lib/utils/formatDate";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";

import commonMessages from "../../messages/en/common.json";
import ProjectedTransactions from "./ProjectedTransactions";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const occurrences = [
  {
    accountKey: 1,
    amount: 100,
    currency: "EUR",
    date: "2026-03-06",
    name: "Rent",
    seriesKey: 10,
  },
  {
    accountKey: 1,
    amount: 12.5,
    currency: "EUR",
    date: "2026-03-08",
    name: "Streaming",
    seriesKey: 11,
  },
];

function renderRows(
  items = occurrences,
  installments?: Parameters<typeof ProjectedTransactions>[0]["installments"],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <ProjectedTransactions occurrences={items} installments={installments} />
    </NextIntlClientProvider>,
  );
}

describe("ProjectedTransactions", () => {
  it("renders projected rows above the ledger, clearly marked as projections", () => {
    const { container } = renderRows();

    assert.ok(
      screen.getByRole("region", { name: "Projected transactions" }),
    );
    assert.match(container.textContent ?? "", /Not counted in reports/);
    assert.match(container.textContent ?? "", /Rent/);
    assert.match(container.textContent ?? "", /Streaming/);
    assert.equal(screen.getAllByText("Projected").length, 2);
    assert.match(
      container.textContent ?? "",
      new RegExp(
        formatShortDateForLocale(
          transactionDisplayDate("2026-03-06T00:00:00.000Z"),
          "en",
        ),
      ),
    );
    assert.match(container.textContent ?? "", /100\.00/);
    assert.match(container.textContent ?? "", /12\.50/);
  });

  it("renders nothing when there is no projection", () => {
    const { container } = renderRows([]);
    assert.equal(container.innerHTML, "");
  });

  it("lists upcoming card installments with the recurring ones, in date order, marked n/N", () => {
    const { container } = renderRows(occurrences, [
      {
        accountKey: 1,
        amount: 41.66,
        currency: "EUR",
        date: "2026-03-07",
        installmentCount: 12,
        installmentNumber: 4,
        installmentPlanKey: 9,
        name: "Laptop",
      },
    ]);

    const items = screen.getAllByRole("listitem");
    assert.deepEqual(
      items.map((item) => item.querySelector("p")?.textContent),
      ["Rent", "Laptop", "Streaming"],
    );
    assert.equal(screen.getAllByText("Projected").length, 3);
    const badge = screen.getByRole("link", { name: "Installment 4 of 12" });
    assert.equal(badge.textContent, "4/12");
    assert.match(container.textContent ?? "", /41\.66/);
  });

  it("shows installments even when no recurring payment is projected", () => {
    renderRows([], [
      {
        accountKey: 1,
        amount: 10,
        currency: "EUR",
        date: "2026-03-07",
        installmentCount: 3,
        installmentNumber: 2,
        installmentPlanKey: 5,
        name: "Phone",
      },
    ]);
    assert.ok(screen.getByRole("region", { name: "Projected transactions" }));
    assert.ok(screen.getByText("2/3"));
  });
});
