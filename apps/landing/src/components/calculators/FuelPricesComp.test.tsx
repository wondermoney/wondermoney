// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FUEL_PRICES_SOURCE, computeFuelCost, fuelCostExample, latestFuelPrice } from "@/lib/calculators/fuelCost";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/fuel-prices-portugal",
}));

const { default: FuelPricesComp } = await import("./FuelPricesComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

const eur = (value: number, decimals = 2) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "EUR", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

it("shows the dated latest prices, the worked example, edge cases and metadata-only events", () => {
  const outcome = computeFuelCost(fuelCostExample());
  if (!outcome.ok) throw new Error("example must be valid");

  render(<FuelPricesComp locale="en" />);
  expect(screen.getByText(new RegExp(`Data as of ${FUEL_PRICES_SOURCE.asOf} \\(DGEG\\)`))).toBeTruthy();
  expect(screen.getAllByText(`${eur(latestFuelPrice("diesel"), 3)}/L`).length).toBeGreaterThan(0);
  expect(screen.getByText(/this page does not predict next week's price/)).toBeTruthy();
  expect(screen.getAllByText(eur(outcome.result.monthly)).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "Review the transport allowance in your budget" }).getAttribute("href")).toMatch(/^\/en\//);
  expect(pushGtmEvent).not.toHaveBeenCalled();

  // The price follows the fuel until the visitor types one.
  const price = screen.getByLabelText("Price per litre") as HTMLInputElement;
  expect(Number(price.value)).toBe(latestFuelPrice("diesel"));
  fireEvent.change(screen.getByLabelText("Fuel"), { target: { value: "lpg" } });
  expect(Number(price.value)).toBe(latestFuelPrice("lpg"));
  expect(screen.queryByRole("button", { name: /Use the latest average/ })).toBeNull();

  fireEvent.change(price, { target: { value: "1.5" } });
  fireEvent.change(screen.getByLabelText("Fuel"), { target: { value: "gasoline95" } });
  expect(Number(price.value)).toBe(1.5);
  fireEvent.click(screen.getByRole("button", { name: /Use the latest average/ }));
  expect(Number(price.value)).toBe(latestFuelPrice("gasoline95"));

  // Zero distance: a clear note, not an error.
  fireEvent.change(screen.getByLabelText("Distance"), { target: { value: "0" } });
  expect(screen.getByText("With no distance driven there is no fuel cost.")).toBeTruthy();

  // Too large, and empty consumption: a message and no stale result.
  fireEvent.change(screen.getByLabelText("Distance"), { target: { value: "999999" } });
  expect(screen.getByText(/Enter 100,000 km or less/)).toBeTruthy();
  expect(screen.getByText("Check the highlighted fields to see the estimate.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Distance"), { target: { value: "800" } });
  fireEvent.change(screen.getByLabelText("Fuel consumption"), { target: { value: "" } });
  expect(screen.getByText("Enter a valid number.")).toBeTruthy();
  expect(screen.getByLabelText("Fuel consumption").getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(screen.getByLabelText("Fuel consumption"), { target: { value: "0" } });
  expect(screen.getByText("Enter a value above zero.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Fuel consumption"), { target: { value: "6" } });

  // A trip asks for trips a month; a fraction of a trip is refused.
  fireEvent.change(screen.getByLabelText("The distance you enter is"), { target: { value: "trip" } });
  fireEvent.change(screen.getByLabelText("Trips per month"), { target: { value: "2.5" } });
  expect(screen.getByText("Enter a whole number of trips.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Trips per month"), { target: { value: "10" } });
  expect(screen.getByText("Cost of one trip")).toBeTruthy();

  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "fuel_prices",
    page_type: "tools/fuel-prices-portugal",
  });

  // The next step carries no inputs or results.
  pushGtmEvent.mockClear();
  const cta = screen.getByRole("link", { name: "Review the transport allowance in your budget" });
  cta.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(cta);
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "cta_click",
    cta_position: "tool_result",
    page_type: "tools/fuel-prices-portugal",
  });
});
