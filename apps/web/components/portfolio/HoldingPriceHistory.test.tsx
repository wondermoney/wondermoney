// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { HoldingPriceHistory as History } from "@/lib/api/portfolio/useHoldingPriceOverrides";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";

import messages from "../../messages/en/common.json";

const state = vi.hoisted(() => ({
  history: {
    currency: "USD",
    prices: [
      { date: "2026-01-02", price: 12, source: "manual" },
      { date: "2026-01-03", price: 13, source: "market" },
    ],
  } as History,
  remove: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/api/portfolio/useHoldingPriceOverrides", () => ({
  useDeleteHoldingPriceOverride: () => ({ isPending: false, mutateAsync: state.remove }),
  useHoldingPriceHistory: () => ({ data: state.history, isError: false, isLoading: false }),
  useHoldingPriceOnDay: (_asset: number, date: string) => ({
    data: date === "2026-01-02"
      ? { currency: "USD", date, override: { note: "manual note", price: 12 }, price: 12, source: "manual" }
      : { currency: "USD", date, override: null, price: 13, source: date > "2026-01-02" ? "manual" : "market" },
  }),
  useSaveHoldingPriceOverride: () => ({ isPending: false, mutateAsync: state.save }),
}));
vi.mock("@/components/ui/charts", () => ({
  AreaLineChartBase: ({ data }: { data: { manual: number | null }[] }) => (
    <div data-testid="price-chart" data-points={data.length} data-manual={data.filter((row) => row.manual !== null).length} />
  ),
  useChartFormatters: () => ({ formatCompactCurrency: (value: number) => String(value) }),
}));
vi.mock("@/components/ui/dialog-responsive", () => ({
  DrawerDialog: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null),
}));

import { HoldingPriceHistory } from "./HoldingPriceHistory";

// The holding's own figures are in the viewer's EUR; the security is priced in USD.
const holding = { allocation: 1, averageBuyPrice: 10, currency: "EUR", currentPrice: 12, currentValue: 12, financialAssetKey: 7, financialAssetName: "Test asset", financialAssetSymbol: "TEST", financialAssetType: "Stock", quantity: 1, unrealizedGains: 2, unrealizedGainsPercentage: 20 } satisfies PortfolioHolding;

function mount() {
  return render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><HoldingPriceHistory holding={holding} enabled /></NextIntlClientProvider>);
}

afterEach(() => {
  cleanup();
  state.save.mockReset();
  state.remove.mockReset();
});

test("charts every price and marks only the manual days", () => {
  mount();
  const chart = screen.getByTestId("price-chart");
  assert.equal(chart.dataset["points"], "2");
  assert.equal(chart.dataset["manual"], "1");
  assert.equal(screen.getAllByRole("button", { name: "Edit" }).length, 1);
});

test("saves a dated price in the security's currency, not the viewer's", async () => {
  state.save.mockResolvedValue({});
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Set price" }));
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-02-01" } });
  fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "25.50" } });
  fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Closing price" } });
  fireEvent.click(screen.getByRole("button", { name: "Save price" }));
  await waitFor(() => assert.equal(state.save.mock.calls.length, 1));
  assert.deepEqual(state.save.mock.calls[0]?.[0], { currency: "USD", date: "2026-02-01", financialAssetKey: 7, note: "Closing price", price: 25.5 });
});

test("says when a day inherits an earlier manual price", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Set price" }));
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-01-03" } });
  assert.ok(screen.getByText(messages["holding-price-inherited-manual"]));
});

test("edits a manual price, keeping its saved note", async () => {
  state.save.mockResolvedValue({});
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  assert.equal((screen.getByLabelText("Note (optional)") as HTMLInputElement).value, "manual note");
  assert.equal((screen.getByLabelText("Price (USD)") as HTMLInputElement).value, "12");
  fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "14.75" } });
  fireEvent.click(screen.getByRole("button", { name: "Save price" }));
  await waitFor(() => assert.equal(state.save.mock.calls.length, 1));
  assert.deepEqual(state.save.mock.calls[0]?.[0], { currency: "USD", date: "2026-01-02", financialAssetKey: 7, note: "manual note", price: 14.75 });
});

test("removes a manual price only after confirming", async () => {
  state.remove.mockResolvedValue(undefined);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove manual price" }));
  assert.equal(state.remove.mock.calls.length, 0);
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await waitFor(() => assert.equal(state.remove.mock.calls.length, 1));
  assert.deepEqual(state.remove.mock.calls[0]?.[0], { date: "2026-01-02", financialAssetKey: 7 });
});

test("keeps the form open with the server error; demo read-only blocks another submission", async () => {
  state.save.mockRejectedValue({ response: { data: { code: "demo_read_only", message: "Read only" }, status: 403 } });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Set price" }));
  fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "21" } });
  fireEvent.click(screen.getByRole("button", { name: "Save price" }));
  assert.equal((await screen.findByRole("alert")).textContent, "Read only");
  assert.ok(screen.getByText(messages["holding-price-demo-readonly"]));
  assert.equal((screen.getByRole("button", { name: "Save price" }) as HTMLButtonElement).disabled, true);
});

test("offers no price form for a security without a currency", () => {
  state.history = { ...state.history, currency: null };
  try {
    mount();
    assert.equal(screen.queryByRole("button", { name: "Set price" }), null);
    assert.ok(screen.getByText(messages["holding-price-no-currency"]));
  } finally {
    state.history = { ...state.history, currency: "USD" };
  }
});
