// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { PerformanceResponse } from "@/lib/api/portfolio/usePortfolioPerformance";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import { FlowMarkerLegend, FlowTooltipRow } from "./PortfolioFlowMarker";
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

function renderIn(
  node: React.ReactNode,
  locale = "en",
  messages: Record<string, unknown> = enMessages,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}

for (const { locale, messages } of locales) {
  test(`a deposit and a withdrawal are named, with their size, in ${locale}`, () => {
    const { container } = renderIn(
      <>
        <FlowTooltipRow netContribution={500} currency="EUR" />
        <FlowTooltipRow netContribution={-200} currency="EUR" />
      </>,
      locale,
      messages,
    );

    const [deposit, withdrawal] = Array.from(container.children);
    assert.ok(
      deposit.textContent?.includes(messages["portfolio-flow-deposit"]),
    );
    assert.match(deposit.textContent ?? "", /500/);
    assert.ok(
      withdrawal.textContent?.includes(messages["portfolio-flow-withdrawal"]),
    );
    // The word carries the direction; the amount is not signed twice.
    assert.match(withdrawal.textContent ?? "", /200/);
    assert.doesNotMatch(withdrawal.textContent ?? "", /[-−]/);
  });
}

test("a trade with no amount in the viewer's currency says so, with no figure", () => {
  const { container } = renderIn(
    <FlowTooltipRow netContribution={null} currency="EUR" />,
  );

  assert.equal(container.textContent, enMessages["portfolio-flow-unknown"]);
});

test("the marker legend lists only the kinds the chart shows", () => {
  renderIn(<FlowMarkerLegend kinds={["withdrawal"]} />);

  const items = screen.getAllByRole("listitem").map((li) => li.textContent);
  assert.deepEqual(items, [enMessages["portfolio-flow-withdrawal"]]);
});

function history(
  dataPoints: PerformanceResponse["dataPoints"],
): PerformanceResponse {
  return {
    dataPoints,
    minDataPointsForComparison: 2,
    period: "1M",
    portfolioHistoryStatus: "ready",
  };
}

test("the value chart explains its marks when money went in or out", () => {
  performance.current = history([
    { date: "2026-03-02", value: 1000 },
    { date: "2026-03-03", value: 1500, netContribution: 500 },
  ]);

  renderIn(
    <PortfolioPerformanceChart portfolioId={null} period="1M" currency="EUR" />,
  );

  assert.deepEqual(
    screen.getAllByRole("listitem").map((li) => li.textContent),
    [enMessages["portfolio-flow-deposit"]],
  );
});

test("no marker legend when no money went in or out", () => {
  performance.current = history([
    { date: "2026-03-02", value: 1000 },
    { date: "2026-03-03", value: 1010 },
  ]);

  renderIn(
    <PortfolioPerformanceChart portfolioId={null} period="1M" currency="EUR" />,
  );

  assert.equal(screen.queryByRole("list"), null);
});
