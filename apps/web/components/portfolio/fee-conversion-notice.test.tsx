// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { DashboardSummary } from "@/lib/api/portfolio/usePortfolioDashboard";
import {
  getAggregateDashboard,
  getPortfolioDashboard,
} from "@/lib/api/portfolio/usePortfolioDashboard";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";
import { buildHoldingPositionSummary } from "@/lib/portfolio/holding-detail-summary";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import { HoldingPositionHeader } from "./HoldingPositionHeader";
import PortfolioDashboardSummary from "./PortfolioDashboardSummary";
import PortfolioHoldingsTable from "./PortfolioHoldingsTable";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/portfolio",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const locales = [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const;

const summary: DashboardSummary = {
  assetCount: 2,
  currency: "EUR",
  lastUpdated: "2026-10-20T10:00:00.000Z",
  periodLabel: "YTD",
  periodReturn: 3.2,
  portfolioCount: 1,
  realizedGains: 40,
  totalGainLoss: 90,
  totalGainLossPercent: 9,
  totalValue: 1000,
  unrealizedGains: 50,
};

const holding = {
  allocation: 100,
  averageBuyPrice: 100,
  currency: "EUR",
  currentPrice: 110,
  currentValue: 110,
  financialAssetKey: 1,
  financialAssetName: "Example ETF",
  financialAssetSymbol: "EXM",
  financialAssetType: "ETF",
  quantity: 1,
  unrealizedGains: 10,
  unrealizedGainsPercentage: 10,
} as unknown as PortfolioHolding;

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

for (const { locale, messages } of locales) {
  test(`realized gains say, in ${locale}, that unconvertible fees were left out`, () => {
    renderIn(
      locale,
      messages,
      <PortfolioDashboardSummary
        isAggregate
        summary={{ ...summary, feeConversionIncompleteAssetKeys: [7] }}
      />,
    );

    const note = screen.getByRole("note");
    assert.equal(note.textContent, messages["fee-conversion-incomplete-gains"]);
  });

  test(`a holding with an unconvertible fee says so in ${locale}`, () => {
    renderIn(
      locale,
      messages,
      <HoldingPositionHeader
        summary={buildHoldingPositionSummary({
          ...holding,
          feeConversionIncomplete: true,
        })}
      />,
    );

    assert.equal(
      screen.getByRole("note").textContent,
      messages["fee-conversion-incomplete-holding"],
    );
  });
}

test("no fee notice when every fee converted", () => {
  renderIn("en", enMessages, <PortfolioDashboardSummary summary={summary} />);
  renderIn(
    "en",
    enMessages,
    <HoldingPositionHeader summary={buildHoldingPositionSummary(holding)} />,
  );

  assert.equal(screen.queryByRole("note"), null);
});

test("the dashboard requests the fee-conversion list, which the API only sends when asked", async () => {
  const get = vi.fn(async () => ({ data: { summary } }));
  const apiClient = { get } as unknown as Parameters<
    typeof getAggregateDashboard
  >[1];

  await getAggregateDashboard("YTD", apiClient);
  await getPortfolioDashboard(3, "1M", apiClient);

  const params = get.mock.calls.map(
    (call) =>
      (call as unknown as [string, { params: Record<string, string> }])[1]
        .params,
  );
  assert.deepEqual(params, [
    { include: "feeConversion", period: "YTD" },
    { include: "feeConversion", period: "1M" },
  ]);
});

test("the holdings table marks only the holding whose fee could not be converted", () => {
  renderIn(
    "en",
    enMessages,
    <QueryClientProvider client={new QueryClient()}>
      <PortfolioHoldingsTable
        transactions={[
          { ...holding, feeConversionIncomplete: true },
          { ...holding, financialAssetKey: 2, financialAssetSymbol: "OTH" },
        ]}
      />
    </QueryClientProvider>,
  );

  const marked = screen.getAllByText(
    enMessages["fee-conversion-incomplete-holding"],
  );
  assert.equal(marked.length, 1);
  assert.ok(marked[0].closest("tr")?.textContent?.includes("EXM"));
});
