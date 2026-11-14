// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import messages from "../../messages/en/common.json";
import PortfolioTransactionAddModal from "./PortfolioTransactionAddModal";

const mutateAsync = vi.fn(async (_payload: unknown) => ({}));

vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({
    isLoading: false,
    data: {
      financialTransactionTypes: [
        { financialTransactionTypeKey: 1, name: "BUY" },
        { financialTransactionTypeKey: 2, name: "SELL" },
        { financialTransactionTypeKey: 3, name: "DIVIDEND" },
      ],
      brokers: [
        { financialBrokerKey: 7, name: "degiro", displayName: "DEGIRO" },
      ],
      currencies: [{ currencyKey: 151, code: "EUR", description: "Euro" }],
    },
  }),
}));
vi.mock("@/lib/api/portfolio/usePortfolios", () => ({
  default: () => ({
    isLoading: false,
    data: { portfolios: [{ portfolioKey: 5, name: "Main" }] },
  }),
}));
vi.mock("@/lib/api/portfolio/useCreatePortfolioTransaction", () => ({
  default: () => ({ mutateAsync }),
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("../ui/TickerAutoComplete", () => ({
  default: ({
    onTickerSelected,
  }: {
    onTickerSelected: (value: string) => void;
  }) => (
    <button type="button" onClick={() => onTickerSelected("ABC.US")}>
      Select ABC
    </button>
  ),
}));

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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mutateAsync.mockClear();
});

function renderModal() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <PortfolioTransactionAddModal isOpen setOpen={() => {}} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Radix Select comboboxes in the dialog, found by the placeholder they show. */
function selectTrigger(placeholder: string) {
  const trigger = screen
    .getAllByRole("combobox")
    .find((element) => element.textContent?.includes(placeholder));
  assert.ok(trigger, `no select showing "${placeholder}"`);
  return trigger;
}

test("picking a transaction type and a broker shows them without a controlled-state warning", async () => {
  const user = userEvent.setup();
  const warn = vi.spyOn(console, "warn");
  const error = vi.spyOn(console, "error");
  renderModal();

  await user.click(selectTrigger(messages["transaction-type-placeholder"]));
  await user.click(
    await screen.findByRole("option", {
      name: messages["financial-transaction-type-SELL"],
    }),
  );
  await user.click(selectTrigger(messages["broker-placeholder"]));
  await user.click(await screen.findByRole("option", { name: "DEGIRO" }));

  assert.ok(
    screen
      .getAllByRole("combobox")
      .some(
        (c) => c.textContent === messages["financial-transaction-type-SELL"],
      ),
  );
  assert.ok(
    screen
      .getAllByRole("combobox")
      .some((c) => c.textContent?.includes("DEGIRO")),
  );
  const switched = [...warn.mock.calls, ...error.mock.calls].filter((args) =>
    String(args[0]).match(/controlled/i),
  );
  assert.deepEqual(switched, []);
});

test("saving without a transaction type is refused with a field error", async () => {
  const user = userEvent.setup();
  renderModal();

  await user.click(
    screen.getByRole("button", { name: messages["add-transaction"] }),
  );

  await waitFor(() => assert.ok(screen.getByText(messages["invalid-type"])));
  assert.equal(mutateAsync.mock.calls.length, 0);
});

test("records a dividend using the share count and dividend per share", async () => {
  const user = userEvent.setup();
  renderModal();
  await user.click(selectTrigger(messages["transaction-type-placeholder"]));
  await user.click(
    await screen.findByRole("option", {
      name: messages["financial-transaction-type-DIVIDEND"],
    }),
  );
  await user.click(screen.getByRole("button", { name: "Select ABC" }));
  await user.type(screen.getByLabelText(/Quantity/), "10");
  await user.type(screen.getByLabelText(/Dividend per share/), "0.25");
  await user.click(
    screen.getByRole("button", { name: messages["add-transaction"] }),
  );
  await waitFor(() =>
    assert.equal(
      mutateAsync.mock.calls.length,
      1,
      document.body.textContent ?? "",
    ),
  );
  const payload = mutateAsync.mock.calls[0]?.[0] as unknown as Record<
    string,
    unknown
  >;
  assert.equal(payload.financialTransactionTypeId, "3");
  assert.equal(payload.quantity, 10);
  assert.equal(payload.unitPrice, 0.25);
});
