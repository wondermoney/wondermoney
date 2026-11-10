// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { DividendIncomeResponse } from "@/lib/api/portfolio/useDividendIncome";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import PortfolioDividendIncome from "./PortfolioDividendIncome";

const income = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/api/portfolio/useDividendIncome", () => ({
  default: () => ({ data: income.current, isLoading: false }),
}));

afterEach(cleanup);

const locales = [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const;

function renderIncome(
  response: DividendIncomeResponse,
  locale: (typeof locales)[number] = locales[0],
) {
  income.current = response;
  return render(
    <NextIntlClientProvider
      locale={locale.locale}
      messages={locale.messages}
      timeZone="UTC"
    >
      <PortfolioDividendIncome portfolioId={null} currency="USD" />
    </NextIntlClientProvider>,
  );
}

test("dividend income is shown in the currency the API converted it into", () => {
  renderIncome({
    byAsset: [{ financialAssetKey: 1, symbol: "AAPL", totalDividends: 90 }],
    completeness: {
      currencyCode: "EUR",
      isComplete: true,
      unconvertedCurrencies: [],
      unconvertedTransactions: 0,
    },
    totalDividends: 90,
  });

  assert.equal(screen.queryByRole("note"), null);
  assert.ok(screen.getAllByText(/€/).length > 0);
});

for (const locale of locales) {
  test(`dividend income names the currencies it left out (${locale.locale})`, () => {
    renderIncome(
      {
        byAsset: [{ financialAssetKey: 1, symbol: "AAPL", totalDividends: 0 }],
        completeness: {
          currencyCode: "EUR",
          isComplete: false,
          unconvertedCurrencies: ["USD"],
          unconvertedTransactions: 1,
        },
        totalDividends: 0,
      },
      locale,
    );

    assert.match(screen.getByRole("note").textContent ?? "", /USD/);
  });
}
