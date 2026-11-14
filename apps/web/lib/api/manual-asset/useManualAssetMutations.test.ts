import assert from "node:assert/strict";

import { QueryClient } from "@tanstack/react-query";
import { test } from "vitest";

import { reportsKeys } from "../reports/keys";
import { invalidateManualAssets } from "./useManualAssetMutations";

/** Seeds one query per key and reports which of them a call invalidates. */
function staleAfter(
  run: (client: QueryClient) => void,
  extraKeys: unknown[][] = [],
) {
  const client = new QueryClient();
  const keys = [
    ...extraKeys,
    ["manual-assets"],
    ["manual-asset", "7"],
    ["manual-asset", "8"],
    ["net-worth"],
    ["net-worth-history", 12, "month"],
    reportsKeys.netWorthHistory({} as never),
    ["accounts"],
  ];
  for (const key of keys) client.setQueryData(key, {});
  run(client);
  return client
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => query.queryKey);
}

test("a change to an asset refreshes the list, that asset, and net worth today and over time", () => {
  assert.deepEqual(
    staleAfter((client) => invalidateManualAssets(client, 7)),
    [
      ["manual-assets"],
      ["manual-asset", "7"],
      ["net-worth"],
      ["net-worth-history", 12, "month"],
      reportsKeys.netWorthHistory({} as never),
    ],
  );
});

test("a deleted asset's own page is not refetched", () => {
  const stale = staleAfter((client) => invalidateManualAssets(client));
  assert.equal(
    stale.some((key) => key[0] === "manual-asset"),
    false,
  );
  assert.ok(stale.some((key) => key[0] === "net-worth"));
});

test("a change to an asset refreshes the loans, which show the asset they are secured against", () => {
  const stale = staleAfter(
    (client) => invalidateManualAssets(client, 7),
    [["loans"], ["loan", 5], ["loan", 5, "schedule"]],
  );
  for (const key of [["loans"], ["loan", 5], ["loan", 5, "schedule"]])
    assert.ok(
      stale.some(
        (stalekey) => JSON.stringify(stalekey) === JSON.stringify(key),
      ),
      `${JSON.stringify(key)} is not refreshed`,
    );
});
