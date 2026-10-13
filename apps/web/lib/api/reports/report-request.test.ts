/**
 * RAD-562 — what actually reaches the wire.
 *
 * The chart and the CSV export are the two surfaces RAD-555 set out to make
 * agree, and they only agree if both name the same calendar. These checks drive
 * the real request builders with a stubbed transport and inspect the serialised
 * query string, so "the timezone is sent" is asserted where it matters rather
 * than at the call site.
 */

import assert from "node:assert/strict";

import axios, { type AxiosInstance } from "axios";
import { test } from "vitest";

import { buildReportFilters } from "@/components/reports/filters/useReportFilters";

import { getCashflow } from "./cashflow";
import { getNetWorthHistory } from "./netWorthHistory";
import { getSankey } from "./sankey";
import { getSpendingByCategory } from "./spendingByCategory";

interface CapturedRequest {
  url: string;
  params: Record<string, unknown>;
  paramsSerializer: unknown;
}

function stubClient(): { client: AxiosInstance; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const client = {
    get: (url: string, config: Record<string, unknown>) => {
      calls.push({
        params: (config.params ?? {}) as Record<string, unknown>,
        paramsSerializer: config.paramsSerializer,
        url,
      });
      return Promise.resolve({ data: { data: [], filters: {} } });
    },
  } as unknown as AxiosInstance;

  return { calls, client };
}

/** The query string axios would actually put on the request. */
function queryStringOf(call: CapturedRequest): string {
  return axios.getUri({
    params: call.params,
    paramsSerializer: call.paramsSerializer as never,
    url: call.url,
  });
}

const PERIOD = new URLSearchParams({
  accounts: "acc-1,acc-2",
  from: "2026-07-31T22:00:00.000Z",
  to: "2026-08-31T21:59:59.999Z",
});

test("the chart request names the viewer's calendar", async () => {
  const { calls, client } = stubClient();
  await getCashflow(buildReportFilters(PERIOD, "Europe/Madrid"), client);

  assert.equal(calls[0].url, "/v1/reports/cashflow");
  assert.equal(calls[0].params.timezone, "Europe/Madrid");
  assert.match(queryStringOf(calls[0]), /timezone=Europe%2FMadrid/);
});

test("the CSV export names the same calendar as the chart", async () => {
  const { calls, client } = stubClient();
  const filters = buildReportFilters(PERIOD, "Europe/Madrid");

  await getCashflow(filters, client);
  await getCashflow({ ...filters, format: "csv" }, client);

  const [chart, csv] = calls;
  assert.equal(csv.url, "/v1/reports/cashflow.csv");
  assert.equal(csv.params.timezone, chart.params.timezone);
  // `format` is a transport concern and must not be forwarded as a filter.
  assert.equal(csv.params.format, undefined);
  assert.equal(
    queryStringOf(csv).replace(".csv", ""),
    queryStringOf(chart),
    "the two surfaces must describe the same period in the same calendar",
  );
});

test("every report endpoint carries the calendar, not just cash flow", async () => {
  const filters = buildReportFilters(PERIOD, "Europe/Madrid");

  for (const request of [
    getCashflow,
    getNetWorthHistory,
    getSankey,
    getSpendingByCategory,
  ]) {
    const { calls, client } = stubClient();
    await (request as (f: unknown, c: AxiosInstance) => Promise<unknown>)(
      filters,
      client,
    );
    assert.match(
      queryStringOf(calls[0]),
      /timezone=Europe%2FMadrid/,
      calls[0].url,
    );
  }
});

test("an unknown calendar is absent from the query string, never invalid", async () => {
  const { calls, client } = stubClient();
  await getCashflow(buildReportFilters(PERIOD, undefined), client);

  assert.equal(calls[0].params.timezone, undefined);
  assert.doesNotMatch(queryStringOf(calls[0]), /timezone/);
  // The rest of the envelope still travels, so the report is only missing its
  // calendar hint — the API then applies its documented default.
  assert.match(queryStringOf(calls[0]), /accountKeys=acc-1&accountKeys=acc-2/);
});
