// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EURIBOR_SOURCE, getLatestEuribor } from "@/lib/calculators/euribor";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/euribor-today-rates",
}));

const { default: EuriborCalculatorComp } = await import("./EuriborCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the data date and the tenors, explains edge cases and reports one edit with metadata only", () => {
  render(<EuriborCalculatorComp locale="en" />);
  expect(document.body.textContent).toContain("Data as of October 2026");
  expect(document.body.textContent).toContain(EURIBOR_SOURCE.fetchedOn);
  expect(getLatestEuribor().month).toBe(EURIBOR_SOURCE.lastMonth);
  expect(screen.getAllByText("Euribor 3 months").length).toBeGreaterThan(0);
  expect(screen.getByText("Monthly payment after the change")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const change = screen.getByLabelText("Change in Euribor (points)");
  fireEvent.change(change, { target: { value: "" } });
  expect(change.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("Enter a change in points, or 0 for none.")).toBeTruthy();
  expect(screen.queryByText("Monthly payment after the change")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(change, { target: { value: "0" } });
  expect(screen.getByText("With no change in Euribor the payment stays the same.")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Balance you still owe"), { target: { value: "0" } });
  expect(screen.getByText("Enter the balance you still owe.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Balance you still owe"), { target: { value: "150000" } });

  fireEvent.change(change, { target: { value: "-5" } });
  fireEvent.change(screen.getByLabelText("Your spread"), { target: { value: "0" } });
  expect(screen.getByText(/the rate is taken as 0%/)).toBeTruthy();

  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "euribor",
    page_type: "tools/euribor-today-rates",
  });
});
