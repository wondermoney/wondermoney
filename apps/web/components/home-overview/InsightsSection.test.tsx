// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { Insight } from "@/lib/api/insights/useInsights";

import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import { InsightsSection } from "./InsightsSection";

const state = vi.hoisted(() => ({
  aiHidden: false,
  assistantAvailable: true,
  query: {} as Record<string, unknown>,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));
vi.mock("@/lib/api/insights/useInsights", () => ({
  default: () => state.query,
}));
vi.mock("@/lib/api/instance/useInstance", () => ({
  useFeature: () => state.assistantAvailable,
}));
vi.mock("@/lib/api/user-preferences/useAiHidden", () => ({
  default: () => state.aiHidden,
}));

const messages = { ...commonMessages, ...homeMessages };

const spending: Insight = {
  facts: {
    baselineAmount: "100",
    categoryKey: 9,
    categoryKeys: [10, 11],
    categoryName: "Food",
    currency: "EUR",
    currentAmount: "150",
    daysElapsed: 10,
    deviationPercent: "50.00",
    direction: "above",
    fromDate: "2026-11-01T00:00:00.000Z",
    toDate: "2026-11-10T12:00:00.000Z",
  },
  id: "spending-1",
  period: "2026-11",
  severity: "warning",
  type: "spending_vs_normal",
};

const budget: Insight = {
  facts: {
    amountBudgeted: "250",
    amountSpent: "100",
    budgetKey: 4,
    budgetName: "Plan",
    budgetTemplateCategoryKey: 2,
    categoryKey: 10,
    categoryName: "Groceries",
    currencyCode: "EUR",
    daysElapsed: 10,
    daysInMonth: 30,
    elapsedPercent: "33.33",
    overBy: "50",
    parentCategoryName: "Food",
    projectedAmount: "300",
  },
  id: "budget-1",
  period: "2026-11",
  severity: "critical",
  type: "budget_pace",
};

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InsightsSection />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.aiHidden = false;
  state.assistantAvailable = true;
});

test("renders a spending card with its sentence, figures and filtered transactions link", () => {
  state.query = {
    data: { insights: [spending] },
    error: null,
    isPending: false,
  };
  renderSection();

  assert.ok(screen.getByText("Food is 50% above its usual pace."));
  assert.ok(screen.getByText("Worth a look"));
  const link = screen.getByRole("link", { name: "View transactions" });
  assert.match(link.getAttribute("href") ?? "", /^\/accounts\/transactions\?/);
  assert.match(link.getAttribute("href") ?? "", /categoryKeys=10%2C11/);
  assert.match(link.getAttribute("href") ?? "", /direction=out/);
});

test("renders a budget card with its projection and budget link", () => {
  state.query = { data: { insights: [budget] }, error: null, isPending: false };
  renderSection();

  assert.ok(
    screen.getByText("Food / Groceries is on course to overrun its budget."),
  );
  assert.ok(screen.getByText("Needs attention"));
  assert.equal(
    screen.getByRole("link", { name: "View budget" }).getAttribute("href"),
    "/budgets/4/2026/11",
  );
});

test("shows an empty state when nothing fires", () => {
  state.query = { data: { insights: [] }, error: null, isPending: false };
  renderSection();

  assert.ok(screen.getByText("Nothing unusual this month"));
});

test("shows a retry when the request fails", () => {
  state.query = {
    data: undefined,
    error: new Error("boom"),
    isPending: false,
    refetch: vi.fn(),
  };
  renderSection();

  assert.ok(screen.getByRole("button", { name: /try again/i }));
});

test("offers the assistant on each card when the server has it", () => {
  state.query = {
    data: { insights: [spending, budget] },
    error: null,
    isPending: false,
  };
  renderSection();

  assert.equal(
    screen.getAllByRole("button", { name: "Ask the assistant" }).length,
    2,
  );
});

test("hides the assistant link when the server has no assistant", () => {
  state.assistantAvailable = false;
  state.query = {
    data: { insights: [spending] },
    error: null,
    isPending: false,
  };
  renderSection();

  assert.equal(
    screen.queryByRole("button", { name: "Ask the assistant" }),
    null,
  );
});

test("hides the assistant link when the person turned AI off", () => {
  state.aiHidden = true;
  state.query = {
    data: { insights: [spending] },
    error: null,
    isPending: false,
  };
  renderSection();

  assert.equal(
    screen.queryByRole("button", { name: "Ask the assistant" }),
    null,
  );
});
