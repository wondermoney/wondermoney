// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import commonMessages from "../../messages/en/common.json";
import CreditCardStatementSummary from "./CreditCardStatementSummary";

const statements = vi.hoisted(() => ({
  data: {
    statements: [
      {
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        dueDate: "2026-02-10",
        charges: 300,
        payments: 100,
        balance: 200,
        availableCredit: 800,
        isCurrent: true,
      },
    ],
  },
  isLoading: false,
}));

vi.mock("@/lib/api/account/useCreditCardStatements", () => ({
  default: () => statements,
}));

afterEach(cleanup);

const settings = {
  statementCloseDay: 31,
  paymentDueDay: 10,
  creditLimit: 1000,
  minimumPaymentPercent: null,
};

function renderSummary(creditCard: typeof settings | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <CreditCardStatementSummary
        accountKey={7}
        creditCard={creditCard}
        currency="EUR"
      />
    </NextIntlClientProvider>,
  );
}

describe("the credit card statement summary", () => {
  test("shows the current statement balance, due date and available credit", () => {
    renderSummary(settings);

    expect(screen.getByText("Statement balance")).toBeTruthy();
    expect(screen.getByText("200.00")).toBeTruthy();
    expect(screen.getByText("Due date")).toBeTruthy();
    expect(screen.getByText(/Feb 10, 2026/)).toBeTruthy();
    expect(screen.getByText("Available credit")).toBeTruthy();
    expect(screen.getByText("800.00")).toBeTruthy();
  });

  test("renders nothing for an account that is not a card", () => {
    const { container } = renderSummary(null);
    expect(container.textContent).toBe("");
  });
});
