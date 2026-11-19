// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SICK_PAY_EXAMPLE, computeSickPay } from "@/lib/calculators/sickPay";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-sick-pay-calculator",
}));

const { default: SickPayCalculatorComp } = await import("./SickPayCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, explains edge cases and tracks one edit with metadata only", () => {
  const outcome = computeSickPay(SICK_PAY_EXAMPLE);
  if (!outcome.ok) throw new Error("example must be valid");
  const euros = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);

  render(<SickPayCalculatorComp locale="en" />);
  expect(document.getElementById("sick-total")?.textContent).toBe(euros(outcome.result.totalCents));
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const days = screen.getByRole("spinbutton", { name: "Days of sick leave" });
  fireEvent.change(days, { target: { value: "2000" } });
  expect(days.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById("sick-total")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(days, { target: { value: "3" } });
  expect(document.getElementById("sick-total")?.textContent).toBe(euros(0));
  expect(screen.getByText(/Every day of this leave is a waiting day/)).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "sick_pay", page_type: "tools/portugal-sick-pay-calculator",
  });
});
