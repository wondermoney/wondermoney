// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import messages from "../../messages/en/common.json";
import PortfolioBreakdown from "./PortfolioBreakdown";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

test("lists an excluded portfolio as outside the totals instead of giving it a weight", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PortfolioBreakdown
        portfolios={[
          { currency: "EUR", excluded: false, gainPercent: 4, name: "Shares", portfolioKey: 1, value: 1000, weight: 100 },
          { currency: "EUR", excluded: true, gainPercent: -2, name: "Side pot", portfolioKey: 2, value: 720, weight: 0 },
        ]}
      />
    </NextIntlClientProvider>,
  );

  const sidePot = screen.getByText("Side pot").closest("tr");
  const shares = screen.getByText("Shares").closest("tr");
  assert.ok(sidePot?.textContent?.includes("Excluded from totals"));
  assert.ok(!shares?.textContent?.includes("Excluded from totals"));
});
