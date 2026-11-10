// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { PerformanceResponse } from "@/lib/api/portfolio/usePortfolioPerformance";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import PortfolioBenchmarkChart from "./PortfolioBenchmarkChart";
import PortfolioPerformanceChart from "./PortfolioPerformanceChart";

const performance = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/api/portfolio/usePortfolioPerformance", () => ({
  default: () => ({ data: performance.current, isLoading: false }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const locales = [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const;

function history(
  completeness?: PerformanceResponse["completeness"],
): PerformanceResponse {
  const dataPoints = [
    { date: "2026-03-02", value: 1000 },
    { date: "2026-03-03", value: 1400 },
  ];
  return {
    benchmarkDataPoints: dataPoints,
    benchmarkStatus: "ready",
    completeness,
    dataPoints,
    minDataPointsForComparison: 2,
    normalizedBenchmarkDataPoints: [
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-03", value: 1 },
    ],
    normalizedDataPoints: [
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-03", value: 40 },
    ],
    period: "1M",
    portfolioHistoryStatus: "ready",
  };
}

function renderIn(
  locale: string,
  messages: Record<string, unknown>,
  node: React.ReactNode,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}

const incomplete = {
  currencyCode: "EUR",
  incompleteDates: ["2026-03-02"],
  isComplete: false,
};

for (const { locale, messages } of locales) {
  test(`the portfolio history says, in ${locale}, when a day left out a portfolio it could not convert`, () => {
    performance.current = history(incomplete);

    renderIn(
      locale,
      messages,
      <PortfolioPerformanceChart portfolioId={null} period="1M" currency="EUR" />,
    );

    assert.equal(
      screen.getByRole("note").textContent,
      messages["portfolio-history-currency-incomplete"],
    );
  });
}

test("the benchmark comparison carries the same notice", () => {
  performance.current = history(incomplete);

  renderIn(
    "en",
    enMessages,
    <PortfolioBenchmarkChart portfolioId={null} period="1M" />,
  );

  assert.equal(
    screen.getByRole("note").textContent,
    enMessages["portfolio-history-currency-incomplete"],
  );
});

test("no notice when every day converted, or the API sends no completeness", () => {
  for (const completeness of [
    { currencyCode: "EUR", incompleteDates: [], isComplete: true },
    undefined,
  ]) {
    performance.current = history(completeness);
    renderIn(
      "en",
      enMessages,
      <PortfolioPerformanceChart portfolioId={null} period="1M" currency="EUR" />,
    );
    assert.equal(screen.queryByRole("note"), null);
    cleanup();
  }
});
