// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/car-loan-calculator",
}));

const { default: CarLoanCalculatorComp } = await import("./CarLoanCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("updates the monthly budget and tracks one valid edit with metadata only", () => {
  render(<CarLoanCalculatorComp locale="en" />);
  expect(screen.getByText("€494.99")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const fuel = screen.getByRole("spinbutton", { name: "Monthly fuel" });
  fireEvent.change(fuel, { target: { value: "" } });
  expect(fuel.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText("€494.99")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(fuel, { target: { value: "9".repeat(400) } });
  expect(fuel.getAttribute("aria-invalid")).toBe("true");
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(fuel, { target: { value: "125" } });
  expect(screen.getByText("€519.99")).toBeTruthy();
  const deposit = screen.getByRole("spinbutton", { name: "Deposit" });
  fireEvent.change(deposit, { target: { value: "20000" } });
  expect(screen.queryByRole("spinbutton", { name: "Nominal annual rate" })).toBeNull();
  expect(screen.getByText("€225.00")).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "car_loan", page_type: "tools/car-loan-calculator",
  });
});
