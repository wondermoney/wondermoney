// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CreditCardStatement,
  CreditCardStatementDetail,
} from "@/lib/api/account/useCreditCardStatements";

import enMessages from "../../messages/en/common.json";
import CreditCardStatements, {
  selectCreditCardStatement,
} from "./CreditCardStatements";

const state = vi.hoisted(() => ({
  statements: [] as unknown[],
  details: {} as Record<string, unknown>,
  detailRequests: [] as (string | null)[],
}));

vi.mock("@/lib/api/account/useCreditCardStatements", () => ({
  default: () => ({ data: { statements: state.statements }, isLoading: false }),
  useCreditCardStatementDetail: ({
    statementDate,
  }: {
    statementDate: string | null;
  }) => {
    state.detailRequests.push(statementDate);
    const statement = statementDate ? state.details[statementDate] : undefined;
    return {
      data: statement ? { statement } : undefined,
      isError: false,
      isLoading: false,
    };
  },
}));

afterEach(() => {
  cleanup();
  state.statements = [];
  state.details = {};
  state.detailRequests = [];
});

const statement = (
  periodEnd: string,
  overrides: Partial<CreditCardStatement> = {},
): CreditCardStatement => ({
  periodStart: "2026-01-01",
  periodEnd,
  dueDate: "2026-02-10",
  charges: 100,
  payments: 0,
  balance: 100,
  availableCredit: 900,
  isCurrent: false,
  status: "closed",
  ...overrides,
});

const detail = (
  base: CreditCardStatement,
  description: string,
): CreditCardStatementDetail => ({
  ...base,
  transactions: [
    {
      amount: -100,
      description,
      merchantName: null,
      transactionDate: base.periodEnd,
      transactionKey: 1,
    },
  ],
});

function renderStatements() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreditCardStatements accountKey={7} currency="EUR" />
    </NextIntlClientProvider>,
  );
}

describe("credit card statement selection", () => {
  test("selects the current period by default and preserves an available selection", () => {
    const previous = statement("2026-01-31");
    const current = statement("2026-02-28", { isCurrent: true });
    expect(selectCreditCardStatement([previous, current], null)).toBe(current);
    expect(
      selectCreditCardStatement([previous, current], previous.periodEnd),
    ).toBe(previous);
  });

  test("falls back to current then latest if a refreshed list removed the selection", () => {
    const latest = statement("2026-03-31");
    const current = statement("2026-02-28", { isCurrent: true });
    expect(selectCreditCardStatement([latest, current], "2025-12-31")).toBe(
      current,
    );
    expect(selectCreditCardStatement([latest], "2025-12-31")).toBe(latest);
    expect(selectCreditCardStatement([], "2025-12-31")).toBeNull();
  });
});

describe("credit card statements tab", () => {
  test("lists every statement with its status in words, and opens the current one", () => {
    const overdue = statement("2026-01-31", { status: "overdue" });
    const current = statement("2026-02-28", {
      isCurrent: true,
      status: "open",
    });
    state.statements = [overdue, current];
    state.details = { "2026-02-28": detail(current, "Groceries") };

    renderStatements();

    expect(
      screen.getByText(enMessages["credit-card-statement-status-overdue"]),
    ).toBeTruthy();
    expect(
      screen.getByText(enMessages["credit-card-statement-status-open"]),
    ).toBeTruthy();
    expect(screen.getByText("Groceries")).toBeTruthy();
    expect(state.detailRequests.at(-1)).toBe("2026-02-28");
  });

  test("selecting another statement loads its transactions", async () => {
    const paid = statement("2026-01-31", { status: "paid", balance: 0 });
    const current = statement("2026-02-28", {
      isCurrent: true,
      status: "open",
    });
    state.statements = [paid, current];
    state.details = {
      "2026-01-31": detail(paid, "Flights"),
      "2026-02-28": detail(current, "Groceries"),
    };

    renderStatements();
    const [newest, older] = screen.getAllByRole("button");
    expect(newest?.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(older!);

    expect(state.detailRequests.at(-1)).toBe("2026-01-31");
    expect(screen.getByText("Flights")).toBeTruthy();
    expect(screen.queryByText("Groceries")).toBeNull();
    expect(older?.getAttribute("aria-pressed")).toBe("true");
  });
});
