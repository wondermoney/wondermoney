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

/** The headline figure: the first value of the result ledger. */
const headline = () => document.querySelector("#sick-result dd")?.textContent;

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
  expect(headline()).toBe(euros(outcome.result.totalCents));
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const days = screen.getByRole("spinbutton", { name: "Days of sick leave" });
  fireEvent.change(days, { target: { value: "2000" } });
  expect(days.getAttribute("aria-invalid")).toBe("true");
  expect(headline()).toBeUndefined();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(days, { target: { value: "3" } });
  expect(headline()).toBe(euros(0));
  expect(screen.getByText(/Every day of this leave is a waiting day/)).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "sick_pay", page_type: "tools/portugal-sick-pay-calculator",
  });
});

it("asks about the disability bonus and adds the 5-point increase when the answer is yes", () => {
  const euros = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);
  const expected = computeSickPay({ ...SICK_PAY_EXAMPLE, disabilityBonus: true });
  if (!expected.ok) throw new Error("input must be valid");

  render(<SickPayCalculatorComp locale="en" />);
  const question = screen.getByRole("combobox", {
    name: "Does your household receive the disability bonus for a child or dependant?",
  }) as HTMLSelectElement;
  expect(question.value).toBe("no");
  expect(screen.queryByText(/5-point increase .* is included/)).toBeNull();

  fireEvent.change(question, { target: { value: "yes" } });
  expect(headline()).toBe(euros(expected.result.totalCents));
  expect(screen.getByText(/Days 1 to 30 \(60%\)/)).toBeTruthy();
  expect(screen.getByText(/5-point increase .* is included/)).toBeTruthy();
});
