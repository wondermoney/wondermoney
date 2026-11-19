// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DISMISSAL_EXAMPLE, computeDismissalCompensation } from "@/lib/calculators/dismissalCompensation";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-dismissal-compensation-calculator",
}));

const { default: DismissalCompensationCalculatorComp } = await import("./DismissalCompensationCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, explains edge cases and tracks one edit with metadata only", () => {
  const outcome = computeDismissalCompensation(DISMISSAL_EXAMPLE, "2026-11-19");
  if (!outcome.ok) throw new Error("example must be valid");
  const euros = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);

  render(<DismissalCompensationCalculatorComp locale="en" />);
  expect(document.getElementById("dismissal-compensation")?.textContent).toBe(euros(outcome.result.compensationCents));
  expect(screen.getByText("Payout split over upcoming months")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const end = screen.getByLabelText("Termination date");
  fireEvent.change(end, { target: { value: "2012-01-01" } });
  expect(end.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("The termination date cannot be before the start date.")).toBeTruthy();
  expect(document.getElementById("dismissal-compensation")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(end, { target: { value: "2026-12-31" } });
  const base = screen.getByRole("spinbutton", { name: "Monthly base pay (gross)" });
  fireEvent.change(base, { target: { value: "0" } });
  expect(screen.getByText(/Enter a value of at least/)).toBeTruthy();
  fireEvent.change(base, { target: { value: "2000" } });
  expect(document.getElementById("dismissal-compensation")).not.toBeNull();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "dismissal_compensation", page_type: "tools/portugal-dismissal-compensation-calculator",
  });
});
