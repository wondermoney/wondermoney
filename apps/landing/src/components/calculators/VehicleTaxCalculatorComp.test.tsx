// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/vehicle-tax-calculator",
}));

const { default: VehicleTaxCalculatorComp } = await import("./VehicleTaxCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, validates the engine size and tracks one edit with metadata only", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  expect(screen.getAllByText("€158.29").length).toBeGreaterThan(0);
  expect(screen.getByText("2027 (transitional): payment schedule")).toBeTruthy();
  expect(screen.getByText("€13.19")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const cc = screen.getByRole("spinbutton", { name: "Engine size" });
  fireEvent.change(cc, { target: { value: "0" } });
  expect(cc.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText("€158.29")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(cc, { target: { value: "1250" } });
  expect(screen.getAllByText("€116.48").length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Fuel"), { target: { value: "electric" } });
  expect(screen.queryByRole("spinbutton", { name: "Engine size" })).toBeNull();
  expect(screen.getAllByText("€0.00").length).toBeGreaterThan(0);
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "vehicle_tax", page_type: "tools/vehicle-tax-calculator",
  });
});
