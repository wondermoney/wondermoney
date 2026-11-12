// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { BudgetFull } from "@/lib/api/budget/useBudgetsFull";
import type {
  BudgetCategory,
  GetBudgetTemplateByYearAndMonthRequest,
  GetBudgetTemplateByYearAndMonthResponse,
} from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";

import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import { ThisMonthSection } from "./ThisMonthSection";

const state = vi.hoisted(() => ({
  budgets: [] as BudgetFull[],
  months: new Map<number, BudgetCategory[]>(),
  completeness: new Map<
    number,
    GetBudgetTemplateByYearAndMonthResponse["completeness"]
  >(),
  requested: [] as GetBudgetTemplateByYearAndMonthRequest[][],
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));
vi.mock("@/lib/api/budget/useBudgetsFull", () => ({
  default: () => ({
    data: { budgets: state.budgets },
    error: null,
    isPending: false,
    refetch: () => {},
  }),
}));
vi.mock("@/lib/api/budget/useBudgetTemplateByYearAndMonth", () => ({
  useBudgetTemplatesByYearAndMonth: (
    params: GetBudgetTemplateByYearAndMonthRequest[],
  ) => {
    state.requested.push(params);
    return params.map(({ budgetKey, month, year }) => ({
      data: {
        hasNextMonth: false,
        hasPreviousMonth: true,
        budget: {
          ...state.budgets.find((budget) => budget.budgetKey === budgetKey)!,
          month,
          year,
          categories: state.months.get(budgetKey) ?? [],
        },
        completeness: state.completeness.get(budgetKey),
      } satisfies GetBudgetTemplateByYearAndMonthResponse,
      error: null,
      isPending: false,
      refetch: () => {},
    }));
  },
}));

const messages = { ...commonMessages, ...homeMessages };

function category(
  key: number,
  name: string,
  planned: number,
  spent: number,
): BudgetCategory {
  return {
    category_key: key,
    parent_category_name: name,
    child_category_name: null,
    category_budgeted_amount: planned,
    category_amount: spent,
    category_recurrency: null,
    category_icon: "",
    category_text_color: "",
    category_bg_color: "",
    category_is_system_category: false,
    child_category_icon: "",
    child_category_text_color: "",
    child_category_bg_color: "",
  };
}

function budget(budgetKey: number, name: string): BudgetFull {
  return {
    budgetKey,
    name,
    currencyCode: "EUR",
    month: 11,
    year: 2026,
    accounts: [],
    categories: [],
    incomes: [],
    period: { firstDay: "2026-11-01", lastDay: "2026-11-30" },
    periodStartDay: 1,
    rolloverCarriesOverspend: true,
    rolloverComplete: true,
  };
}

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThisMonthSection />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 4, 12), toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.budgets = [];
  state.months.clear();
  state.completeness.clear();
  state.requested = [];
});

test("every budget gets its own row for the current month, each linking to that month", () => {
  state.budgets = [
    budget(2, "Household"),
    budget(5, "Holiday"),
    budget(9, "Kids"),
  ];
  state.months.set(2, [
    category(1, "Food", 500, 320),
    category(2, "Housing", 300, 360),
  ]);
  state.months.set(5, [category(3, "Travel", 1000, 250)]);
  state.months.set(9, [category(4, "School", 200, 0)]);

  renderSection();

  assert.deepEqual(state.requested.at(-1), [
    { budgetKey: 2, year: 2026, month: 11 },
    { budgetKey: 5, year: 2026, month: 11 },
    { budgetKey: 9, year: 2026, month: 11 },
  ]);

  const section = screen.getByRole("region", { name: "This month" });
  const rows = within(section).getAllByRole("listitem");
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map(
      (row) => within(row).getByRole("heading", { level: 3 }).textContent,
    ),
    ["Household", "Holiday", "Kids"],
  );
  assert.deepEqual(
    rows.map((row) => within(row).getByRole("link").getAttribute("href")),
    ["/budgets/2/2026/11", "/budgets/5/2026/11", "/budgets/9/2026/11"],
  );

  const household = rows[0].textContent ?? "";
  assert.match(household, /€120\.00\s*left to spend/);
  assert.match(household, /€680\.00 spent of €800\.00 planned/);
  assert.match(household, /1 category over plan/);

  const holiday = rows[1].textContent ?? "";
  assert.match(holiday, /€750\.00\s*left to spend/);
  assert.doesNotMatch(holiday, /over plan/);

  assert.match(
    within(section).getByText(/days of November to go/).textContent ?? "",
    /26 days of November to go/,
  );
});

test("a budget whose month starts on payday is read and linked in its own current month", () => {
  // From 25 November a budget starting on the 25th is in its December month.
  state.budgets = [
    budget(2, "Household"),
    {
      ...budget(5, "Payday"),
      month: 12,
      period: { firstDay: "2026-11-25", lastDay: "2026-12-24" },
      periodStartDay: 25,
    },
  ];
  state.months.set(2, [category(1, "Food", 500, 320)]);
  state.months.set(5, [category(3, "Travel", 1000, 250)]);

  renderSection();

  assert.deepEqual(state.requested.at(-1), [
    { budgetKey: 2, year: 2026, month: 11 },
    { budgetKey: 5, year: 2026, month: 12 },
  ]);
  assert.deepEqual(
    screen
      .getAllByRole("listitem")
      .map((row) => within(row).getByRole("link").getAttribute("href")),
    ["/budgets/2/2026/11", "/budgets/5/2026/12"],
  );
});

test("a budget spent past its plan says so in words, with the sign", () => {
  state.budgets = [budget(2, "Household")];
  state.months.set(2, [
    category(1, "Food", 100, 130),
    category(2, "Fun", 50, 60),
  ]);

  renderSection();

  const row = screen.getByRole("listitem");
  assert.match(row.textContent ?? "", /−€40\.00\s*over the plan/);
  assert.match(row.textContent ?? "", /2 categories over plan/);
});

test("with no budget the section offers to create one", () => {
  renderSection();

  const section = screen.getByRole("region", { name: "This month" });
  assert.ok(within(section).getByText("No budget yet"));
  assert.equal(
    within(section)
      .getByRole("link", { name: "Create a budget" })
      .getAttribute("href"),
    "/budgets",
  );
  assert.equal(within(section).queryAllByRole("listitem").length, 0);
});

test("a budget that leaves out unconverted rows says how many and in which currencies", () => {
  state.budgets = [budget(2, "Household"), budget(5, "Holiday")];
  state.months.set(2, [category(1, "Food", 500, 320)]);
  state.months.set(5, [category(3, "Travel", 1000, 250)]);
  state.completeness.set(2, {
    currencyCode: "EUR",
    isComplete: false,
    unconvertedCurrencies: ["JPY", "USD"],
    unconvertedTransactions: 3,
  });
  state.completeness.set(5, {
    currencyCode: "EUR",
    isComplete: true,
    unconvertedCurrencies: [],
    unconvertedTransactions: 0,
  });

  renderSection();

  const [household, holiday] = screen.getAllByRole("listitem");
  assert.match(
    within(household).getByRole("note").textContent ?? "",
    /3 transactions in JPY and USD are left out/,
  );
  assert.equal(within(holiday).queryByRole("note"), null);
});
