// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";
import { AMOUNT_MASK } from "@/lib/privacy/mask";
import {
  setStoredPrivacyMode,
  WithPrivacyMode,
} from "@/lib/privacy/privacy-test-utils";

import messages from "../../messages/en/common.json";
import PortfolioHoldingsTable from "./PortfolioHoldingsTable";

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/portfolio",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./PortfolioHoldingDetailsModal", () => ({ default: () => null }));

const holding: PortfolioHolding = {
  allocation: 100,
  averageBuyPrice: 41.2,
  currency: "EUR",
  currentPrice: 48.9,
  currentValue: 1833.75,
  financialAssetKey: 1,
  financialAssetName: "Example Equity Fund",
  financialAssetSymbol: "EXMPL",
  financialAssetType: "ETF",
  quantity: 37.5,
  unrealizedGains: 288.75,
  unrealizedGainsPercentage: 18.69,
};

function renderTable(hidden: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WithPrivacyMode hidden={hidden}>
        <PortfolioHoldingsTable transactions={[holding]} />
      </WithPrivacyMode>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  setStoredPrivacyMode(false);
});

test("the holdings table shows how many units are held", () => {
  const { container } = renderTable(false);
  assert.match(container.textContent ?? "", /37\.5/);
});

test("privacy mode masks the quantity, since quantity × price is the value", () => {
  setStoredPrivacyMode(true);
  const { container } = renderTable(true);

  const text = container.textContent ?? "";
  assert.doesNotMatch(text, /37[.,]5/);
  assert.doesNotMatch(text, /1,?833/);
  assert.ok(text.includes(AMOUNT_MASK));
  // The asset itself stays identifiable.
  assert.match(text, /EXMPL/);
});
