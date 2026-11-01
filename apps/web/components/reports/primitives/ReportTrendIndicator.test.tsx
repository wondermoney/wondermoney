// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import enReports from "../../../messages/en/reports.json";
import { ReportTrendIndicator } from "./ReportTrendIndicator";

afterEach(cleanup);

const renderTrend = (props: Parameters<typeof ReportTrendIndicator>[0]) =>
  render(
    <NextIntlClientProvider locale="en" messages={enReports}>
      <ReportTrendIndicator {...props} />
    </NextIntlClientProvider>,
  ).container;

test("spending that rose reads as a rise, coloured as bad news", () => {
  const container = renderTrend({
    value: 120,
    percentage: 40,
    direction: "positive-is-down",
  });

  assert.match(container.textContent ?? "", /Up\s*\+40%/);
  assert.ok(container.querySelector(".text-destructive-text"));
});

test("spending that fell reads as a fall with a true minus, coloured as good news", () => {
  const container = renderTrend({
    value: -120,
    percentage: 40,
    direction: "positive-is-down",
  });

  assert.match(container.textContent ?? "", /Down\s*−40%/);
  assert.ok(container.querySelector(".text-success-text"));
});

test("a fall in a figure where up is good is a fall, coloured as bad news", () => {
  const container = renderTrend({ value: -5, percentage: 5 });

  assert.match(container.textContent ?? "", /Down\s*−5%/);
  assert.ok(container.querySelector(".text-destructive-text"));
});
