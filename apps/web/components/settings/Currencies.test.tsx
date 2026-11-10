// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { ExchangeRateOverride } from "@/lib/api/currency/useExchangeRateOverrides";

import enCommon from "../../messages/en/common.json";
import enCurrencies from "../../messages/en/currencies.json";
import Currencies, { latestAllowedDay, parseRate } from "./Currencies";

const state = vi.hoisted(() => ({
  overrides: [] as ExchangeRateOverride[],
  currency: "EUR",
  params: new URLSearchParams(),
  create: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));

vi.mock("@/lib/api/account/useCurrencies", () => ({
  default: () => ({
    data: {
      currencies: [
        { currencyKey: 1, code: "EUR", description: "Euro" },
        { currencyKey: 2, code: "USD", description: "US Dollar" },
        { currencyKey: 3, code: "XOF", description: "CFA Franc" },
      ],
    },
    isError: false,
  }),
}));

vi.mock("@/lib/api/currency/useExchangeRateOverrides", () => ({
  exchangeRateOverridesKey: ["exchange-rate-overrides"],
  default: () => ({
    data: { currency: state.currency, overrides: state.overrides },
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
  getExchangeRateOverrides: vi.fn(),
  invalidateExchangeRateOverrides: state.invalidate,
  useCreateExchangeRateOverride: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
  useEditExchangeRateOverride: () => ({
    mutateAsync: state.edit,
    isPending: false,
  }),
  useDeleteExchangeRateOverride: () => ({
    mutateAsync: state.remove,
    isPending: false,
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  state.params = new URLSearchParams();
  for (const mock of [state.create, state.edit, state.remove, state.invalidate])
    mock.mockReset();
});

const m = enCurrencies.exchangeRates;

function renderCurrencies(overrides: ExchangeRateOverride[]) {
  state.overrides = overrides;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enCurrencies }}
      >
        <Currencies />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const francs: ExchangeRateOverride = {
  id: 7,
  fromCurrency: "XOF",
  toCurrency: "EUR",
  date: "2026-03-02",
  rate: 0.00152,
  updatedAt: "2026-03-02T10:00:00.000Z",
};

test("reads a rate typed with a decimal point or a decimal comma, and nothing else", () => {
  assert.equal(parseRate("0.0015"), 0.0015);
  assert.equal(parseRate(" 0,0015 "), 0.0015);
  assert.equal(parseRate("12"), 12);
  for (const typed of ["", "0", "-1", "1.000,5", "abc", "1e3"]) {
    assert.equal(parseRate(typed), null, typed);
  }
});

test("allows up to tomorrow in UTC, so a member ahead of UTC can set today's rate", () => {
  assert.equal(
    latestAllowedDay(new Date("2026-03-31T23:30:00Z")),
    "2026-04-01",
  );
});

test("shows each rate as one unit of the source currency in the target", () => {
  renderCurrencies([francs]);

  screen.getByText("1 XOF = 0.00152 EUR");
  screen.getByText("Mar 2, 2026");
});

test("adds a rate prefilled from a warning's link, reading a decimal comma", async () => {
  state.params = new URLSearchParams(
    "tab=currencies&from=xof&to=EUR&date=2026-03-02",
  );
  state.create.mockResolvedValue(francs);
  const user = userEvent.setup();
  renderCurrencies([]);

  screen.getByText(m.empty);
  await user.type(screen.getByLabelText(m.rate), "0,00152");
  await user.click(screen.getByRole("button", { name: m.add }));

  await waitFor(() =>
    assert.deepEqual(state.create.mock.calls[0][0], {
      fromCurrency: "XOF",
      toCurrency: "EUR",
      date: "2026-03-02",
      rate: 0.00152,
    }),
  );
  assert.equal(state.invalidate.mock.calls.length, 1);
});

test("converts into the member's own currency when the link names only the source", async () => {
  state.params = new URLSearchParams("tab=currencies&from=JPY&date=2026-03-02");
  state.create.mockResolvedValue(francs);
  const user = userEvent.setup();
  renderCurrencies([]);

  await user.type(screen.getByLabelText(m.rate), "0.0061");
  await user.click(screen.getByRole("button", { name: m.add }));

  await waitFor(() =>
    assert.deepEqual(state.create.mock.calls[0][0], {
      fromCurrency: "JPY",
      toCurrency: "EUR",
      date: "2026-03-02",
      rate: 0.0061,
    }),
  );
});

test("refuses one currency twice and a rate of zero before asking the API", async () => {
  state.params = new URLSearchParams("from=EUR&to=EUR&date=2026-03-02");
  const user = userEvent.setup();
  renderCurrencies([]);

  await user.type(screen.getByLabelText(m.rate), "1");
  await user.click(screen.getByRole("button", { name: m.add }));
  screen.getByText(m.errors["same-currency"]);

  cleanup();
  state.params = new URLSearchParams("from=XOF&to=EUR&date=2026-03-02");
  renderCurrencies([]);
  await user.type(screen.getByLabelText(m.rate), "0");
  await user.click(screen.getByRole("button", { name: m.add }));
  screen.getByText(m.errors["rate-invalid"]);

  assert.equal(state.create.mock.calls.length, 0);
});

test("says so when the household already has a rate for that pair and day", async () => {
  state.params = new URLSearchParams("from=XOF&to=EUR&date=2026-03-02");
  state.create.mockRejectedValue({
    response: { status: 409, data: { code: "exchange_rate_override_exists" } },
  });
  const user = userEvent.setup();
  renderCurrencies([francs]);

  await user.type(screen.getByLabelText(m.rate), "0.002");
  await user.click(screen.getByRole("button", { name: m.add }));

  await screen.findByText(m.errors.exists);
});

test("changes a rate, sending only what changed", async () => {
  state.edit.mockResolvedValue({ ...francs, rate: 0.0016 });
  const user = userEvent.setup();
  renderCurrencies([francs]);

  await user.click(
    screen.getByRole("button", {
      name: "Edit the XOF/EUR rate for Mar 2, 2026",
    }),
  );
  const rate = screen.getByLabelText(m.rate, {
    selector: "#edit-rate-value-7",
  });
  await user.clear(rate);
  await user.type(rate, "0.0016");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    assert.deepEqual(state.edit.mock.calls[0][0], { id: 7, rate: 0.0016 }),
  );
});

test("deletes a rate only after confirming", async () => {
  state.remove.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderCurrencies([francs]);

  await user.click(
    screen.getByRole("button", {
      name: "Delete the XOF/EUR rate for Mar 2, 2026",
    }),
  );
  screen.getByText(m["delete-description"]);
  assert.equal(state.remove.mock.calls.length, 0);
  await user.click(screen.getByRole("button", { name: m.delete }));

  await waitFor(() => assert.deepEqual(state.remove.mock.calls[0], [7]));
});
