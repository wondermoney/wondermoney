// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import messages from "../../messages/en/common.json";
import PortfolioTransactionEditModal from "./PortfolioTransactionEditModal";

vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({
    isLoading: false,
    data: {
      financialTransactionTypes: [
        { financialTransactionTypeKey: 1, name: "BUY" },
        { financialTransactionTypeKey: 2, name: "SELL" },
        { financialTransactionTypeKey: 3, name: "DIVIDEND" },
        { financialTransactionTypeKey: 4, name: "DEPOSIT" },
        { financialTransactionTypeKey: 5, name: "WITHDRAWAL" },
        { financialTransactionTypeKey: 6, name: "OFFER" },
      ],
      brokers: [],
      currencies: [{ currencyKey: 151, code: "EUR", description: "Euro" }],
    },
  }),
}));
vi.mock("@/lib/api/portfolio/useUpdatePortfolioTransaction", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));
vi.mock("next/image", () => ({ default: () => null }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const typeLabel = (name: string) =>
  String(
    messages[`financial-transaction-type-${name}` as keyof typeof messages],
  );

/** Opens the row's type select and returns the names of the types it offers. */
async function offeredTypes(financialTransactionTypeId: number) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <PortfolioTransactionEditModal
          isOpen
          closeModal={() => {}}
          data={{
            portfolioId: 5,
            transactionId: 41,
            ticker: "AAPL",
            quantity: "2",
            unitPrice: "100",
            transactionDate: "2026-07-17T00:00:00.000Z",
            financialTransactionTypeId,
            settlementCurrencyId: 151,
          }}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

  const current = ["BUY", "SELL", "DIVIDEND"][financialTransactionTypeId - 1]!;
  const trigger = screen
    .getAllByRole("combobox")
    .find((element) => element.textContent === typeLabel(current));
  assert.ok(trigger, `no type select showing ${current}`);
  await user.click(trigger);

  const options = (await screen.findAllByRole("option")).map(
    (option) => option.textContent,
  );
  return ["BUY", "SELL", "DIVIDEND", "DEPOSIT", "WITHDRAWAL", "OFFER"].filter(
    (name) => options.includes(typeLabel(name)),
  );
}

test("a buy can be switched to a sell, and to nothing else", async () => {
  assert.deepEqual(await offeredTypes(1), ["BUY", "SELL"]);
});

test("a sell can be switched to a buy, and to nothing else", async () => {
  assert.deepEqual(await offeredTypes(2), ["BUY", "SELL"]);
});

test("a dividend offers no trade types", async () => {
  assert.deepEqual(await offeredTypes(3), ["DIVIDEND"]);
});
