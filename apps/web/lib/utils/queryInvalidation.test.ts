import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("budget mutation dialogs use shared invalidation with route refresh", () => {
  for (const filePath of [
    "components/budget/BudgetEditModal.tsx",
    "components/budget/BudgetDeleteModal.tsx",
  ]) {
    const source = readFileSync(filePath, "utf8");

    assert.match(
      source,
      /invalidateBudgets/,
      `${filePath} should use the shared budget invalidation helper`,
    );
    assert.match(
      source,
      /useRouter\(/,
      `${filePath} should access the router so successful mutations can refresh route-backed data`,
    );
    assert.match(
      source,
      /refresh:\s*(?:router\.refresh|\(\)\s*=>\s*router\.refresh\(\))/,
      `${filePath} should pass router.refresh to budget invalidation`,
    );
  }
});
