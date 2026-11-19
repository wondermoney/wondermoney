// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/youth-mortgage-calculator-portugal",
}));

const { default: YouthMortgageCalculatorComp } = await import("./YouthMortgageCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("keeps the checklist and the estimate apart and tracks metadata only", () => {
  render(<YouthMortgageCalculatorComp locale="en" />);
  expect(screen.getByText("3 of 5 conditions met by your answers.")).toBeTruthy();
  expect(screen.getAllByText("Not answered").length).toBeGreaterThan(0);
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole("spinbutton", { name: /Your age/ }), { target: { value: "36" } });
  expect(screen.getByText("Not met")).toBeTruthy();
  expect(screen.queryByText(/eligible for/i)).toBeNull();

  const price = screen.getByRole("spinbutton", { name: /Purchase price/ });
  fireEvent.change(price, { target: { value: "0" } });
  expect(screen.getByText("Enter a price above zero.")).toBeTruthy();

  fireEvent.change(price, { target: { value: "200000" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /Deposit/ }), { target: { value: "300000" } });
  expect(screen.getByText("The deposit cannot be more than the price.")).toBeTruthy();

  fireEvent.change(screen.getByRole("spinbutton", { name: /Deposit/ }), { target: { value: "20000" } });
  expect(screen.getByText("90.0%")).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "youth_mortgage", page_type: "tools/youth-mortgage-calculator-portugal",
  });
});
