import assert from "node:assert/strict";

import type { AxiosInstance } from "axios";
import { test } from "vitest";

import { getNetWorth, type RawNetWorthSummary } from "./useNetWorth";

const summary = (fields: Partial<RawNetWorthSummary>): RawNetWorthSummary => ({
  currencyCode: "EUR",
  totalNetWorth: 1000,
  assets: { accounts: 1000, portfolios: 0 },
  liabilities: { loans: 0 },
  rows: [],
  unsupportedCurrencies: { accounts: 0, loans: 0, portfolios: 0 },
  ...fields,
});

const clientReturning = (data: RawNetWorthSummary) =>
  ({ get: async () => ({ data }) }) as unknown as AxiosInstance;

test("net worth says how many items it leaves out and which currencies have no rate", async () => {
  const { netWorth } = await getNetWorth(
    clientReturning(
      summary({
        unsupportedCurrencies: { accounts: 2, loans: 1, portfolios: 1 },
        unconvertedCurrencies: ["JPY", "THB"],
      }),
    ),
  );

  assert.deepEqual(netWorth.unconverted, {
    count: 4,
    currencies: ["JPY", "THB"],
  });
});

test("an older API without account counts or currencies leaves nothing out it cannot name", async () => {
  const { netWorth } = await getNetWorth(
    clientReturning(
      summary({ unsupportedCurrencies: { loans: 0, portfolios: 0 } }),
    ),
  );

  assert.deepEqual(netWorth.unconverted, { count: 0, currencies: [] });
});
