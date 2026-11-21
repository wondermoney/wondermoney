// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UNEMPLOYMENT_EXAMPLE, computeUnemploymentBenefit } from "@/lib/calculators/unemploymentBenefit";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-unemployment-benefit-calculator",
}));

const { default: UnemploymentBenefitCalculatorComp } = await import("./UnemploymentBenefitCalculatorComp");

/** The headline figure: the first value of the result ledger. */
const headline = () => document.querySelector("#unemployment-result dd")?.textContent;

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, explains edge cases and tracks one edit with metadata only", () => {
  const outcome = computeUnemploymentBenefit(UNEMPLOYMENT_EXAMPLE);
  if (!outcome.ok) throw new Error("example must be valid");
  const euros = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);

  render(<UnemploymentBenefitCalculatorComp locale="en" />);
  expect(headline()).toBe(euros(outcome.result.monthlyCents));
  expect(screen.getByText("Conditions to check (not a decision)")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const months = screen.getByRole("spinbutton", { name: "Months with registered pay" });
  fireEvent.change(months, { target: { value: "8" } });
  expect(months.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(/The duration table starts at 12 months/)).toBeTruthy();
  expect(headline()).toBeUndefined();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(months, { target: { value: "30" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Gross monthly salary" }), { target: { value: "9000" } });
  expect(headline()).toBe("€1,342.83");
  fireEvent.change(screen.getByLabelText("Household"), { target: { value: "singleParent" } });
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "unemployment_benefit", page_type: "tools/portugal-unemployment-benefit-calculator",
  });
});
