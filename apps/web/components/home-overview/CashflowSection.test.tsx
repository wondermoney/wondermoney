// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import type {
  AccountCashflow,
  GetAccountsCashflowResponse,
} from "@/lib/api/account/useAccountsCashflow";
import {
  EN_MONEY_PATTERN,
  setStoredPrivacyMode,
  WithPrivacyMode,
} from "@/lib/privacy/privacy-test-utils";

import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import navigationMessages from "../../messages/en/navigation.json";
import { CashflowSection } from "./CashflowSection";

const state = vi.hoisted(() => ({
  response: { cashflow: [] } as GetAccountsCashflowResponse,
  comparison: { cashflow: [] } as GetAccountsCashflowResponse,
}));

vi.mock("@/lib/api/account/useAccountsCashflow", () => ({
  default: (params: { fromDate?: Date }) => ({
    // The comparison read starts on the first of last month; the six-month
    // read starts earlier.
    data: params.fromDate?.getMonth() === 9 ? state.comparison : state.response,
    error: null,
    isPending: false,
    refetch: () => {},
  }),
}));
vi.mock("@/lib/api/net-worth/useNetWorth", () => ({
  default: () => ({ data: { netWorth: { currencyCode: "EUR" } } }),
}));

const messages = { ...commonMessages, ...homeMessages, ...navigationMessages };

const row = (
  date: string,
  amount: number,
  income: number,
  expenses: number,
  savingsRate: number | null,
): AccountCashflow => ({ amount, date, expenses, income, savingsRate });

const november = row(
  "2026-11-01T00:00:00.000Z",
  600,
  2000,
  1400,
  0.3,
);
const october = row(
  "2026-10-01T00:00:00.000Z",
  360,
  1880,
  1520,
  0.1915,
);
const octoberToDate = row(
  "2026-10-01T00:00:00.000Z",
  -120,
  1880,
  1520,
  0.1915,
);

function renderSection(hidden = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {hidden ? (
        <WithPrivacyMode hidden>
          <CashflowSection />
        </WithPrivacyMode>
      ) : (
        <CashflowSection />
      )}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 5, 12), toFake: ["Date"] });
  state.response = { cashflow: [october, november] };
  state.comparison = { cashflow: [octoberToDate] };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setStoredPrivacyMode(false);
});

test("the cash flow says when rows with no exchange rate are left out", () => {
  state.response = {
    cashflow: [november],
    completeness: {
      currencyCode: "EUR",
      isComplete: false,
      unconvertedCurrencies: ["USD"],
      unconvertedTransactions: 1,
    },
  };

  renderSection();

  const section = screen.getByRole("region", {
    name: "Net cash flow by month",
  });
  assert.match(
    within(section).getByRole("note").textContent ?? "",
    /1 transaction in USD is left out/,
  );
});

test("a complete cash flow shows no notice", () => {
  state.response = {
    cashflow: [november],
    completeness: {
      currencyCode: "EUR",
      isComplete: true,
      unconvertedCurrencies: [],
      unconvertedTransactions: 0,
    },
  };

  renderSection();

  assert.equal(screen.queryByRole("note"), null);
});

test("this month's income, spending and savings rate sit above the bars", () => {
  const { container } = renderSection();

  const text = container.textContent ?? "";
  assert.match(text, /This month/);
  assert.match(text, /Income\s*€2,000\.00/);
  assert.match(text, /Spending\s*€1,400\.00/);
  assert.match(text, /Savings rate\s*30%/);
});

test("each figure shows its change from the same point last month", () => {
  const { container } = renderSection();

  const text = container.textContent ?? "";
  assert.match(text, /\+€120\.00\s*vs same point last month/);
  // Spending fell: the figure is signed negative and the good direction is green.
  assert.match(text, /−€120\.00\s*vs same point last month/);
  assert.match(text, /\+10\.8 pts\s*vs same point last month/);
  assert.match(
    text,
    /Savings rate is income minus spending, divided by income\./,
  );
});

test("on the last day of the month the comparison is the whole previous month", () => {
  vi.setSystemTime(new Date(2026, 10, 30, 12));

  const { container } = renderSection();

  assert.match(container.textContent ?? "", /vs October/);
  assert.doesNotMatch(container.textContent ?? "", /same point last month/);
});

test("privacy mode hides the amounts and keeps the rate", () => {
  setStoredPrivacyMode(true);
  const { container } = renderSection(true);

  const text = container.textContent ?? "";
  assert.doesNotMatch(text, EN_MONEY_PATTERN);
  assert.doesNotMatch(text, /€\s*[\d−-]/);
  assert.match(text, /Savings rate\s*30%/);
  assert.match(text, /\+10\.8 pts/);
  assert.match(text, /Hidden amount/);
});

test("a lower savings rate is shown in the bad direction", () => {
  state.response = {
    cashflow: [row("2026-11-01T00:00:00.000Z", 600, 2000, 1400, 0.3)],
  };
  state.comparison = {
    cashflow: [row("2026-10-01T00:00:00.000Z", 0, 1880, 1200, 0.36)],
  };

  const { container } = renderSection();

  const rateChange = [...container.querySelectorAll("span")].find(
    (span) =>
      span.textContent?.includes("pts") &&
      span.classList.contains("text-destructive-text"),
  );
  assert.ok(rateChange, "the rate change carries the bad-direction colour");
});

test("a month with no income shows an em dash for the rate, not a zero", () => {
  state.response = {
    cashflow: [row("2026-11-01T00:00:00.000Z", -400, 0, 400, null)],
  };
  state.comparison = { cashflow: [] };

  const { container } = renderSection();

  const text = container.textContent ?? "";
  assert.match(text, /Savings rate\s*—/);
  assert.doesNotMatch(text, /Savings rate\s*0%/);
});
