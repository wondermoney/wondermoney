// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  GOLD_PRICE_SOURCE,
  computeGoldValue,
  goldValueExample,
  latestGoldPrice,
} from "@/lib/calculators/goldValue";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/gold-price-per-gram",
}));

const { default: GoldPriceComp } = await import("./GoldPriceComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
  vi.useRealTimers();
});

const eur = (value: number, decimals = 2) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "EUR", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

it("shows the dated price, the worked example, the buyers' note and metadata-only events", () => {
  const outcome = computeGoldValue(goldValueExample());
  if (!outcome.ok) throw new Error("example must be valid");
  const latest = latestGoldPrice();

  render(<GoldPriceComp locale="en" />);
  expect(screen.getByText(`Price of ${GOLD_PRICE_SOURCE.asOf}: Narodowy Bank Polski's price of pure gold, in euro at the ECB rate of the same day.`)).toBeTruthy();
  expect(screen.getAllByText(eur(latest.eurPerGram)).length).toBeGreaterThan(0);
  expect(screen.getAllByText(eur(outcome.result.value)).length).toBeGreaterThan(0);
  expect(screen.getByText(/Gold buyers pay less than this/)).toBeTruthy();
  expect(screen.getByText(/this page does not predict where gold goes next/)).toBeTruthy();
  const cta = screen.getByRole("link", { name: "Include physical assets in your net worth" });
  expect(cta.getAttribute("href")).toMatch(/^\/en\//);
  expect(pushGtmEvent).not.toHaveBeenCalled();

  // Purity drives the value.
  fireEvent.change(screen.getByLabelText("Purity"), { target: { value: "k24" } });
  const pure = computeGoldValue({ ...goldValueExample(), purity: "k24" });
  if (!pure.ok) throw new Error("expected a value");
  expect(screen.getAllByText(eur(pure.result.value)).length).toBeGreaterThan(0);
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
  expect(pushGtmEvent).toHaveBeenCalledWith({ event: "tool_used", tool: "gold_price", page_type: "tools/gold-price-per-gram" });

  // An offer is compared with the metal value.
  fireEvent.change(screen.getByLabelText("Offer from a buyer (optional)"), { target: { value: "500" } });
  expect(screen.getByText(/The offer is \d+% of the metal value, .* below it\./)).toBeTruthy();

  fireEvent.click(cta);
  expect(pushGtmEvent).toHaveBeenLastCalledWith({ event: "cta_click", cta_position: "tool_result", page_type: "tools/gold-price-per-gram" });
});

it("handles zero, empty and very large weights, and a changed price", () => {
  render(<GoldPriceComp locale="en" />);
  const grams = screen.getByLabelText("Weight") as HTMLInputElement;

  fireEvent.change(grams, { target: { value: "0" } });
  expect(screen.getByText("With no weight there is no gold to value.")).toBeTruthy();

  fireEvent.change(grams, { target: { value: "" } });
  expect(screen.getByText("Enter a valid number.")).toBeTruthy();
  expect(screen.getByText("Check the highlighted fields to see the value.")).toBeTruthy();

  fireEvent.change(grams, { target: { value: "100001" } });
  expect(screen.getByText("Enter 100,000 g or less.")).toBeTruthy();

  fireEvent.change(grams, { target: { value: "100000" } });
  expect(screen.queryByText(/Check the highlighted fields/)).toBeNull();

  const price = screen.getByLabelText("Price of pure gold per gram") as HTMLInputElement;
  fireEvent.change(price, { target: { value: "100" } });
  const reset = screen.getByRole("button", { name: /Use the latest price/ });
  fireEvent.click(reset);
  expect(Number(price.value)).toBe(latestGoldPrice().eurPerGram);
  expect(screen.queryByRole("button", { name: /Use the latest price/ })).toBeNull();
});

it("warns on the visitor's clock when the price is more than five days old", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(`${GOLD_PRICE_SOURCE.asOf}T12:00:00Z`) + 9 * 86_400_000);
  render(<GoldPriceComp locale="en" />);
  expect(await screen.findByText(/This price is 9 days old/)).toBeTruthy();
});
