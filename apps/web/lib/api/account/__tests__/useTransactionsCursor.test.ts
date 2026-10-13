import assert from "node:assert/strict";

import type { AxiosInstance } from "axios";
import { test } from "vitest";

import {
  getTransactions,
  type GetTransactionsResponse,
} from "../useTransactions";

/**
 * Covers the request/response contract of cursor pagination, not react-query's
 * plumbing. The bug being guarded against is not "paging is subtly wrong" — it
 * is that page two was **unreachable**: the endpoint has always capped a page at
 * `limit` (default 100), the footer reported `total` from the server, and a
 * 8,623-row range rendered "100 of 8,623" with no second request ever made.
 */

function client(
  onGet: (url: string, config?: { params?: Record<string, unknown> }) => unknown,
) {
  return {
    get: async (url: string, config?: { params?: Record<string, unknown> }) => ({
      data: onGet(url, config),
    }),
  } as unknown as AxiosInstance;
}

test("omits the cursor on the first page and sends it on the next", async () => {
  const seen: (string | undefined)[] = [];
  const api = client((_url, config) => {
    seen.push(config?.params?.cursor as string | undefined);
    return { nextCursor: "1737072000000_42", transactions: [] };
  });

  await getTransactions({}, api);
  await getTransactions({ cursor: "1737072000000_42" }, api);

  assert.deepEqual(seen, [undefined, "1737072000000_42"]);
});

test("passes the cursor through untouched", async () => {
  // The cursor is the API's to define — `${epochMillis}_${transactionKey}` today.
  // Anything that parses or rebuilds it here breaks the moment that changes.
  let sent: unknown;
  const api = client((_url, config) => {
    sent = config?.params?.cursor;
    return { transactions: [] };
  });

  await getTransactions({ cursor: "1737072000000_8623" }, api);

  assert.equal(sent, "1737072000000_8623");
});

test("keeps sending the filters alongside the cursor", async () => {
  // A continuation page filtered differently from page one would silently mix
  // two result sets into one list.
  let params: Record<string, unknown> | undefined;
  const api = client((_url, config) => {
    params = config?.params;
    return { transactions: [] };
  });

  await getTransactions(
    {
      accountKeys: ["1", "2"],
      categoryKeys: ["7"],
      cursor: "1737072000000_42",
      unreviewedOnly: true,
    },
    api,
  );

  assert.equal(params?.cursor, "1737072000000_42");
  assert.equal(params?.accountKeys, "1,2");
  assert.equal(params?.categoryKeys, "7");
  assert.equal(params?.unreviewedOnly, true);
});

test("a null nextCursor is the end of the list", async () => {
  const api = client(() => ({
    nextCursor: null,
    total: 12,
    transactions: [],
  }));

  const page: GetTransactionsResponse = await getTransactions({}, api);

  // `?? undefined` is what the hook feeds react-query's getNextPageParam, and a
  // nullish page param is how it is told to stop.
  assert.equal(page.nextCursor ?? undefined, undefined);
});

test("an API too old to send nextCursor stops after one page", async () => {
  // A client can be newer than the API it talks to — a preview build against
  // staging, or a rolled-back deploy. Absent the field, paging must halt rather
  // than loop on an undefined cursor.
  const api = client(() => ({ total: 12, transactions: [] }));

  const page: GetTransactionsResponse = await getTransactions({}, api);

  assert.equal(page.nextCursor ?? undefined, undefined);
});

test("total is allowed to be null on a continuation page", async () => {
  // The API counts only on the first page; repeating an 8,623-row count for
  // every page of a scroll is pure waste. The type has to admit that, and the
  // hook has to keep showing page one's count rather than blanking the footer.
  const continuation: GetTransactionsResponse = {
    nextCursor: "1737072000000_43",
    total: null,
    transactions: [],
  };

  assert.equal(continuation.total ?? undefined, undefined);
});
