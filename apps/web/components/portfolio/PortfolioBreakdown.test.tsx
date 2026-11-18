// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import messages from "../../messages/en/common.json";
import PortfolioBreakdown from "./PortfolioBreakdown";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/ui/Link", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

test("lists an excluded portfolio as outside the totals instead of giving it a weight", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PortfolioBreakdown
        portfolios={[
          {
            currency: "EUR",
            excluded: false,
            gainPercent: 4,
            name: "Shares",
            portfolioKey: 1,
            value: 1000,
            weight: 100,
          },
          {
            currency: "EUR",
            excluded: true,
            gainPercent: -2,
            name: "Side pot",
            portfolioKey: 2,
            value: 720,
            weight: 0,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );

  const sidePot = screen.getByRole("row", { name: /Side pot/ });
  const shares = screen.getByRole("row", { name: /Shares/ });
  assert.ok(sidePot?.textContent?.includes("Excluded from totals"));
  assert.ok(!shares?.textContent?.includes("Excluded from totals"));
  assert.ok(
    screen
      .getByRole("link", { name: /Side pot/ })
      .textContent?.includes("Excluded from totals"),
  );
});
