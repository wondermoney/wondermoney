// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/property-tax-calculator",
}));

const { default: PropertyTaxCalculatorComp } = await import("./PropertyTaxCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, validates the rate and tracks one edit with metadata only", () => {
  render(<PropertyTaxCalculatorComp locale="en" />);
  expect(screen.getByText("€525.00")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const rate = screen.getByRole("spinbutton", { name: "Municipal rate" });
  fireEvent.change(rate, { target: { value: "0.6" } });
  expect(rate.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText("€525.00")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(rate, { target: { value: "0.4" } });
  expect(screen.getByText("€600.00")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Property kind"), { target: { value: "rustic" } });
  expect(screen.queryByRole("spinbutton", { name: "Municipal rate" })).toBeNull();
  expect(screen.getByText("€1,200.00")).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "property_tax", page_type: "tools/property-tax-calculator",
  });
});
