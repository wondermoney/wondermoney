import assert from "node:assert/strict";

import { test } from "vitest";

import type { LoanListItem } from "@/lib/api/loan/types";
import type { NetWorth } from "@/lib/api/net-worth/useNetWorth";
import type { BudgetRow, BudgetSubRow } from "@/lib/budget/rows";

import {
  balanceSheet,
  cashflowScale,
  measureGeometry,
  monthComparisonRange,
  monthPosition,
  monthSummary,
  netWorthChanges,
  overPlanLines,
  savingsSummary,
  upcomingLoanPayments,
} from "./month-overview";

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message ?? "value"}: expected ${expected}, got ${actual}`,
  );

function sub(
  key: number,
  name: string,
  budgeted: number,
  spent: number,
): BudgetSubRow {
  return {
    key,
    name,
    budgeted,
    spent,
    recurrency: 12,
    icon: "",
    textColor: "",
    bgColor: "",
    isSystemCategory: true,
  };
}

function row(
  key: number,
  name: string,
  budgeted: number,
  spent: number,
  subRows: BudgetSubRow[] = [],
): BudgetRow {
  return { ...sub(key, name, budgeted, spent), recurrency: undefined, subRows };
}

// The demo household's October, as convertBudgetTemplatesIntoRows hands it over.
const october: BudgetRow[] = [
  row(7, "DEPENDENTS", 150, 0, [
    sub(29, "LEISURE", 50, 0),
    sub(28, "EDUCATION", 100, 0),
  ]),
  row(5, "ENTERTAINMENT", 25.8333, 19.9991, [
    sub(25, "STREAMING_SERVICES", 20, 0),
    sub(24, "HOBBIES_AND_LEISURE", 5.8333, 19.9991),
  ]),
  row(3, "FOOD", 548.3333, 327.8936, [
    sub(17, "GROCERIES", 525, 182.9097),
    sub(19, "FOOD_DELIVERY", 7, 0),
    sub(18, "CAFE_RESTAURANTS_BARS", 16.3333, 144.9839),
  ]),
  row(1, "HOUSING", 58.3333, 280, [sub(10, "RENT_MORTGAGE", 58.3333, 280)]),
  row(36, "INCOME", 0, 0),
];

/* ---------- left to spend ---------- */

test("left to spend is what the month plans minus what it has spent", () => {
  const summary = monthSummary([row(1, "A", 100, 30), row(2, "B", 50, 5)]);

  close(summary.planned, 150, "planned");
  close(summary.spent, 35, "spent");
  close(summary.left, 115, "left");
  assert.equal(summary.isOverspent, false);
});

test("left to spend goes negative, and says so, once spending passes the plan", () => {
  const summary = monthSummary([row(1, "A", 100, 130.5)]);

  close(summary.left, -30.5, "left");
  assert.equal(summary.isOverspent, true);
});

test("a parent's plan is what its children plan per month, as on the budget screen", () => {
  // A yearly €600 child plans €50 a month; the raw parent figure must not leak in.
  const yearly = { ...sub(2, "VEHICLE_INSURANCE", 600, 0), recurrency: 1 };
  const summary = monthSummary([
    row(1, "TRANSPORTATION", 680, 0, [yearly, sub(3, "FUEL", 80, 0)]),
  ]);

  close(summary.planned, 130, "planned");
});

test("a month with no categories plans and spends nothing", () => {
  const summary = monthSummary([]);

  assert.deepEqual(
    { planned: summary.planned, spent: summary.spent, left: summary.left },
    { planned: 0, spent: 0, left: 0 },
  );
  assert.equal(summary.isOverspent, false);
});

/* ---------- where today sits in the month ---------- */

test("today's position counts the whole of today as gone", () => {
  const position = monthPosition(new Date(2026, 9, 25, 9, 30));

  assert.equal(position.day, 25);
  assert.equal(position.daysInMonth, 31);
  assert.equal(position.daysLeft, 6);
  close(position.fraction, 25 / 31, "fraction");
});

test("today's position knows a leap February", () => {
  const position = monthPosition(new Date(2028, 1, 29));

  assert.equal(position.daysInMonth, 29);
  assert.equal(position.daysLeft, 0);
  close(position.fraction, 1, "fraction");
});

/* ---------- the measure ---------- */

test("the measure draws plan, spent and overspend on one shared scale", () => {
  const within = measureGeometry(40, 80, 200);
  close(within.plan, 40, "plan");
  close(within.fill, 20, "fill");
  close(within.over, 0, "over");

  const over = measureGeometry(280, 58.3333, 280);
  close(over.plan, (58.3333 / 280) * 100, "plan");
  close(over.fill, (58.3333 / 280) * 100, "fill stops at the plan");
  close(over.plan + over.over, 100, "overspend runs to the end of the scale");
});

test("the measure never draws past its scale or below zero", () => {
  const clipped = measureGeometry(500, 100, 200);
  close(clipped.plan + clipped.over, 100, "clipped to the scale");

  const refund = measureGeometry(-12, 50, 100);
  close(refund.fill, 0, "a refund draws no spending");
  close(refund.over, 0, "a refund is never over plan");

  assert.deepEqual(measureGeometry(10, 5, 0), { plan: 0, fill: 0, over: 0 });
});

test("spending with no plan is drawn entirely as overspend", () => {
  const geometry = measureGeometry(25, 0, 50);

  close(geometry.plan, 0, "plan");
  close(geometry.fill, 0, "fill");
  close(geometry.over, 50, "over");
});

/* ---------- over-plan detection ---------- */

test("over-plan lists the most specific lines that spent past their plan, worst first", () => {
  const lines = overPlanLines(october);

  assert.deepEqual(
    lines.map((line) => [line.name, line.parentName]),
    [
      ["RENT_MORTGAGE", "HOUSING"],
      ["CAFE_RESTAURANTS_BARS", "FOOD"],
      ["HOBBIES_AND_LEISURE", "ENTERTAINMENT"],
    ],
  );
  close(lines[0].over, 280 - 58.3333, "rent overspend");
  close(lines[1].over, 144.9839 - 16.3333, "cafe overspend");
});

test("a parent over plan is listed itself when none of its children are", () => {
  // Spending booked to the parent category directly, not to any child.
  const lines = overPlanLines([
    row(4, "TRANSPORTATION", 100, 140, [sub(20, "FUEL", 100, 60)]),
  ]);

  assert.deepEqual(
    lines.map((line) => [line.name, line.parentName]),
    [["TRANSPORTATION", null]],
  );
  close(lines[0].over, 40, "over");
});

test("a fraction of a cent past the plan is not over plan", () => {
  assert.deepEqual(overPlanLines([row(1, "FOOD", 100, 100.004)]), []);
  assert.equal(overPlanLines([row(1, "FOOD", 100, 100.01)]).length, 1);
});

test("a standalone category with spending but no plan is over plan by all of it", () => {
  const lines = overPlanLines([row(9, "MyCustomCategory", 0, 12)]);

  assert.equal(lines.length, 1);
  close(lines[0].over, 12, "over");
});

/* ---------- net worth over time ---------- */

// The history report's month-closing points, each dated the first of its month.
const history = [
  { date: "2025-12-01T00:00:00.000Z", netWorth: 107026.26 },
  { date: "2026-09-01T00:00:00.000Z", netWorth: 135329.16 },
  { date: "2026-10-01T00:00:00.000Z", netWorth: 137069.69 },
  { date: "2026-11-01T00:00:00.000Z", netWorth: 136134.06 },
];

test("net worth's change runs from last month's close and from the oldest month to today's figure", () => {
  const changes = netWorthChanges(history, 136500, new Date(2026, 10, 4));

  assert.equal(changes.lastMonth?.since, "2026-10-01T00:00:00.000Z");
  close(changes.lastMonth?.delta ?? NaN, 136500 - 137069.69, "since October");
  assert.equal(changes.overHistory?.since, "2025-12-01T00:00:00.000Z");
  close(
    changes.overHistory?.delta ?? NaN,
    136500 - 107026.26,
    "since December",
  );
});

test("net worth's change reads the history in date order, however it arrives", () => {
  const changes = netWorthChanges(
    [...history].reverse(),
    136134.06,
    new Date(2026, 10, 30),
  );

  assert.equal(changes.lastMonth?.since, "2026-10-01T00:00:00.000Z");
  assert.equal(changes.overHistory?.since, "2025-12-01T00:00:00.000Z");
});

test("January's last month is December of the year before", () => {
  const changes = netWorthChanges(history, 108000, new Date(2026, 0, 15));

  assert.equal(changes.lastMonth?.since, "2025-12-01T00:00:00.000Z");
  assert.equal(changes.overHistory, null, "no month older than last month");
});

test("with no close for last month there is no monthly change, and no history means no change at all", () => {
  const gap = netWorthChanges(
    [history[0], history[3]],
    136134.06,
    new Date(2026, 10, 4),
  );
  assert.equal(gap.lastMonth, null);
  assert.equal(gap.overHistory?.since, "2025-12-01T00:00:00.000Z");

  assert.deepEqual(netWorthChanges([], 100, new Date(2026, 10, 4)), {
    lastMonth: null,
    overHistory: null,
  });
});

/* ---------- the balance sheet ---------- */

const demoNetWorth: NetWorth = {
  netWorth: -145896.9614,
  currencyCode: "EUR",
  rows: [
    {
      key: "accounts:Revolut USD Account",
      label: "Revolut USD Account",
      amount: 785.2948,
    },
    { key: "accounts:Emergency Fund", label: "Emergency Fund", amount: 0 },
    {
      key: "accounts:ActivoBank Current Account",
      label: "ActivoBank Current Account",
      amount: 1447.4838,
    },
    {
      key: "portfolios:US growth portfolio",
      label: "US growth portfolio",
      amount: 1215.19,
    },
    {
      key: "portfolios:Short-term opportunities",
      label: "Short-term opportunities",
      amount: 3225.88,
    },
    {
      key: "portfolios:Long-term investments",
      label: "Long-term investments",
      amount: 1079.19,
    },
    {
      key: "loans:Crédito pessoal",
      label: "Crédito pessoal",
      amount: -3200,
      isLiability: true,
    },
    {
      key: "loans:Family car loan",
      label: "Family car loan",
      amount: -8420,
      isLiability: true,
    },
    {
      key: "loans:Home mortgage",
      label: "Home mortgage",
      amount: -142030,
      isLiability: true,
    },
  ],
};

test("the balance sheet totals what is owned and owed, and they net to net worth", () => {
  const sheet = balanceSheet(demoNetWorth);

  close(sheet.ownTotal, 7753.0386, "own");
  close(sheet.oweTotal, 153650, "owe");
  close(
    sheet.ownTotal - sheet.oweTotal,
    demoNetWorth.netWorth,
    "nets to net worth",
  );
  assert.deepEqual(
    sheet.own.map((group) => [group.type, group.rows.length]),
    [
      ["accounts", 3],
      ["portfolios", 3],
    ],
  );
  assert.deepEqual(
    sheet.owe.map((group) => [group.type, group.rows.map((r) => r.amount)]),
    [["loans", [3200, 8420, 142030]]],
  );
});

test("accounts in the balance sheet follow the member's account order", () => {
  const sheet = balanceSheet(
    {
      netWorth: 300,
      rows: [
        { key: "accounts:1", recordId: 1, label: "Alpha", amount: 100 },
        { key: "accounts:2", recordId: 2, label: "Beta", amount: 100 },
        { key: "accounts:3", recordId: 3, label: "Gamma", amount: 100 },
      ],
    },
    [3, 1],
  );

  assert.deepEqual(
    sheet.own[0]?.rows.map((row) => row.label),
    ["Gamma", "Alpha", "Beta"],
  );
});

test("an account with a negative balance is owed, not owned", () => {
  const sheet = balanceSheet({
    netWorth: 400,
    rows: [
      { key: "accounts:Current", label: "Current", amount: 1000 },
      {
        key: "accounts:Credit card",
        label: "Credit card",
        amount: -600,
        isLiability: true,
      },
    ],
  });

  close(sheet.ownTotal, 1000, "own");
  close(sheet.oweTotal, 600, "owe");
  assert.deepEqual(
    sheet.owe.map((group) => group.type),
    ["accounts"],
  );
});

test("a portfolio already inside its account's balance is listed but not added", () => {
  const sheet = balanceSheet({
    netWorth: 11000,
    rows: [
      { key: "accounts:Current", label: "Current", amount: 1000 },
      { key: "accounts:Brokerage", recordId: 5, label: "Brokerage", amount: 10000 },
      { key: "portfolios:Shares", label: "Shares", amount: 8000, countedInAccountId: 5 },
    ],
  });

  close(sheet.ownTotal, 11000, "own");
  const portfolios = sheet.own.find((group) => group.type === "portfolios");
  assert.equal(portfolios?.total, 0);
  assert.deepEqual(portfolios?.rows.map((row) => [row.amount, row.countedInAccountId]), [[8000, 5]]);
});

test("a manually valued asset is owned, in its own group after portfolios", () => {
  const sheet = balanceSheet({
    netWorth: 259000,
    rows: [
      { key: "accounts:1", label: "Current", amount: 1000 },
      { key: "manualAssets:7", recordId: 7, label: "Home", amount: 250000 },
      { key: "portfolios:2", label: "Shares", amount: 8000 },
    ],
  });

  close(sheet.ownTotal, 259000, "own");
  assert.deepEqual(
    sheet.own.map((group) => [group.type, group.total]),
    [
      ["accounts", 1000],
      ["portfolios", 8000],
      ["manualAssets", 250000],
    ],
  );
});

test("an empty balance sheet has nothing on either side", () => {
  const sheet = balanceSheet({ netWorth: 0, rows: [] });

  assert.deepEqual(
    [sheet.ownTotal, sheet.oweTotal, sheet.own.length, sheet.owe.length],
    [0, 0, 0, 0],
  );
});

/* ---------- net cash flow ---------- */

test("cash flow bars diverge from one zero line, oldest month first", () => {
  const scale = cashflowScale([
    { date: "2026-10-01T00:00:00.000Z", amount: -947.89 },
    { date: "2026-09-01T00:00:00.000Z", amount: -292.63 },
    { date: "2026-06-01T00:00:00.000Z", amount: 2000 },
  ]);

  const span = 947.89 + 2000;
  close(scale.zero, (947.89 / span) * 100, "zero line");
  assert.deepEqual(
    scale.bars.map((bar) => bar.date),
    [
      "2026-06-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ],
  );
  close(scale.bars[0].width, (2000 / span) * 100, "june width");
  close(scale.bars[2].width, (947.89 / span) * 100, "october width");
});

test("cash flow with only outflows puts the zero line at the right edge", () => {
  const scale = cashflowScale([
    { date: "2026-08-01T00:00:00.000Z", amount: -100 },
    { date: "2026-09-01T00:00:00.000Z", amount: -50 },
  ]);

  close(scale.zero, 100, "zero");
  close(scale.bars[1].width, 50, "september width");
});

test("cash flow of nothing but zeros draws no bars", () => {
  const scale = cashflowScale([
    { date: "2026-08-01T00:00:00.000Z", amount: 0 },
  ]);

  close(scale.zero, 0, "zero");
  close(scale.bars[0].width, 0, "width");
});

/* ---------- next loan payments ---------- */

function loan(overrides: Partial<LoanListItem>): LoanListItem {
  return {
    loanKey: 1,
    name: "Loan",
    type: "MORTGAGE",
    status: "ACTIVE",
    currency: { currencyKey: 151, code: "EUR" },
    openingPrincipalBalance: 1000,
    outstandingPrincipal: 1000,
    includeInNetWorth: true,
    regularPaymentAmount: 100,
    nextPaymentDate: "2026-11-15T00:00:00.000Z",
    ...overrides,
  } as LoanListItem;
}

test("next loan payments are the active loans' upcoming dates, soonest first", () => {
  const today = new Date(2026, 10, 2);
  const payments = upcomingLoanPayments(
    [
      loan({
        loanKey: 2,
        name: "Car",
        nextPaymentDate: "2026-11-15T00:00:00.000Z",
      }),
      loan({
        loanKey: 3,
        name: "Mortgage",
        nextPaymentDate: "2026-11-03T00:00:00.000Z",
      }),
      loan({
        loanKey: 4,
        name: "Paid off",
        status: "PAID_OFF",
        nextPaymentDate: "2026-11-04T00:00:00.000Z",
      }),
      loan({ loanKey: 5, name: "No date", nextPaymentDate: null }),
      loan({
        loanKey: 6,
        name: "Past",
        nextPaymentDate: "2026-10-20T00:00:00.000Z",
      }),
    ],
    today,
  );

  assert.deepEqual(
    payments.map((payment) => payment.name),
    ["Mortgage", "Car"],
  );
});

test("a yearly subcategory is over plan against its monthly share, not its yearly sum", () => {
  // €600 a year plans €50 a month; €60 spent this month is €10 over.
  const yearly = { ...sub(22, "VEHICLE_INSURANCE", 600, 60), recurrency: 1 };
  const lines = overPlanLines([row(4, "TRANSPORTATION", 50, 60, [yearly])]);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].name, "VEHICLE_INSURANCE");
  close(lines[0].planned, 50, "monthly plan");
  close(lines[0].over, 10, "over");
});

test("month-to-date compares against the same days of last month", () => {
  // 5 November: compare 1-5 November with 1-5 October.
  const early = monthComparisonRange(new Date(2026, 10, 5, 12));
  assert.equal(early.samePoint, true);
  assert.equal(early.from.getTime(), new Date(2026, 9, 1).getTime());
  assert.equal(early.to.getTime(), new Date(2026, 9, 5, 23, 59, 59, 999).getTime());

  // The last day of November: the whole of October.
  const lastDay = monthComparisonRange(new Date(2026, 10, 30, 12));
  assert.equal(lastDay.samePoint, false);
  assert.equal(lastDay.to.getTime(), new Date(2026, 9, 31, 23, 59, 59, 999).getTime());
});

test("a short previous month clamps the same-point comparison to its last day", () => {
  // 30 March: February has 28 days, so the comparison ends on 28 February.
  const range = monthComparisonRange(new Date(2026, 2, 30, 12));
  assert.equal(range.samePoint, true);
  assert.equal(range.to.getTime(), new Date(2026, 1, 28, 23, 59, 59, 999).getTime());
});

test("the savings summary states this month beside the comparison period", () => {
  const range = monthComparisonRange(new Date(2026, 10, 5, 12));
  const summary = savingsSummary(
    { expenses: 1400, income: 2000, savingsRate: 0.3 },
    { expenses: 1450, income: 1900, savingsRate: 0.2368 },
    range,
  );

  assert.ok(summary);
  assert.equal(summary.income, 2000);
  assert.equal(summary.spending, 1400);
  assert.equal(summary.savingsRate, 0.3);
  assert.equal(summary.incomeDelta, 100);
  assert.equal(summary.spendingDelta, -50);
  close(summary.savingsRateDelta ?? 0, 6.32, "rate delta in points");
  assert.equal(summary.comparison?.samePoint, true);
});

test("a comparison period with no data has no deltas, not zero ones", () => {
  const range = monthComparisonRange(new Date(2026, 10, 5, 12));
  const summary = savingsSummary(
    { expenses: 1400, income: 2000, savingsRate: 0.3 },
    undefined,
    range,
  );

  assert.ok(summary);
  assert.equal(summary.comparison, null);
  assert.equal(summary.incomeDelta, null);
  assert.equal(summary.spendingDelta, null);
  assert.equal(summary.savingsRateDelta, null);
});

test("a month with no income has no savings rate and no rate delta", () => {
  const range = monthComparisonRange(new Date(2026, 10, 5, 12));
  const summary = savingsSummary(
    { expenses: 400, income: 0, savingsRate: null },
    { expenses: 300, income: 1000, savingsRate: 0.7 },
    range,
  );

  assert.ok(summary);
  assert.equal(summary.savingsRate, null);
  assert.equal(summary.savingsRateDelta, null);
});

test("a carry from last month moves what is left and what counts as over plan", () => {
  const groceries = { ...sub(17, "GROCERIES", 100, 120), rolledOver: 40 };
  const cafes = { ...sub(18, "CAFE_RESTAURANTS_BARS", 50, 40), rolledOver: -25 };
  const rows = [{ ...row(3, "FOOD", 150, 160, [groceries, cafes]), rolledOver: 15 }];

  // Groceries spent past its plan but within plan plus surplus; cafes stayed
  // under plan but past what the carried overspend left.
  assert.deepEqual(
    overPlanLines(rows).map((line) => [line.name, line.over]),
    [["CAFE_RESTAURANTS_BARS", 15]],
  );
  const summary = monthSummary(rows);
  close(summary.planned, 150, "planned");
  close(summary.left, 5, "left");
});
