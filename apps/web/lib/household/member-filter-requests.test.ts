/**
 * Every surface the member filter applies to sends it the way its endpoint reads it: `memberKeys`
 * on lists, reports, cash flow and budgets, `member` on net worth. Without a filter, nothing is
 * sent, so an unfiltered request is the same as before the filter existed.
 */
import assert from "node:assert/strict";

import type { AxiosInstance } from "axios";
import { test } from "vitest";

import { buildReportFilters } from "@/components/reports/filters/useReportFilters";
import {
  reportTransactionScope,
  transactionReportScopeHref,
} from "@/lib/account/transaction-report-scope";
import { getAccountsCashflow } from "@/lib/api/account/useAccountsCashflow";
import {
  getTransactions,
  transactionSelectionFilter,
} from "@/lib/api/account/useTransactions";
import { getBudgetsFull } from "@/lib/api/budget/useBudgetsFull";
import { getNetWorth } from "@/lib/api/net-worth/useNetWorth";
import { getCashflow } from "@/lib/api/reports/cashflow";

/** A client that records the params of every GET and answers with `data`. */
function recordingClient(data: unknown) {
  const sent: { url: string; params: Record<string, unknown> | undefined }[] = [];
  const client = {
    get: async (url: string, config?: { params?: Record<string, unknown> }) => {
      sent.push({ url, params: config?.params });
      return { data };
    },
  } as unknown as AxiosInstance;
  return { client, sent };
}

const netWorthSummary = {
  currencyCode: "EUR",
  totalNetWorth: 0,
  assets: { accounts: 0, portfolios: 0 },
  liabilities: { loans: 0 },
  rows: [],
  unsupportedCurrencies: { loans: 0, portfolios: 0 },
};

test("net worth asks for one member, or Shared, by `member`", async () => {
  const { client, sent } = recordingClient(netWorthSummary);
  await getNetWorth(client, 4);
  await getNetWorth(client, "shared");
  await getNetWorth(client);

  assert.deepEqual(
    sent.map((request) => request.params),
    [{ member: "4" }, { member: "shared" }, undefined],
  );
});

test("the transaction list, its bulk selection and cash flow send memberKeys", async () => {
  const list = recordingClient({ transactions: [] });
  await getTransactions({ memberKeys: ["shared"] }, list.client);
  assert.equal(list.sent[0].params?.memberKeys, "shared");
  assert.equal(transactionSelectionFilter({ memberKeys: ["4"] }).memberKeys, "4");
  assert.equal("memberKeys" in transactionSelectionFilter({}), false);

  const cashflow = recordingClient({ cashflow: [] });
  await getAccountsCashflow({ memberKeys: ["4"] }, cashflow.client);
  await getAccountsCashflow({}, cashflow.client);
  assert.equal(cashflow.sent[0].params?.memberKeys, "4");
  assert.equal("memberKeys" in (cashflow.sent[1].params ?? {}), false);
});

test("budgets send memberKeys only when filtered", async () => {
  const { client, sent } = recordingClient({ budgets: [] });
  await getBudgetsFull(client, { memberKeys: ["4"] });
  await getBudgetsFull(client);

  assert.deepEqual(sent[0].params, { memberKeys: "4" });
  assert.equal(sent[1].params, undefined);
});

test("a report's URL member reaches its request and its CSV, and its drill-through link", async () => {
  const filters = buildReportFilters(
    new URLSearchParams({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-31T23:59:59.999Z",
      member: "4",
    }),
    undefined,
  );
  assert.deepEqual(filters.memberKeys, ["4"]);
  assert.equal(
    "memberKeys" in buildReportFilters(new URLSearchParams(), undefined),
    false,
  );

  const { client, sent } = recordingClient(new Blob());
  await getCashflow({ ...filters, format: "csv" }, client);
  assert.equal(sent[0].url, "/v1/reports/cashflow.csv");
  assert.deepEqual(sent[0].params?.memberKeys, ["4"]);

  const scope = reportTransactionScope(filters, "out");
  assert.ok(scope);
  const href = new URL(transactionReportScopeHref(scope), "https://example.com");
  assert.equal(href.searchParams.get("member"), "4");
});
