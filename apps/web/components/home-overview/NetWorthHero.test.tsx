// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { NetWorth } from "@/lib/api/net-worth/useNetWorth";
import type { NetWorthPoint } from "@/lib/api/reports/types";
import {
  EN_MONEY_PATTERN,
  setStoredPrivacyMode,
  WithPrivacyMode,
} from "@/lib/privacy/privacy-test-utils";

import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import navigationMessages from "../../messages/en/navigation.json";
import { NetWorthHero } from "./NetWorthHero";

const state = vi.hoisted(() => ({
  netWorth: { netWorth: 0, rows: [] } as NetWorth,
  history: [] as NetWorthPoint[],
  historyError: null as Error | null,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));
vi.mock("@/components/account/AccountsFreshness", () => ({
  default: () => null,
}));
vi.mock("@/components/ui/charts/area-line-chart-base", () => ({
  AreaLineChartBase: ({ data }: { data: object[] }) => (
    <div data-testid="net-worth-chart" data-points={data.length} />
  ),
}));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [] } }),
}));
vi.mock("@/lib/api/net-worth/useNetWorth", () => ({
  default: () => ({
    data: { netWorth: state.netWorth },
    error: null,
    isPending: false,
    refetch: () => {},
  }),
}));
vi.mock("@/lib/api/reports/netWorthHistory", () => ({
  default: () => ({
    data: state.historyError
      ? undefined
      : { data: state.history, filters: {}, generatedAt: "" },
    error: state.historyError,
    isPending: false,
    refetch: () => {},
  }),
}));

const messages = { ...commonMessages, ...homeMessages, ...navigationMessages };

const point = (date: string, netWorth: number): NetWorthPoint => ({
  date,
  netWorth,
  breakdown: { assets: 0, liabilities: 0 },
});

function renderHero() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NetWorthHero />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 4, 12), toFake: ["Date"] });
  state.netWorth = {
    netWorth: 136134.06,
    currencyCode: "EUR",
    rows: [
      { key: "accounts:Current", label: "Current", amount: 304516.39 },
      {
        key: "loans:Mortgage",
        label: "Mortgage",
        amount: -168382.33,
        isLiability: true,
      },
    ],
  };
  state.history = [
    point("2025-12-01T00:00:00.000Z", 107026.26),
    point("2026-10-01T00:00:00.000Z", 137069.69),
    point("2026-11-01T00:00:00.000Z", 136134.06),
  ];
  state.historyError = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("net worth is the page's one h1, with its figure, its signed changes and both sides", () => {
  const { container } = renderHero();

  const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
  assert.equal(headings.length, 1);
  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    "Net worth",
  );

  const text = container.textContent ?? "";
  assert.match(text, /€136,134\.06/);
  assert.match(text, /−€935\.63\s*since the end of October(?! 20)/);
  assert.match(text, /\+€29,107\.80\s*since the end of December 2025/);
  assert.match(text, /You own\s*€304,516\.39/);
  assert.match(text, /You owe\s*€168,382\.33/);
  assert.equal(
    screen.getByTestId("net-worth-chart").getAttribute("data-points"),
    "3",
  );
});

test("when the history fails the figure still stands, without changes or a chart", () => {
  state.historyError = new Error("history down");

  const { container } = renderHero();

  const text = container.textContent ?? "";
  assert.match(text, /€136,134\.06/);
  assert.doesNotMatch(text, /since the end of/);
  assert.match(text, /The change over time didn’t load\./);
  assert.ok(screen.getByRole("button", { name: "Try again" }));
  assert.equal(screen.queryByTestId("net-worth-chart"), null);
});

test("with no accounts the hero offers to add one", () => {
  state.netWorth = { netWorth: 0, currencyCode: "EUR", rows: [] };

  renderHero();

  assert.ok(screen.getByText("No accounts yet"));
  assert.equal(
    screen.getByRole("link", { name: "Add an account" }).getAttribute("href"),
    "/accounts",
  );
});

test("privacy mode hides every figure in the hero and keeps the words", () => {
  setStoredPrivacyMode(true);
  try {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WithPrivacyMode hidden>
          <NetWorthHero />
        </WithPrivacyMode>
      </NextIntlClientProvider>,
    );

    const text = container.textContent ?? "";
    assert.doesNotMatch(text, EN_MONEY_PATTERN);
    assert.doesNotMatch(text, /€\s*[\d−-]/);
    assert.match(text, /since the end of October/);
    assert.match(text, /You own/);
    assert.match(text, /Hidden amount/);
  } finally {
    setStoredPrivacyMode(false);
  }
});

test("a net worth that leaves out unconverted items carries a warning naming the currencies", () => {
  state.netWorth = {
    ...state.netWorth,
    unconverted: { count: 1, currencies: ["JPY"] },
  };
  renderHero();

  fireEvent.click(
    screen.getByRole("button", { name: "Not every amount could be converted" }),
  );

  const note = screen.getByRole("note");
  assert.match(
    note.textContent ?? "",
    /leaves out 1 account, loan or portfolio/,
  );
  assert.match(note.textContent ?? "", /No exchange rate yet for JPY\./);
  assert.equal(
    screen
      .getByRole("link", { name: "Add an exchange rate" })
      .getAttribute("href"),
    "/settings?tab=currencies&from=JPY",
  );
});

test("a complete net worth carries no warning", () => {
  state.netWorth = {
    ...state.netWorth,
    unconverted: { count: 0, currencies: [] },
  };
  renderHero();

  assert.equal(
    screen.queryByRole("button", {
      name: "Not every amount could be converted",
    }),
    null,
  );
});
