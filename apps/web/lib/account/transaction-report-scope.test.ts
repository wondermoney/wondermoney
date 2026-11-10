import assert from "node:assert/strict";

import { test } from "vitest";

import {
  parseTransactionReportScope,
  reportTransactionScope,
  transactionReportScopeHref,
} from "./transaction-report-scope";

const JULY = {
  fromDate: "2026-07-01T04:00:00.000Z",
  toDate: "2026-08-01T03:59:59.999Z",
};

function searchParamsOf(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "https://app.example").searchParams);
}

test("a report with default switches counts posted spending lines and no transfers", () => {
  const scope = reportTransactionScope({ ...JULY }, "out");

  assert.deepEqual(scope, {
    ...JULY,
    statuses: ["BOOKED"],
    excludeTransfers: true,
    excludeNonSpending: true,
    direction: "out",
    accountKeys: [],
    categoryKeys: [],
    tagKeys: [],
    merchantKeys: [],
    memberCurrency: undefined,
  });
});

test("the pending and transfer switches widen the scope", () => {
  const scope = reportTransactionScope({
    ...JULY,
    includePending: true,
    includeTransfers: true,
  });

  assert.deepEqual(scope?.statuses, ["BOOKED", "PENDING"]);
  assert.equal(scope?.excludeTransfers, false);
});

test("a report without a date range has no list to link to", () => {
  assert.equal(reportTransactionScope({ fromDate: JULY.fromDate }), null);
});

test("the link carries the scope under the API's parameter names, and reads back the same", () => {
  const scope = reportTransactionScope(
    {
      ...JULY,
      accountKeys: ["4"],
      categoryKeys: ["17", "23"],
      currencyKey: "USD",
      merchantKeys: ["9"],
      tagKeys: ["2"],
    },
    "out",
  );
  assert.ok(scope);
  const href = transactionReportScopeHref(scope);

  assert.ok(href.startsWith("/accounts/transactions?"));
  assert.deepEqual(searchParamsOf(href), {
    ...JULY,
    accountKeys: "4",
    categoryKeys: "17,23",
    direction: "out",
    excludeNonSpending: "true",
    excludeTransfers: "true",
    memberCurrency: "USD",
    merchantKeys: "9",
    statuses: "BOOKED",
    tagKeys: "2",
  });
  assert.deepEqual(parseTransactionReportScope(searchParamsOf(href)), scope);
});

test("an ordinary visit to the transactions page carries no scope", () => {
  assert.equal(parseTransactionReportScope({}), null);
  assert.equal(parseTransactionReportScope({ ...JULY }), null);
  assert.equal(
    parseTransactionReportScope({ ...JULY, statuses: "EXPIRED" }),
    null,
  );
  assert.equal(
    parseTransactionReportScope({ fromDate: "soon", statuses: "BOOKED", toDate: JULY.toDate }),
    null,
  );
});

test("values the API would refuse are dropped from a hand-edited link", () => {
  const scope = parseTransactionReportScope({
    ...JULY,
    accountKeys: "4,abc,-1",
    direction: "sideways",
    memberCurrency: "dollars",
    statuses: "BOOKED,BOOKED,NONSENSE",
  });

  assert.deepEqual(scope?.accountKeys, ["4"]);
  assert.equal(scope?.direction, undefined);
  assert.equal(scope?.memberCurrency, undefined);
  assert.deepEqual(scope?.statuses, ["BOOKED"]);
});
