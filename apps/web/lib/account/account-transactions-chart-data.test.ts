import assert from "node:assert/strict";

import { test } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import { buildAccountTransactionsChartData } from "./account-transactions-chart-data";

function makeTransaction({
  accountKey,
  appuserCurrencyBalance,
  appuserSettlementAmount,
  transactionDate,
  transactionKey,
}: {
  accountKey: number;
  appuserCurrencyBalance: number;
  appuserSettlementAmount: number;
  transactionDate: string;
  transactionKey: number;
}): Transaction {
  return {
    accountKey: {
      accountKey,
      accountName: `Account ${accountKey}`,
      currencyKey: { code: "EUR" as const },
    },
    appuserCurrencyBalance,
    appuserCurrencyKey: { code: "EUR" as const },
    appuserSettlementAmount,
    appuserTransactionCategories: [],
    balance: appuserCurrencyBalance,
    description: "Test",
    descriptionDirty: "Test",
    hidden: false,
    reviewed: true,
    settlementAmount: appuserSettlementAmount,
    settlementCurrencyKey: { code: "EUR" as const },
    transactionDate,
    transactionMerchantKey: undefined,
    transactionKey,
    transactionTypeKey: { name: "payment" },
  };
}

test("uses the latest transaction on or before each date for per-account balance", () => {
  const chartData = buildAccountTransactionsChartData({
    transactions: [
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 150,
        appuserSettlementAmount: 50,
        transactionDate: "2026-01-02T10:00:00.000Z",
        transactionKey: 2,
      }),
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 100,
        appuserSettlementAmount: 100,
        transactionDate: "2026-01-01T10:00:00.000Z",
        transactionKey: 1,
      }),
    ],
    today: new Date("2026-01-02T23:59:59.999Z"),
  });

  assert.equal(chartData[0]?.balance, 100);
  assert.equal(chartData[1]?.balance, 150);
});

test("sorts transactions chronologically regardless of API order", () => {
  const chartData = buildAccountTransactionsChartData({
    transactions: [
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 100,
        appuserSettlementAmount: 100,
        transactionDate: "2026-01-01T10:00:00.000Z",
        transactionKey: 1,
      }),
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 150,
        appuserSettlementAmount: 50,
        transactionDate: "2026-01-02T10:00:00.000Z",
        transactionKey: 2,
      }),
    ],
    today: new Date("2026-01-02T23:59:59.999Z"),
  });

  assert.equal(chartData[0]?.x.toISOString(), "2026-01-01T23:59:59.999Z");
  assert.equal(chartData[0]?.balance, 100);
  assert.equal(chartData[1]?.x.toISOString(), "2026-01-02T23:59:59.999Z");
  assert.equal(chartData[1]?.balance, 150);
});

test("end boundary balance aggregates the latest balance from every account", () => {
  const chartData = buildAccountTransactionsChartData({
    transactions: [
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 250,
        appuserSettlementAmount: 250,
        transactionDate: "2026-01-07T10:00:00.000Z",
        transactionKey: -1,
      }),
      makeTransaction({
        accountKey: 2,
        appuserCurrencyBalance: 1000,
        appuserSettlementAmount: 1000,
        transactionDate: "2026-02-01T10:00:00.000Z",
        transactionKey: -2,
      }),
    ],
    toDate: new Date("2026-02-10T00:00:00.000Z"),
    today: new Date("2026-02-10T23:59:59.999Z"),
  });

  assert.equal(chartData[0]?.x.toISOString(), "2026-01-07T23:59:59.999Z");
  assert.equal(chartData[0]?.balance, 250);
  assert.equal(chartData[1]?.x.toISOString(), "2026-02-01T23:59:59.999Z");
  assert.equal(chartData[1]?.balance, 1250);
  assert.equal(chartData.at(-1)?.x.toISOString(), "2026-02-10T23:59:59.999Z");
  assert.equal(chartData.at(-1)?.balance, 1250);
});

test("all-time mode does not prepend the current month start as a fake first point", () => {
  const chartData = buildAccountTransactionsChartData({
    transactions: [
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 100,
        appuserSettlementAmount: 100,
        transactionDate: "2025-01-15T10:00:00.000Z",
        transactionKey: 1,
      }),
    ],
    today: new Date("2026-03-12T23:59:59.999Z"),
  });

  assert.equal(chartData[0]?.x.toISOString(), "2025-01-15T23:59:59.999Z");
});

test("bounded mode prepends the provided fromDate boundary when needed", () => {
  const chartData = buildAccountTransactionsChartData({
    transactions: [
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 150,
        appuserSettlementAmount: 50,
        transactionDate: "2026-01-03T10:00:00.000Z",
        transactionKey: 2,
      }),
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 100,
        appuserSettlementAmount: 100,
        transactionDate: "2026-01-02T10:00:00.000Z",
        transactionKey: 1,
      }),
    ],
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    today: new Date("2026-01-03T23:59:59.999Z"),
  });

  assert.equal(chartData[0]?.x.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(chartData[0]?.balance, 0);
});

test("bounded mode appends the provided toDate boundary instead of today", () => {
  const chartData = buildAccountTransactionsChartData({
    transactions: [
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 150,
        appuserSettlementAmount: 50,
        transactionDate: "2026-01-02T10:00:00.000Z",
        transactionKey: 2,
      }),
    ],
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    toDate: new Date("2026-01-31T00:00:00.000Z"),
    today: new Date("2026-03-12T23:59:59.999Z"),
  });

  assert.equal(
    chartData[chartData.length - 1]?.x.toISOString(),
    "2026-01-31T23:59:59.999Z",
  );
});

test("boundary balance aggregates opening balances across accounts", () => {
  const chartData = buildAccountTransactionsChartData({
    transactions: [
      makeTransaction({
        accountKey: 1,
        appuserCurrencyBalance: 150,
        appuserSettlementAmount: 50,
        transactionDate: "2026-01-03T10:00:00.000Z",
        transactionKey: 3,
      }),
      makeTransaction({
        accountKey: 2,
        appuserCurrencyBalance: 260,
        appuserSettlementAmount: 60,
        transactionDate: "2026-01-04T10:00:00.000Z",
        transactionKey: 4,
      }),
    ],
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    toDate: new Date("2026-01-31T00:00:00.000Z"),
    today: new Date("2026-01-31T23:59:59.999Z"),
  });

  assert.equal(chartData[0]?.balance, 300);
});
