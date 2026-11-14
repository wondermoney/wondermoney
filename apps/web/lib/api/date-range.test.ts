import assert from "node:assert/strict";

import type { AxiosInstance } from "axios";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

import { getAccountsCashflow } from "./account/useAccountsCashflow";
import { getAccountsMetrics } from "./account/useAccountsMetrics";
import { getAccountTransactions } from "./account/useAccountTransactions";
import { getTransactions } from "./account/useTransactions";
import { getTransactionsCategorySpending } from "./account/useTransactionsCategorySpending";
import { dateRangeParams, transactionDateRangeParams } from "./date-range";
import { getPortfoliosTransactions } from "./portfolio/usePortfoliosTransactions";
import { getPortfolioTransactions } from "./portfolio/usePortfolioTransactions";

/** How the API reads a date query value: epoch milliseconds, or any string `Date` parses. */
function readAsApi(value: unknown): Date {
  const text = String(value).trim();
  return /^-?\d+$/.test(text) ? new Date(Number(text)) : new Date(text);
}

/** Runs each test in `zone`; Node re-reads `process.env.TZ` whenever it changes. */
function inTimeZone(zone: string) {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}

describe("west of UTC (America/New_York)", () => {
  inTimeZone("America/New_York");

  test("a range covers the first and last day whole, on the viewer's calendar", () => {
    // Afternoons, so the time of day passed in must be dropped. 8 March 2026 is the day the
    // clocks go forward, a 23-hour day.
    const params = dateRangeParams({
      fromDate: new Date(2026, 2, 8, 15, 30),
      toDate: new Date(2026, 2, 31, 9, 0),
    });

    assert.deepEqual(params, {
      fromDate: "2026-03-08T05:00:00.000Z",
      toDate: "2026-04-01T03:59:59.999Z",
    });
  });

  test("a range ending today includes a transaction entered late tonight", () => {
    const now = new Date();
    const lateTonight = new Date(now);
    lateTonight.setHours(23, 30, 0, 0);

    const { toDate } = dateRangeParams({ toDate: now });

    assert.ok(readAsApi(toDate) >= lateTonight);
  });
});

describe("east of UTC (Asia/Tokyo)", () => {
  inTimeZone("Asia/Tokyo");

  test("the first day starts at the viewer's midnight, not UTC midnight", () => {
    const params = dateRangeParams({
      fromDate: new Date(2026, 5, 1, 8, 0),
      toDate: new Date(2026, 5, 30, 8, 0),
    });

    assert.deepEqual(params, {
      fromDate: "2026-05-31T15:00:00.000Z",
      toDate: "2026-06-30T14:59:59.999Z",
    });
  });
});

test("an open end is left out, so the API applies its default", () => {
  assert.deepEqual(dateRangeParams({}), {});
  assert.deepEqual(Object.keys(dateRangeParams({ fromDate: new Date() })), [
    "fromDate",
  ]);
});

/** Every request function that sends an instant range, with the params it handed to axios. */
const requests: Record<
  string,
  (range: { fromDate: Date; toDate: Date }, client: AxiosInstance) => Promise<unknown>
> = {
  "accounts money in and out": (range, client) => getAccountsMetrics(range, client),
  "account transactions": (range, client) =>
    getAccountTransactions({ ...range, accountId: 1 }, client),
  "category spending": (range, client) =>
    getTransactionsCategorySpending(range, client),
  "portfolio transactions": (range, client) =>
    getPortfolioTransactions({ ...range, portfolioId: "1" }, client),
  "portfolios transactions": (range, client) =>
    getPortfoliosTransactions(range, client),
  "transactions list": (range, client) => getTransactions(range, client),
};

describe("every data hook sends the range through dateRangeParams", () => {
  inTimeZone("America/Sao_Paulo");

  for (const [name, request] of Object.entries(requests)) {
    test(name, async () => {
      let sent: Record<string, unknown> = {};
      const client = {
        get: async (_url: string, config: { params: Record<string, unknown> }) => {
          sent = config.params;
          return { data: {} };
        },
      } as unknown as AxiosInstance;
      const range = {
        fromDate: new Date(2026, 0, 1, 12, 0),
        toDate: new Date(2026, 0, 31, 12, 0),
      };

      await request(range, client);

      assert.equal(sent.fromDate, "2026-01-01T03:00:00.000Z");
      assert.equal(sent.toDate, "2026-02-01T02:59:59.999Z");
    });
  }

  test("accounts cash flow sends the start, and the end when one bounds it", async () => {
    let sent: Record<string, unknown> = {};
    const client = {
      get: async (_url: string, config: { params: Record<string, unknown> }) => {
        sent = config.params;
        return { data: {} };
      },
    } as unknown as AxiosInstance;

    await getAccountsCashflow({ fromDate: new Date(2026, 0, 1, 12, 0) }, client);
    assert.deepEqual(sent, { fromDate: "2026-01-01T03:00:00.000Z" });

    await getAccountsCashflow(
      {
        fromDate: new Date(2026, 0, 1, 12, 0),
        toDate: new Date(2026, 0, 5, 12, 0),
      },
      client,
    );
    assert.deepEqual(sent, {
      fromDate: "2026-01-01T03:00:00.000Z",
      toDate: "2026-01-06T02:59:59.999Z",
    });
  });
});

describe("transactionDateRangeParams", () => {
  inTimeZone("America/New_York");

  test("sends the viewer's time zone with the range, so the API can match a bank booking by its date", () => {
    const params = transactionDateRangeParams(
      { fromDate: new Date(2026, 5, 10), toDate: new Date(2026, 5, 12) },
      "America/New_York",
    );

    assert.deepEqual(params, {
      fromDate: "2026-06-10T04:00:00.000Z",
      timezone: "America/New_York",
      toDate: "2026-06-13T03:59:59.999Z",
    });
  });

  test("sends no time zone without a range, or when the viewer's is unknown", () => {
    assert.deepEqual(transactionDateRangeParams({}, "America/New_York"), {});
    assert.deepEqual(
      transactionDateRangeParams({ fromDate: new Date(2026, 5, 10) }, undefined),
      { fromDate: "2026-06-10T04:00:00.000Z" },
    );
  });
});

/** The transaction endpoints, which match a bank booking by the viewer's calendar day. */
const transactionRequests: Record<
  string,
  (range: { fromDate: Date; toDate: Date }, client: AxiosInstance) => Promise<unknown>
> = {
  "accounts cash flow": (range, client) =>
    getAccountsCashflow({ fromDate: range.fromDate }, client),
  "accounts money in and out": (range, client) => getAccountsMetrics(range, client),
  "account transactions": (range, client) =>
    getAccountTransactions({ ...range, accountId: 1 }, client),
  "category spending": (range, client) =>
    getTransactionsCategorySpending(range, client),
  "transactions list": (range, client) => getTransactions(range, client),
};

describe("in the browser, every transaction hook sends the viewer's time zone", () => {
  inTimeZone("America/Sao_Paulo");
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const range = {
    fromDate: new Date(2026, 0, 1, 12, 0),
    toDate: new Date(2026, 0, 31, 12, 0),
  };
  const capture = () => {
    const sent: { params: Record<string, unknown> } = { params: {} };
    const client = {
      get: async (_url: string, config: { params: Record<string, unknown> }) => {
        sent.params = config.params;
        return { data: {} };
      },
    } as unknown as AxiosInstance;
    return { client, sent };
  };

  for (const [name, request] of Object.entries(transactionRequests)) {
    test(name, async () => {
      const { client, sent } = capture();

      await request(range, client);

      assert.equal(sent.params.timezone, "America/Sao_Paulo");
    });
  }

  test("portfolio transactions do not, as their dates have no bank bookings", async () => {
    const { client, sent } = capture();

    await getPortfoliosTransactions(range, client);

    assert.equal(sent.params.timezone, undefined);
  });
});
