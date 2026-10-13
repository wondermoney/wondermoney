import assert from "node:assert/strict";

import { test } from "vitest";

import {
  getPortfolioHistoryStatusPollingState,
  getPortfolioHistoryStatusPollInterval,
  getPortfolioHistoryStatusRefetchInterval,
  normalizePortfolioHistoryStatus,
} from "../usePortfolioHistoryStatus";

test("normalizes portfolio history statuses", () => {
  assert.equal(normalizePortfolioHistoryStatus("ready"), "ready");
  assert.equal(normalizePortfolioHistoryStatus("processing"), "processing");
  assert.equal(normalizePortfolioHistoryStatus("partial"), "partial");
  assert.equal(normalizePortfolioHistoryStatus("unavailable"), "unavailable");
  assert.equal(normalizePortfolioHistoryStatus("unknown" as never), undefined);
});

test("backs off portfolio history polling until capped", () => {
  const status = {
    assetsPending: 3,
    assetsReady: 1,
    assetsTotal: 4,
    earliestRequiredDate: null,
    earliestSnapshotDate: null,
    latestSnapshotDate: null,
    status: "processing" as const,
  };

  assert.equal(getPortfolioHistoryStatusRefetchInterval(status), 2000);
  assert.equal(getPortfolioHistoryStatusRefetchInterval(status, "same", 2000), 2000);
  assert.equal(
    getPortfolioHistoryStatusRefetchInterval(status, firstFingerprint(status), 4000),
    8000,
  );
  assert.equal(
    getPortfolioHistoryStatusRefetchInterval(status, firstFingerprint(status), 16000),
    30000,
  );
});

test("resets portfolio history polling when status or progress changes", () => {
  const initial = {
    assetsPending: 3,
    assetsReady: 1,
    assetsTotal: 4,
    earliestRequiredDate: null,
    earliestSnapshotDate: null,
    latestSnapshotDate: null,
    status: "processing" as const,
  };

  const progressed = {
    ...initial,
    assetsPending: 2,
  };

  assert.equal(getPortfolioHistoryStatusRefetchInterval(progressed, "previous", 8000), 2000);
});

test("stops polling when portfolio history is ready or unavailable", () => {
  assert.equal(
    getPortfolioHistoryStatusRefetchInterval({
      assetsPending: 0,
      assetsReady: 4,
      assetsTotal: 4,
      earliestRequiredDate: null,
      earliestSnapshotDate: null,
      latestSnapshotDate: null,
      status: "ready",
    }),
    false,
  );

  assert.equal(
    getPortfolioHistoryStatusRefetchInterval({
      assetsPending: 2,
      assetsReady: 2,
      assetsTotal: 4,
      earliestRequiredDate: null,
      earliestSnapshotDate: null,
      latestSnapshotDate: null,
      status: "unavailable",
    }),
    false,
  );
});

test("continues polling when status is partial", () => {
  assert.notEqual(
    getPortfolioHistoryStatusRefetchInterval({
      assetsPending: 0,
      assetsReady: 4,
      assetsTotal: 4,
      earliestRequiredDate: null,
      earliestSnapshotDate: null,
      latestSnapshotDate: null,
      status: "partial",
    }),
    false,
  );
});

test("does not advance backoff without new data", () => {
  const status = {
    assetsPending: 3,
    assetsReady: 1,
    assetsTotal: 4,
    earliestRequiredDate: null,
    earliestSnapshotDate: null,
    latestSnapshotDate: null,
    status: "processing" as const,
  };

  const first = getPortfolioHistoryStatusPollingState(status, undefined, undefined);
  const sameData = getPortfolioHistoryStatusPollInterval(
    { dataUpdatedAt: 10, fingerprint: first.fingerprint, intervalMs: first.intervalMs },
    10,
    status,
  );
  const newData = getPortfolioHistoryStatusPollInterval(
    { dataUpdatedAt: 10, fingerprint: first.fingerprint, intervalMs: first.intervalMs },
    11,
    status,
  );

  assert.equal(first.interval, 2000);
  assert.equal(sameData.interval, 2000);
  assert.equal(newData.interval, 4000);
});

function firstFingerprint(status: {
  assetsPending: number;
  assetsReady: number;
  assetsTotal: number;
  earliestRequiredDate: string | null;
  earliestSnapshotDate: string | null;
  latestSnapshotDate: string | null;
  status: "processing";
}) {
  return [
    status.status,
    status.assetsPending,
    status.assetsReady,
    status.assetsTotal,
    status.earliestRequiredDate ?? "",
    status.earliestSnapshotDate ?? "",
    status.latestSnapshotDate ?? "",
    "",
    "",
  ].join("|");
}
