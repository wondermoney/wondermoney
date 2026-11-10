import assert from "node:assert/strict";

import type { AxiosInstance } from "axios";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { test } from "vitest";

import { getAccountsMetrics } from "../useAccountsMetrics";

/** How the API reads a date query value: epoch milliseconds, or any string `Date` parses. */
function readAsApi(value: unknown): Date {
  const text = String(value).trim();
  return /^-?\d+$/.test(text) ? new Date(Number(text)) : new Date(text);
}

async function sentRange(range: { fromDate?: Date; toDate?: Date }) {
  let params: Record<string, unknown> = {};
  const apiClient = {
    get: async (_url: string, config: { params: Record<string, unknown> }) => {
      params = config.params;
      return { data: { metrics: [] } };
    },
  } as unknown as AxiosInstance;

  await getAccountsMetrics(range, apiClient);
  return params;
}

test("asks for money in and out over the exact range the transactions list shows", async () => {
  const now = new Date();
  const range = { fromDate: startOfDay(subDays(now, 60)), toDate: endOfDay(now) };
  // An expense entered this afternoon is in the list's range; it must be in the totals too.
  const enteredToday = new Date(now);
  enteredToday.setHours(17, 15, 0, 0);

  const params = await sentRange(range);

  assert.equal(readAsApi(params.fromDate).getTime(), range.fromDate.getTime());
  assert.equal(readAsApi(params.toDate).getTime(), range.toDate.getTime());
  assert.ok(readAsApi(params.toDate) >= enteredToday);
});

test("leaves an open end of the range to the API", async () => {
  const params = await sentRange({});

  assert.deepEqual(params, {});
});
