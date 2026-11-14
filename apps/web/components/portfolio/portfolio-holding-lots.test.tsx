// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { PortfolioHoldingLots as LotsData } from "@/lib/api/portfolio/usePortfolioHoldingLots";
import usePortfolioHoldingLots from "@/lib/api/portfolio/usePortfolioHoldingLots";
import { WithPrivacyMode } from "@/lib/privacy/privacy-test-utils";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import { PortfolioHoldingLots } from "./PortfolioHoldingLots";

vi.mock("@/lib/api/portfolio/usePortfolioHoldingLots", () => ({ default: vi.fn() }));

afterEach(cleanup);

const fifo: LotsData = {
  averageUnitCost: 200,
  costBasisMethod: "FIFO",
  lots: [
    {
      date: "2026-07-17T00:00:00.000Z",
      fees: 0,
      quantity: 10,
      remainingQuantity: 0,
      status: "CLOSED",
      transactionKey: 1,
      unitCost: 100,
    },
    {
      date: "2026-07-18T00:00:00.000Z",
      fees: 5,
      quantity: 10,
      remainingQuantity: 10,
      status: "OPEN",
      transactionKey: 2,
      unitCost: 200,
    },
  ],
  openCostBasis: 2005,
  openQuantity: 10,
  realizedCostBasis: 1000,
};

const average: LotsData = {
  averageUnitCost: 150,
  costBasisMethod: "AVERAGE",
  lots: [
    {
      date: "2026-07-17T00:00:00.000Z",
      fees: 0,
      quantity: 10,
      remainingQuantity: 10,
      status: "OPEN",
      transactionKey: null,
      unitCost: 150,
    },
  ],
  openCostBasis: 1500,
  openQuantity: 10,
  realizedCostBasis: 1500,
};

function renderLots(data: LotsData, locale: "en" | "es" | "pt" = "en") {
  const messages = { en: enMessages, es: esMessages, pt: ptMessages }[locale];
  vi.mocked(usePortfolioHoldingLots).mockReturnValue({
    data,
    isError: false,
    isLoading: false,
  } as unknown as ReturnType<typeof usePortfolioHoldingLots>);

  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <WithPrivacyMode hidden={false}>
        <PortfolioHoldingLots
          currency="EUR"
          financialAssetKey={1}
          portfolioId="7"
        />
      </WithPrivacyMode>
    </NextIntlClientProvider>,
  );
}

test("lists each FIFO lot with its remaining quantity and status", () => {
  renderLots(fifo);

  assert.ok(screen.getByText("Lots"));
  assert.ok(screen.getByText("Cost basis: FIFO"));
  assert.ok(screen.getByText("Open"));
  assert.ok(screen.getByText("Closed"));
  // Two purchase rows plus the header row.
  assert.equal(screen.getAllByRole("row").length, 3);
  assert.ok(screen.getByText("2,005.00"));
});

test("shows one pooled position under average cost", () => {
  renderLots(average);

  assert.ok(screen.getByText("Cost basis: average"));
  assert.equal(screen.getAllByRole("row").length, 2);
  assert.ok(screen.getAllByText("1,500.00").length >= 1);
});

test("translates the lots section in every shipped locale", () => {
  for (const [locale, heading] of [
    ["pt", "Lotes"],
    ["es", "Lotes"],
  ] as const) {
    const { unmount } = renderLots(average, locale);
    assert.ok(screen.getByText(heading), `${locale} heading`);
    assert.ok(
      screen.getByText(locale === "pt" ? "Custo: médio" : "Coste: medio"),
      `${locale} method label`,
    );
    unmount();
  }
});
