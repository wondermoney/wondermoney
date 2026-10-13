import assert from "node:assert/strict";

import { test } from "vitest";

import { invalidateAccounts, invalidatePortfolios } from "../../../utils/queryInvalidation";
import {
  getBackgroundOperationRefetchInterval,
  isKnownBackgroundOperationStatus,
  isTerminalBackgroundOperationStatus,
} from "../backgroundOperation";

test("detects terminal background operation statuses", () => {
  assert.equal(isTerminalBackgroundOperationStatus("succeeded"), true);
  assert.equal(isTerminalBackgroundOperationStatus("partial"), true);
  assert.equal(isTerminalBackgroundOperationStatus("failed"), true);
  assert.equal(isTerminalBackgroundOperationStatus("needs_action"), true);
  assert.equal(isTerminalBackgroundOperationStatus("stale"), true);
  assert.equal(isTerminalBackgroundOperationStatus("queued"), false);
});

test("polls queued and running operations", () => {
  assert.equal(getBackgroundOperationRefetchInterval("queued"), 2000);
  assert.equal(getBackgroundOperationRefetchInterval("running"), 2000);
});

test("continues polling terminal operations until progress is available", () => {
  assert.equal(getBackgroundOperationRefetchInterval("partial", null), 2000);
  assert.equal(getBackgroundOperationRefetchInterval("partial", undefined), 2000);
  assert.equal(getBackgroundOperationRefetchInterval("partial", { imported: 2 }), false);
  assert.equal(getBackgroundOperationRefetchInterval("failed"), false);
  assert.equal(getBackgroundOperationRefetchInterval("needs_action"), false);
  assert.equal(getBackgroundOperationRefetchInterval("stale"), false);
});

test("recognizes known background operation statuses", () => {
  assert.equal(isKnownBackgroundOperationStatus("uploading"), false);
  assert.equal(isKnownBackgroundOperationStatus("queued"), true);
  assert.equal(isKnownBackgroundOperationStatus("running"), true);
});

test("invalidates portfolio aggregate queries", async () => {
  const keys: unknown[] = [];
  const qc = {
    invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
      keys.push(queryKey);
      return Promise.resolve();
    },
  } as any;

  await invalidatePortfolios(qc);

  assert.deepEqual(keys, [
    ["portfolios"],
    ["portfolio"],
    ["portfolio-holdings"],
    ["portfolios-holdings"],
    ["portfolio-transactions"],
    ["portfolio-metrics"],
    ["portfolio-calendar"],
    ["dividend-income"],
  ]);
});

test("invalidates account detail and transaction queries", async () => {
  const keys: unknown[] = [];
  const qc = {
    invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
      keys.push(queryKey);
      return Promise.resolve();
    },
  } as any;

  await invalidateAccounts(qc);

  assert.deepEqual(keys, [
    ["account"],
    ["accounts"],
    ["accounts-transactions"],
    ["account-transactions"],
    ["accounts-metrics"],
    ["account-metrics"],
    ["accounts-cashflow"],
    ["categories"],
    ["transactions-category-spending"],
    ["net-worth"],
  ]);
});
