import assert from "node:assert/strict";

import { test } from "vitest";

import {
  invalidateAccounts,
  invalidateBudgets,
  invalidateCategories,
  invalidateTransactions,
} from "./queryInvalidation";

function createQueryClientRecorder() {
  const queryKeys: unknown[] = [];
  const qc = {
    invalidateQueries: async ({ queryKey }: { queryKey: unknown }) => {
      queryKeys.push(queryKey);
    },
  };

  return { qc, queryKeys };
}

function includesQueryKey(queryKeys: unknown[], key: string) {
  return queryKeys.some(
    (queryKey) => Array.isArray(queryKey) && queryKey[0] === key,
  );
}

test("invalidateAccounts invalidates net-worth for home refresh", async () => {
  const { qc, queryKeys } = createQueryClientRecorder();

  await invalidateAccounts(qc as never);

  assert.ok(includesQueryKey(queryKeys, "net-worth"));
});

test("invalidateCategories refreshes transaction dropdown config categories", async () => {
  const { qc, queryKeys } = createQueryClientRecorder();

  await invalidateCategories(qc as never);

  for (const key of [
    "categories",
    "configs",
    "transactions-category-spending",
  ]) {
    assert.ok(includesQueryKey(queryKeys, key), `${key} should be invalidated`);
  }
});

test("invalidateTransactions refreshes every visible account transaction surface", () => {
  const { qc, queryKeys } = createQueryClientRecorder();

  invalidateTransactions(qc as never);

  for (const key of [
    "transactions",
    "accounts-transactions",
    "account-transactions",
    "accounts-metrics",
    "account-metrics",
    "accounts-cashflow",
    "transactions-category-spending",
    "net-worth",
  ]) {
    assert.ok(includesQueryKey(queryKeys, key), `${key} should be invalidated`);
  }
});

test("invalidateBudgets refreshes route-backed budget overview data", async () => {
  const { qc, queryKeys } = createQueryClientRecorder();
  let refreshCount = 0;

  await invalidateBudgets(qc as never, {
    refresh: () => {
      refreshCount += 1;
    },
  });

  assert.ok(
    queryKeys.some((queryKey) =>
      Array.isArray(queryKey) && queryKey[0] === "budgets-full",
    ),
    "budget edit/delete should invalidate the full budgets list used by overview rows",
  );
  assert.equal(
    refreshCount,
    1,
    "budget edit/delete should refresh route-backed server component data",
  );
});
